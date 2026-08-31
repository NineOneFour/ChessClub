import { Chess } from "chess.js";
import type { ResultReason, Result } from "../db/schema/games";

/**
 * The rules of chess, and the only place in the codebase that knows them.
 *
 * Everything here runs on the server. The browser is never given a chess
 * engine — it receives the position and the list of legal moves and can do
 * nothing else, which is the brief's "the client must never be trusted to
 * determine legal moves" taken to its conclusion.
 *
 * chess.js (BSD-2-Clause) does the work, including threefold repetition, the
 * fifty-move rule, insufficient material and PGN output.
 */

export const STARTING_FEN =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export type Color = "white" | "black";

/** Legal destinations, keyed by origin square: `{ e2: ["e3", "e4"], … }`. */
export type Dests = Record<string, string[]>;

export type Position = {
  fen: string;
  turn: Color;
  /** Squares each piece may move to. Empty when the game is over. */
  dests: Dests;
  /**
   * The subset of `dests` that are promotions, so the board knows when to ask
   * which piece — without the browser having to know a rule of chess.
   */
  promotions: Dests;
  inCheck: boolean;
  /**
   * Set when the position itself ends the game. A game can also end by
   * resignation, agreement or the clock, which this cannot see.
   */
  ending: { result: Result; reason: ResultReason } | null;
};

function toColor(turn: "w" | "b"): Color {
  return turn === "w" ? "white" : "black";
}

/**
 * Why this position is terminal, if it is.
 *
 * Threefold repetition and the fifty-move rule are *claims* in tournament
 * chess, not automatic. They're automatic here on purpose: nobody wants to
 * explain to a nine-year-old how to claim a draw, and a game that should be
 * over being scored as over is the friendlier answer.
 */
function endingOf(
  chess: Chess,
): { result: Result; reason: ResultReason } | null {
  if (chess.isCheckmate()) {
    // The player to move is the one who is mated.
    return {
      result: chess.turn() === "w" ? "0-1" : "1-0",
      reason: "checkmate",
    };
  }
  if (chess.isStalemate()) return { result: "1/2-1/2", reason: "stalemate" };
  if (chess.isInsufficientMaterial()) {
    return { result: "1/2-1/2", reason: "insufficient_material" };
  }
  if (chess.isThreefoldRepetition()) {
    return { result: "1/2-1/2", reason: "threefold" };
  }
  if (chess.isDrawByFiftyMoves()) {
    return { result: "1/2-1/2", reason: "fifty_move" };
  }
  return null;
}

function movesOf(chess: Chess): { dests: Dests; promotions: Dests } {
  const dests: Dests = {};
  const promotions: Dests = {};

  for (const move of chess.moves({ verbose: true })) {
    (dests[move.from] ??= []).push(move.to);
    if (move.isPromotion()) (promotions[move.from] ??= []).push(move.to);
  }

  // A promotion offers the same destination once per piece, so both maps need
  // duplicates removed.
  for (const map of [dests, promotions]) {
    for (const from of Object.keys(map)) map[from] = [...new Set(map[from])];
  }
  return { dests, promotions };
}

/**
 * Load a position, replaying the moves so that repetition and the fifty-move
 * count are correct — chess.js can only see repetition it has witnessed, so a
 * bare FEN would silently lose it.
 */
function load(moves: string[]): Chess {
  const chess = new Chess();
  for (const uci of moves) {
    const move = parseUci(uci);
    if (!move) throw new Error(`Stored move "${uci}" is not readable.`);
    chess.move(move);
  }
  return chess;
}

function parseUci(
  uci: string,
): { from: string; to: string; promotion?: string } | null {
  const match = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(uci);
  if (!match) return null;
  return match[3]
    ? { from: match[1], to: match[2], promotion: match[3] }
    : { from: match[1], to: match[2] };
}

/** The position after a game's stored moves. */
export function positionAfter(moves: string[]): Position {
  const chess = load(moves);
  const ending = endingOf(chess);
  const legal = ending ? { dests: {}, promotions: {} } : movesOf(chess);
  return {
    fen: chess.fen(),
    turn: toColor(chess.turn()),
    dests: legal.dests,
    promotions: legal.promotions,
    inCheck: chess.isCheck(),
    ending,
  };
}

export type PlayedMove = {
  uci: string;
  san: string;
  /** The position that results, ready to store and broadcast. */
  position: Position;
};

/**
 * Validate and apply one move. Returns null if the move is not legal in the
 * position — which is the only answer the client gets, whether it sent
 * nonsense, a stale move, or a deliberate cheat.
 *
 * `promotion` is required when a pawn reaches the last rank; a move that needs
 * one and doesn't have it is rejected rather than assumed to be a queen, so the
 * player is always the one choosing.
 */
export function playMove(
  moves: string[],
  attempt: { from: string; to: string; promotion?: string },
): PlayedMove | null {
  const chess = load(moves);

  const legal = chess
    .moves({ verbose: true })
    .find(
      (move) =>
        move.from === attempt.from &&
        move.to === attempt.to &&
        (move.promotion ?? undefined) === (attempt.promotion ?? undefined),
    );
  if (!legal) return null;

  chess.move({
    from: attempt.from,
    to: attempt.to,
    ...(attempt.promotion ? { promotion: attempt.promotion } : {}),
  });

  const ending = endingOf(chess);
  const next = ending ? { dests: {}, promotions: {} } : movesOf(chess);
  return {
    uci: legal.lan,
    san: legal.san,
    position: {
      fen: chess.fen(),
      turn: toColor(chess.turn()),
      dests: next.dests,
      promotions: next.promotions,
      inCheck: chess.isCheck(),
      ending,
    },
  };
}

/**
 * Could this side mate at all with the material they hold? Takes a FEN, since
 * material doesn't depend on how the position was reached.
 *
 * Used when a clock falls: flagging your opponent while holding a bare king —
 * or a lone knight or bishop — is a draw, not a win. A kid whose opponent ran
 * out of time shouldn't be told they won a game they could never have won.
 *
 * King and two knights counts as sufficient, matching the usual online
 * convention: mate is possible with a cooperating opponent even though it
 * can't be forced.
 */
export function canMateWithMaterial(fen: string, color: Color): boolean {
  const chess = new Chess(fen);
  const pieces = chess
    .board()
    .flat()
    .filter((square) => square !== null)
    .filter((square) => square.color === (color === "white" ? "w" : "b"));

  const others = pieces.filter((piece) => piece.type !== "k");
  if (others.length === 0) return false;
  if (others.length === 1 && (others[0].type === "n" || others[0].type === "b")) {
    return false;
  }
  return true;
}

/**
 * A game as PGN. Headers follow the standard seven-tag roster so the file
 * imports cleanly into anything — which matters, because these games are meant
 * to be re-analysed later.
 */
export function toPgn(game: {
  moves: string[];
  white: string;
  black: string;
  result: Result | null;
  startedAt: Date;
  timeControl: string;
  reason: ResultReason | null;
}): string {
  const chess = load(game.moves);
  const date = game.startedAt;

  chess.setHeader("Event", "The Chess Club");
  chess.setHeader("Site", "chess.vsakis.com");
  chess.setHeader(
    "Date",
    `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(
      date.getDate(),
    ).padStart(2, "0")}`,
  );
  chess.setHeader("Round", "-");
  chess.setHeader("White", game.white);
  chess.setHeader("Black", game.black);
  chess.setHeader("Result", game.result ?? "*");
  chess.setHeader("TimeControl", game.timeControl);
  if (game.reason) chess.setHeader("Termination", game.reason);

  return chess.pgn();
}
