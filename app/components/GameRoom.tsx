"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ServerChatMessage,
  WireGame,
  WireMove,
} from "@/realtime/protocol";
import { formatClock } from "@/lib/chess/clock";
import { capturedPieces, materialValue, sortByValue } from "@/lib/chess/material";
import type { GamePerformance } from "@/lib/chess/rating";
import { STARTING_FEN } from "@/lib/chess/position";
import {
  boardStyle as resolveBoardStyle,
  boardVars,
  glyph,
  pieceSet as resolvePieceSet,
} from "@/lib/board-styles";
import { MAX_CHAT_LENGTH } from "@/lib/validation";
import { Avatar, GrownUpTag } from "./Avatar";
import { Board } from "./Board";
import { PerformanceLine } from "./Strength";
import { SectionHeading } from "./SectionHeading";
import { useGameSocket, useLiveClock } from "./useGameSocket";

/**
 * A game room. The same page whether you are playing, watching, or looking at a
 * game that finished last month — the board just stops accepting moves. That
 * keeps one set of code paths and means "review a game" needs no separate
 * screen.
 */
export function GameRoom({
  gameId,
  initialGame,
  initialMessages,
  viewerId,
  canChat,
  chatBlockedReason,
  performance,
  boardStyle,
  pieceSet,
}: {
  gameId: number;
  initialGame: WireGame;
  initialMessages: ServerChatMessage[];
  viewerId: number;
  canChat: boolean;
  chatBlockedReason: string | null;
  /**
   * What the viewer's own play in this game was worth, once it is over and
   * analysed. Null for a spectator, a live game, or one Stockfish hasn't
   * reached yet.
   */
  performance: GamePerformance | null;
  /** The viewer's own board and pieces. Null falls back to the default. */
  boardStyle: string | null;
  pieceSet: string | null;
}) {
  const router = useRouter();

  const {
    connection,
    game,
    receivedAt,
    messages,
    notice,
    challenges,
    move,
    resign,
    offerDraw,
    cancelDraw,
    claimFlag,
    rematch,
    cancelChallenge,
    say,
  } = useGameSocket(gameId, initialGame, initialMessages, (newGameId) =>
    router.push(`/game/${newGameId}`),
  );

  const clocks = useLiveClock(game, receivedAt);

  const playingAs =
    viewerId === game.white.id
      ? "white"
      : viewerId === game.black.id
        ? "black"
        : null;

  const opponent =
    playingAs === "white"
      ? game.black
      : playingAs === "black"
        ? game.white
        : null;

  // A rematch travels as an ordinary challenge between the two players, so it
  // is simply the open challenge involving the person you just played.
  const myRematch = opponent
    ? (challenges.outgoing.find((c) => c.toId === opponent.id) ?? null)
    : null;
  const theirRematch = opponent
    ? (challenges.incoming.find((c) => c.fromId === opponent.id) ?? null)
    : null;

  // Spectators watch from white's side; players from their own.
  const [flipped, setFlipped] = useState(false);
  const orientation =
    (playingAs === "black") !== flipped ? "black" : ("white" as const);

  /**
   * Stepping through a finished game. `null` is the game as it stands, which
   * is the only thing a live game ever shows — a board that wandered off
   * while your opponent was thinking would be a way to miss a move.
   */
  const [reviewPly, setReviewPly] = useState<number | null>(null);
  const total = game.moves.length;
  const reviewable = game.status === "finished" && total > 0;
  const at = reviewable ? reviewPly : null;
  const shown = positionAt(game, at);

  // As of the position on screen, not necessarily the final one — stepping
  // back through a finished game steps the captured pieces back with it.
  const captured = capturedPieces(at === null ? game.moves : game.moves.slice(0, at));
  const materialDiff =
    materialValue(captured.byWhite) - materialValue(captured.byBlack);
  const capturedFor = (playerId: number) =>
    playerId === game.white.id ? captured.byWhite : captured.byBlack;
  const advantageFor = (playerId: number) => {
    if (materialDiff === 0) return null;
    const leaderIsWhite = materialDiff > 0;
    const playerIsWhite = playerId === game.white.id;
    return leaderIsWhite === playerIsWhite ? Math.abs(materialDiff) : null;
  };

  const step = useCallback(
    (to: number | "first" | "back" | "on" | "last") => {
      setReviewPly((current) => {
        const from = current ?? total;
        if (to === "first") return 0;
        if (to === "last") return total;
        if (to === "back") return Math.max(0, from - 1);
        if (to === "on") return Math.min(total, from + 1);
        return Math.min(total, Math.max(0, to));
      });
    },
    [total],
  );

  // The arrow keys are how anybody who has used a chess site expects to walk a
  // game, so they work on the whole page — except while a chat box has the
  // focus, where left and right belong to the text.
  useEffect(() => {
    if (!reviewable) return;

    const onKey = (event: KeyboardEvent) => {
      const keys = {
        ArrowLeft: "back",
        ArrowRight: "on",
        Home: "first",
        End: "last",
      } as const;
      const wanted = keys[event.key as keyof typeof keys];
      if (!wanted) return;

      const target = event.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;

      event.preventDefault();
      step(wanted);
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [reviewable, step]);

  /**
   * When the clock on screen hits zero, ask the server to check. The server
   * has its own watchdog, so this is a belt-and-braces path for the case where
   * the browser notices first — and `claimFlag` does nothing if there is
   * actually time left.
   */
  const flagAskedRef = useRef(false);
  const outOfTime =
    game.status === "active" &&
    game.clock.running &&
    (game.turn === "white" ? clocks.whiteMs : clocks.blackMs) <= 0;

  useEffect(() => {
    if (!outOfTime || flagAskedRef.current) return;
    flagAskedRef.current = true;
    claimFlag();
  }, [outOfTime, claimFlag]);

  useEffect(() => {
    flagAskedRef.current = false;
  }, [game.ply, game.status]);

  const drawOfferedToMe =
    game.status === "active" &&
    game.drawOfferBy !== null &&
    playingAs !== null &&
    game.drawOfferBy !== viewerId;
  const drawOfferedByMe = game.drawOfferBy === viewerId;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section className="mx-auto w-full max-w-[36rem]">
        <PlayerBar
          player={orientation === "white" ? game.black : game.white}
          ms={orientation === "white" ? clocks.blackMs : clocks.whiteMs}
          showClock={game.initialMs > 0}
          toMove={
            game.status === "active" &&
            game.turn === (orientation === "white" ? "black" : "white")
          }
          isWinner={
            game.winnerId ===
            (orientation === "white" ? game.black.id : game.white.id)
          }
          captured={capturedFor(
            orientation === "white" ? game.black.id : game.white.id,
          )}
          advantage={advantageFor(
            orientation === "white" ? game.black.id : game.white.id,
          )}
          pieceSetKey={pieceSet}
        />

        <div className="my-2">
          <Board
            fen={shown.fen}
            orientation={orientation}
            dests={at === null ? game.dests : {}}
            promotions={at === null ? game.promotions : {}}
            lastMove={shown.lastMove}
            inCheck={shown.inCheck}
            turn={shown.turn}
            playingAs={game.status === "active" ? playingAs : null}
            onMove={move}
            styleKey={boardStyle}
            pieceSetKey={pieceSet}
          />
        </div>

        <PlayerBar
          player={orientation === "white" ? game.white : game.black}
          ms={orientation === "white" ? clocks.whiteMs : clocks.blackMs}
          showClock={game.initialMs > 0}
          toMove={game.status === "active" && game.turn === orientation}
          isWinner={
            game.winnerId ===
            (orientation === "white" ? game.white.id : game.black.id)
          }
          captured={capturedFor(
            orientation === "white" ? game.white.id : game.black.id,
          )}
          advantage={advantageFor(
            orientation === "white" ? game.white.id : game.black.id,
          )}
          pieceSetKey={pieceSet}
        />

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => setFlipped((current) => !current)}
          >
            Flip board
          </button>

          {game.status === "active" && playingAs && (
            <>
              {drawOfferedToMe ? (
                <button type="button" className="btn" onClick={offerDraw}>
                  Accept draw
                </button>
              ) : drawOfferedByMe ? (
                <button
                  type="button"
                  className="btn btn-quiet"
                  onClick={cancelDraw}
                >
                  Take back draw offer
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-quiet"
                  onClick={offerDraw}
                >
                  Offer a draw
                </button>
              )}
              <ResignButton onResign={resign} />
            </>
          )}

          {game.status === "finished" && playingAs && (
            <>
              {myRematch ? (
                <button
                  type="button"
                  className="btn btn-quiet"
                  onClick={() => cancelChallenge(myRematch.id)}
                >
                  Take back {theirRematch ? "my offer" : "the offer"}
                </button>
              ) : (
                <button type="button" className="btn" onClick={rematch}>
                  Play again
                </button>
              )}
            </>
          )}

          {game.status === "finished" && (
            <a href={`/game/${game.id}/pgn`} className="btn btn-quiet">
              Download PGN
            </a>
          )}

          <span className="eyebrow ml-auto">
            {game.timeControl}
            {connection !== "open" && " · reconnecting"}
          </span>
        </div>

        {drawOfferedToMe && (
          <p className="mt-3 border-l-2 border-brass pl-3 text-sm">
            {
              (game.drawOfferBy === game.white.id ? game.white : game.black)
                .username
            }{" "}
            is offering a draw.
          </p>
        )}
        {theirRematch && !myRematch && (
          <p className="mt-3 border-l-2 border-brass pl-3 text-sm">
            {opponent?.username} wants another game —{" "}
            <strong>Play again</strong> starts it.
          </p>
        )}
        {myRematch && (
          <p className="mt-3 border-l-2 border-rule pl-3 text-sm text-ink-soft">
            Waiting for {opponent?.username} to play again.
          </p>
        )}
        {notice && (
          <p role="status" className="mt-3 text-sm text-stamp">
            {notice}
          </p>
        )}

        <Outcome game={game} viewerId={viewerId} playingAs={playingAs} />

        {performance && <PerformanceLine performance={performance} />}
      </section>

      <aside className="space-y-8">
        <div>
          <SectionHeading
            label="Score sheet"
            count={`${Math.ceil(game.ply / 2)} moves`}
          />
          <ScoreSheet
            moves={game.moves}
            at={at}
            onStep={reviewable ? step : null}
          />
        </div>

        <div>
          <SectionHeading label="Game chat" />
          <GameChat
            messages={messages}
            viewerId={viewerId}
            canChat={canChat}
            blockedReason={chatBlockedReason}
            connected={connection === "open"}
            onSay={say}
          />
        </div>
      </aside>
    </div>
  );
}

function PlayerBar({
  player,
  ms,
  showClock,
  toMove,
  isWinner,
  captured,
  advantage,
  pieceSetKey,
}: {
  player: WireGame["white"];
  ms: number;
  showClock: boolean;
  toMove: boolean;
  isWinner: boolean;
  /** Pieces this player has taken from the opponent, as of what's on screen. */
  captured: string[];
  /** This player's material lead in points, or null when there isn't one. */
  advantage: number | null;
  pieceSetKey: string | null;
}) {
  const low = showClock && ms < 20_000;

  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-y px-3 py-2 ${
        toMove ? "border-ink bg-sheet" : "border-rule"
      }`}
    >
      <Avatar avatar={player.avatar} role={player.role} size="sm" />
      <Link
        href={`/profile/${player.username}`}
        className="flex min-w-0 items-center gap-1.5"
      >
        <span className="truncate font-semibold">{player.username}</span>
        <GrownUpTag role={player.role} />
      </Link>
      {toMove && (
        <span className="eyebrow text-brass" aria-label="To move">
          ● to move
        </span>
      )}
      {isWinner && <span className="eyebrow text-brass">won</span>}

      <CapturedRow
        captured={captured}
        advantage={advantage}
        pieceSetKey={pieceSetKey}
      />

      {showClock && (
        <span
          className={`ml-auto font-mono text-2xl tabular-nums ${
            low ? "text-stamp" : toMove ? "text-ink" : "text-ink-soft"
          }`}
        >
          {formatClock(ms)}
        </span>
      )}
    </div>
  );
}

/** The pieces one player has taken from the other, heaviest first. */
function CapturedRow({
  captured,
  advantage,
  pieceSetKey,
}: {
  captured: string[];
  advantage: number | null;
  pieceSetKey: string | null;
}) {
  if (captured.length === 0) return null;
  const set = resolvePieceSet(pieceSetKey);

  return (
    <span
      style={boardVars(resolveBoardStyle(null), set)}
      className="flex items-center gap-0.5"
    >
      {sortByValue(captured).map((letter, i) => {
        const color = letter === letter.toLowerCase() ? "black" : "white";
        return (
          <span
            key={i}
            aria-hidden
            className={`piece-glyph text-lg leading-none ${
              color === "white" ? "piece-white" : "piece-black"
            }`}
          >
            {glyph(set, letter.toLowerCase(), color)}
          </span>
        );
      })}
      {advantage !== null && (
        <span className="font-mono text-xs text-ink-soft">+{advantage}</span>
      )}
    </span>
  );
}

/**
 * Resigning takes two taps. A native confirm() would block the page, and a
 * misplaced tap losing a game the kid was winning is exactly the thing worth
 * spending a click on.
 */
function ResignButton({ onResign }: { onResign: () => void }) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);

  return armed ? (
    <button type="button" className="btn btn-warn" onClick={onResign}>
      Really resign?
    </button>
  ) : (
    <button
      type="button"
      className="btn btn-quiet"
      onClick={() => setArmed(true)}
    >
      Resign
    </button>
  );
}

const REASON_WORDS: Record<string, string> = {
  checkmate: "by checkmate",
  resignation: "by resignation",
  stalemate: "— stalemate",
  insufficient_material: "— not enough pieces left to mate",
  fifty_move: "— fifty moves without a capture or a pawn move",
  threefold: "— the same position three times",
  flag: "on time",
  agreement: "by agreement",
};

function Outcome({
  game,
  viewerId,
  playingAs,
}: {
  game: WireGame;
  viewerId: number;
  playingAs: "white" | "black" | null;
}) {
  if (game.status !== "finished") return null;

  const reason = game.resultReason
    ? (REASON_WORDS[game.resultReason] ?? "")
    : "";
  const drawn = game.winnerId === null;
  const winner =
    game.winnerId === game.white.id
      ? game.white
      : game.winnerId === game.black.id
        ? game.black
        : null;

  const headline = drawn
    ? `Drawn ${reason}`.trim()
    : `${winner?.username} won ${reason}`.trim();

  // A line for the players, and only for them.
  const personal =
    playingAs === null
      ? null
      : drawn
        ? "A draw. Nothing between you."
        : game.winnerId === viewerId
          ? "Good game."
          : "Hard luck — have another?";

  return (
    <div className="sheet mt-4 p-4">
      <p className="masthead text-xl">{headline}</p>
      {personal && <p className="mt-1 text-sm text-ink-soft">{personal}</p>}
      <p className="mt-2 font-mono text-xs text-ink-soft">
        {game.result} · {Math.ceil(game.ply / 2)} moves
      </p>
    </div>
  );
}

/**
 * The position to draw on the board.
 *
 * Live, that is simply the game as the server last sent it. Stepping through a
 * finished game, it is the FEN the server stored beside each half-move — so
 * even here the browser computes nothing. The check highlight is read off the
 * `+` or `#` in the notation rather than worked out, for the same reason.
 */
function positionAt(game: WireGame, ply: number | null) {
  if (ply === null) {
    return {
      fen: game.fen,
      lastMove: game.lastMove,
      inCheck: game.inCheck,
      turn: game.turn,
    };
  }

  if (ply === 0) {
    return {
      fen: STARTING_FEN,
      lastMove: null,
      inCheck: false,
      turn: "white" as const,
    };
  }

  const move = game.moves[ply - 1];

  return {
    fen: move.fenAfter,
    lastMove: { from: move.uci.slice(0, 2), to: move.uci.slice(2, 4) },
    inCheck: move.san.endsWith("+") || move.san.endsWith("#"),
    turn: move.ply % 2 === 1 ? ("black" as const) : ("white" as const),
  };
}

/**
 * The move list, set as an actual score sheet: numbered rows, white's move and
 * black's reply side by side. This is the shape the whole design borrows from,
 * so here it is literal.
 *
 * Once the game is over the moves become the way you walk back through it —
 * `onStep` is null while it is still being played, and the sheet is then a
 * plain list that follows along.
 */
function ScoreSheet({
  moves,
  at,
  onStep,
}: {
  moves: WireGame["moves"];
  /** Half-move on the board, or null when the board is showing the live game. */
  at: number | null;
  onStep: ((to: number | "first" | "back" | "on" | "last") => void) | null;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  // Follow the game while it is live; follow the reader once they take over.
  useEffect(() => {
    if (at !== null) return;
    endRef.current?.scrollIntoView({ block: "end" });
  }, [moves.length, at]);

  useEffect(() => {
    if (at === null) return;
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [at]);

  if (moves.length === 0) {
    return (
      <p className="sheet p-4 text-sm text-ink-soft">
        No moves yet. White starts.
      </p>
    );
  }

  const pairs: { number: number; white?: WireMove; black?: WireMove }[] = [];
  for (const move of moves) {
    const index = Math.ceil(move.ply / 2);
    const pair = (pairs[index - 1] ??= { number: index });
    if (move.ply % 2 === 1) pair.white = move;
    else pair.black = move;
  }

  const cell = (move: WireMove | undefined) => {
    if (!move) return <span className="w-16" />;

    const active = move.ply === at;

    if (!onStep) {
      return <span className="w-16 font-mono text-sm">{move.san}</span>;
    }

    return (
      <button
        ref={active ? activeRef : null}
        type="button"
        aria-current={active ? "true" : undefined}
        className={`w-16 text-left font-mono text-sm ${
          active ? "bg-ink px-1 text-sheet" : "px-1 hover:bg-paper"
        }`}
        onClick={() => onStep(move.ply)}
      >
        {move.san}
      </button>
    );
  };

  return (
    <>
      <div className="sheet ruled max-h-[22rem] overflow-y-auto">
        {pairs.map((pair) => (
          <div key={pair.number} className="flex items-center gap-3 px-3 py-1">
            <span className="gutter">{pair.number}.</span>
            {cell(pair.white)}
            {cell(pair.black)}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {onStep && (
        <div className="mt-2 flex items-center gap-1">
          <StepButton label="First move" onClick={() => onStep("first")}>
            ⏮
          </StepButton>
          <StepButton label="Move back" onClick={() => onStep("back")}>
            ◀
          </StepButton>
          <StepButton label="Move on" onClick={() => onStep("on")}>
            ▶
          </StepButton>
          <StepButton label="Last move" onClick={() => onStep("last")}>
            ⏭
          </StepButton>
          <span className="eyebrow ml-auto">
            {at === null
              ? "final position"
              : at === 0
                ? "before the first move"
                : `move ${Math.ceil(at / 2)}`}
          </span>
        </div>
      )}
    </>
  );
}

function StepButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      className="btn btn-quiet px-2 py-1"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function GameChat({
  messages,
  viewerId,
  canChat,
  blockedReason,
  connected,
  onSay,
}: {
  messages: ServerChatMessage[];
  viewerId: number;
  canChat: boolean;
  blockedReason: string | null;
  connected: boolean;
  onSay: (body: string) => boolean;
}) {
  const [value, setValue] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  return (
    <div>
      <div className="sheet max-h-[14rem] min-h-[6rem] overflow-y-auto p-3">
        {messages.length === 0 ? (
          <p className="text-sm text-ink-soft">
            Nothing said in this game yet.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {messages.map((message) => (
              <li key={message.id} className="text-sm leading-snug">
                <Link
                  href={`/profile/${message.username}`}
                  className={`font-semibold hover:underline ${
                    message.userId === viewerId ? "text-brass" : ""
                  }`}
                >
                  {message.username}
                </Link>{" "}
                <GrownUpTag role={message.role} />{" "}
                <span className="break-words">{message.body}</span>
              </li>
            ))}
          </ul>
        )}
        <div ref={endRef} />
      </div>

      {canChat ? (
        <form
          className="mt-2 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const body = value.trim();
            if (!body) return;
            if (onSay(body)) setValue("");
          }}
        >
          <label htmlFor="game-chat" className="sr-only">
            Say something in this game
          </label>
          <input
            id="game-chat"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            maxLength={MAX_CHAT_LENGTH}
            autoComplete="off"
            placeholder={connected ? "Say something" : "Reconnecting…"}
            className="field"
          />
          <button
            type="submit"
            className="btn"
            disabled={!connected || !value.trim()}
          >
            Send
          </button>
        </form>
      ) : (
        <p className="mt-2 border-l-2 border-rule pl-3 text-sm text-ink-soft">
          {blockedReason ?? "Chat is switched off for your account."}
        </p>
      )}
    </div>
  );
}
