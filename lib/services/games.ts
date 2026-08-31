import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "../db";
import {
  gameMoves,
  games,
  type Result,
  type ResultReason,
} from "../db/schema";
import * as clock from "../chess/clock";
import * as rules from "../chess/rules";
import { describeTimeControl } from "../chess/time-controls";
import { fail } from "../validation";

/**
 * Games.
 *
 * The database is the authority. Every state change is one transaction that
 * locks the game row, re-derives the position from the stored move list, and
 * writes the result — so two clients racing a move cannot both win, and a
 * crash of the realtime service loses nothing at all.
 *
 * Nothing here trusts its caller about whose turn it is, what is legal, or how
 * much time is left.
 */

export type GamePlayer = {
  id: number;
  username: string;
  displayName: string;
  avatar: string;
  role: string;
};

export type GameMove = {
  ply: number;
  san: string;
  uci: string;
  fenAfter: string;
  whiteMs: number;
  blackMs: number;
};

export type GameState = {
  id: number;
  white: GamePlayer;
  black: GamePlayer;
  initialMs: number;
  incrementMs: number;
  timeControl: string;

  status: "active" | "finished";
  result: Result | null;
  resultReason: ResultReason | null;
  winnerId: number | null;

  fen: string;
  ply: number;
  turn: rules.Color;
  /**
   * Legal moves in the current position. Sent to players and spectators alike —
   * legal moves are public information; it's Stockfish's evaluation that must
   * stay hidden during a game.
   */
  dests: rules.Dests;
  /** Which of those destinations need a promotion piece chosen. */
  promotions: rules.Dests;
  inCheck: boolean;
  lastMove: { from: string; to: string } | null;

  clock: { whiteMs: number; blackMs: number; running: boolean };
  /**
   * When the running clock was last reset. Sent to the browser so it can count
   * down locally instead of being fed ticks, and used by the realtime
   * service's flag watchdog.
   */
  clockStartedAt: Date;
  drawOfferBy: number | null;

  moves: GameMove[];
  startedAt: Date;
  finishedAt: Date | null;
};

/** Load a game and everything needed to render or continue it. */
export async function get(gameId: number): Promise<GameState | null> {
  const rows = await db
    .select({
      game: games,
      whitePlayer: {
        id: sql<number>`w.id`,
        username: sql<string>`w.username`,
        displayName: sql<string>`w.display_name`,
        avatar: sql<string>`w.avatar`,
        role: sql<string>`w.role`,
      },
      blackPlayer: {
        id: sql<number>`b.id`,
        username: sql<string>`b.username`,
        displayName: sql<string>`b.display_name`,
        avatar: sql<string>`b.avatar`,
        role: sql<string>`b.role`,
      },
    })
    .from(games)
    .innerJoin(sql`users w`, sql`w.id = ${games.whiteId}`)
    .innerJoin(sql`users b`, sql`b.id = ${games.blackId}`)
    .where(eq(games.id, gameId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const moves = await db
    .select({
      ply: gameMoves.ply,
      san: gameMoves.san,
      uci: gameMoves.uci,
      fenAfter: gameMoves.fenAfter,
      whiteMs: gameMoves.whiteMs,
      blackMs: gameMoves.blackMs,
    })
    .from(gameMoves)
    .where(eq(gameMoves.gameId, gameId))
    .orderBy(asc(gameMoves.ply));

  return assemble(row.game, row.whitePlayer, row.blackPlayer, moves, Date.now());
}

function assemble(
  game: typeof games.$inferSelect,
  whitePlayer: GamePlayer,
  blackPlayer: GamePlayer,
  moves: GameMove[],
  now: number,
): GameState {
  const position = rules.positionAfter(moves.map((move) => move.uci));
  const active = game.status === "active";

  const live = active
    ? clock.remaining(
        {
          whiteMs: game.whiteMs,
          blackMs: game.blackMs,
          clockStartedAt: game.clockStartedAt,
          turn: position.turn,
          initialMs: game.initialMs,
          incrementMs: game.incrementMs,
        },
        now,
      )
    : { whiteMs: game.whiteMs, blackMs: game.blackMs };

  const last = moves[moves.length - 1];

  return {
    id: game.id,
    white: whitePlayer,
    black: blackPlayer,
    initialMs: game.initialMs,
    incrementMs: game.incrementMs,
    timeControl: describeTimeControl(game.initialMs, game.incrementMs),

    status: active ? "active" : "finished",
    result: (game.result as Result | null) ?? null,
    resultReason: (game.resultReason as ResultReason | null) ?? null,
    winnerId: game.winnerId,

    fen: position.fen,
    ply: game.ply,
    turn: position.turn,
    dests: active ? position.dests : {},
    promotions: active ? position.promotions : {},
    inCheck: position.inCheck,
    lastMove: last
      ? { from: last.uci.slice(0, 2), to: last.uci.slice(2, 4) }
      : null,

    clock: {
      whiteMs: live.whiteMs,
      blackMs: live.blackMs,
      running: active && game.initialMs > 0,
    },
    clockStartedAt: game.clockStartedAt,
    drawOfferBy: game.drawOfferBy,

    moves,
    startedAt: game.startedAt,
    finishedAt: game.finishedAt,
  };
}

/**
 * Start a game. Colours are already decided by the caller (see
 * services/challenges.ts) — this function does not guess.
 */
export async function create(input: {
  whiteId: number;
  blackId: number;
  initialMs: number;
  incrementMs: number;
}): Promise<number> {
  if (input.whiteId === input.blackId) {
    fail("You can't play against yourself.");
  }

  const rows = await db
    .insert(games)
    .values({
      whiteId: input.whiteId,
      blackId: input.blackId,
      initialMs: input.initialMs,
      incrementMs: input.incrementMs,
      fen: rules.STARTING_FEN,
      whiteMs: input.initialMs,
      blackMs: input.initialMs,
    })
    .returning({ id: games.id });

  return rows[0].id;
}

export type MoveOutcome =
  | { ok: true; state: GameState }
  | { ok: false; reason: string };

/**
 * Play a move.
 *
 * Runs as a single transaction with the game row locked. The order of checks
 * matters: the mover's own clock is examined *before* the move is considered,
 * because a player who has already flagged has lost whatever they were about
 * to play.
 */
export async function playMove(
  gameId: number,
  userId: number,
  attempt: { from: string; to: string; promotion?: string },
): Promise<MoveOutcome> {
  return db.transaction(async (tx) => {
    const locked = await tx
      .select()
      .from(games)
      .where(eq(games.id, gameId))
      .limit(1)
      .for("update");

    const game = locked[0];
    if (!game) return { ok: false as const, reason: "That game doesn't exist." };
    if (game.status !== "active") {
      return { ok: false as const, reason: "That game is already over." };
    }

    const moves = await tx
      .select({ uci: gameMoves.uci })
      .from(gameMoves)
      .where(eq(gameMoves.gameId, gameId))
      .orderBy(asc(gameMoves.ply));

    const uciList = moves.map((move) => move.uci);
    const before = rules.positionAfter(uciList);

    if (userId !== game.whiteId && userId !== game.blackId) {
      return { ok: false as const, reason: "You're not playing in that game." };
    }
    const moverColor: rules.Color =
      userId === game.whiteId ? "white" : "black";
    if (moverColor !== before.turn) {
      return { ok: false as const, reason: "It's not your turn." };
    }

    const clockState = {
      whiteMs: game.whiteMs,
      blackMs: game.blackMs,
      clockStartedAt: game.clockStartedAt,
      turn: before.turn,
      initialMs: game.initialMs,
      incrementMs: game.incrementMs,
    };
    const now = Date.now();

    if (clock.hasFlagged(clockState, now)) {
      // Too late — the move doesn't happen, the flag does.
      const state = await finishInTx(
        tx,
        game,
        flagOutcome(before.fen, before.turn, game),
      );
      return { ok: true as const, state };
    }

    const played = rules.playMove(uciList, attempt);
    if (!played) {
      return { ok: false as const, reason: "That isn't a legal move." };
    }

    const nextClocks = clock.applyMove(clockState, now);
    const ending = played.position.ending;

    await tx.insert(gameMoves).values({
      gameId,
      ply: game.ply + 1,
      uci: played.uci,
      san: played.san,
      fenAfter: played.position.fen,
      whiteMs: nextClocks.whiteMs,
      blackMs: nextClocks.blackMs,
    });

    await tx
      .update(games)
      .set({
        fen: played.position.fen,
        ply: game.ply + 1,
        whiteMs: nextClocks.whiteMs,
        blackMs: nextClocks.blackMs,
        clockStartedAt: new Date(now),
        // Any move refuses an outstanding draw offer, the way pressing the
        // clock does over the board.
        drawOfferBy: null,
        ...(ending
          ? {
              status: "finished",
              result: ending.result,
              resultReason: ending.reason,
              winnerId: winnerFor(ending.result, game),
              finishedAt: new Date(now),
            }
          : {}),
      })
      .where(eq(games.id, gameId));

    const state = await reload(tx, gameId, now);
    return { ok: true as const, state };
  });
}

function winnerFor(
  result: Result,
  game: { whiteId: number; blackId: number },
): number | null {
  if (result === "1-0") return game.whiteId;
  if (result === "0-1") return game.blackId;
  return null;
}

/**
 * What happens when `turn`'s clock runs out. A flag against an opponent who
 * couldn't force mate anyway is a draw, not a win — so a kid whose opponent
 * ran out of time while holding a bare king isn't told they won.
 */
function flagOutcome(
  fen: string,
  turn: rules.Color,
  game: { whiteId: number; blackId: number },
): { result: Result; reason: ResultReason; winnerId: number | null } {
  const opponent: rules.Color = turn === "white" ? "black" : "white";

  if (!rules.canMateWithMaterial(fen, opponent)) {
    return { result: "1/2-1/2", reason: "flag", winnerId: null };
  }

  return opponent === "white"
    ? { result: "1-0", reason: "flag", winnerId: game.whiteId }
    : { result: "0-1", reason: "flag", winnerId: game.blackId };
}

/** Resign. Only a player in the game may, and only while it's running. */
export function resign(gameId: number, userId: number): Promise<MoveOutcome> {
  return db.transaction(async (tx) => {
    const game = await lockActive(tx, gameId);
    if ("reason" in game) return game;

    if (userId !== game.whiteId && userId !== game.blackId) {
      return { ok: false as const, reason: "You're not playing in that game." };
    }

    const resigningWhite = userId === game.whiteId;
    const state = await finishInTx(tx, game, {
      result: resigningWhite ? "0-1" : "1-0",
      reason: "resignation",
      winnerId: resigningWhite ? game.blackId : game.whiteId,
    });
    return { ok: true as const, state };
  });
}

/**
 * Offer a draw, or accept one already on the table. One action for both, since
 * "offer a draw" when your opponent has offered one means agreement.
 */
export function offerOrAcceptDraw(
  gameId: number,
  userId: number,
): Promise<MoveOutcome> {
  return db.transaction(async (tx) => {
    const game = await lockActive(tx, gameId);
    if ("reason" in game) return game;

    if (userId !== game.whiteId && userId !== game.blackId) {
      return { ok: false as const, reason: "You're not playing in that game." };
    }

    if (game.drawOfferBy !== null && game.drawOfferBy !== userId) {
      const state = await finishInTx(tx, game, {
        result: "1/2-1/2",
        reason: "agreement",
        winnerId: null,
      });
      return { ok: true as const, state };
    }

    await tx
      .update(games)
      .set({ drawOfferBy: userId })
      .where(eq(games.id, gameId));

    return { ok: true as const, state: await reload(tx, gameId, Date.now()) };
  });
}

/** Withdraw or refuse a draw offer. */
export function clearDrawOffer(
  gameId: number,
  userId: number,
): Promise<MoveOutcome> {
  return db.transaction(async (tx) => {
    const game = await lockActive(tx, gameId);
    if ("reason" in game) return game;
    if (userId !== game.whiteId && userId !== game.blackId) {
      return { ok: false as const, reason: "You're not playing in that game." };
    }

    await tx.update(games).set({ drawOfferBy: null }).where(eq(games.id, gameId));
    return { ok: true as const, state: await reload(tx, gameId, Date.now()) };
  });
}

/**
 * End the game if the player to move has run out of time.
 *
 * Called by the realtime service's watchdog, and by any client that thinks a
 * clock has expired. Safe to call speculatively: if the clock hasn't actually
 * fallen, nothing happens.
 */
export function claimFlag(gameId: number): Promise<MoveOutcome> {
  return db.transaction(async (tx) => {
    const game = await lockActive(tx, gameId);
    if ("reason" in game) return game;

    const moves = await tx
      .select({ uci: gameMoves.uci })
      .from(gameMoves)
      .where(eq(gameMoves.gameId, gameId))
      .orderBy(asc(gameMoves.ply));
    const uciList = moves.map((move) => move.uci);
    const position = rules.positionAfter(uciList);

    const flagged = clock.hasFlagged(
      {
        whiteMs: game.whiteMs,
        blackMs: game.blackMs,
        clockStartedAt: game.clockStartedAt,
        turn: position.turn,
        initialMs: game.initialMs,
        incrementMs: game.incrementMs,
      },
      Date.now(),
    );

    if (!flagged) {
      return { ok: false as const, reason: "There's still time on that clock." };
    }

    const state = await finishInTx(
      tx,
      game,
      flagOutcome(position.fen, position.turn, game),
    );
    return { ok: true as const, state };
  });
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function lockActive(
  tx: Tx,
  gameId: number,
): Promise<typeof games.$inferSelect | { ok: false; reason: string }> {
  const rows = await tx
    .select()
    .from(games)
    .where(eq(games.id, gameId))
    .limit(1)
    .for("update");

  const game = rows[0];
  if (!game) return { ok: false, reason: "That game doesn't exist." };
  if (game.status !== "active") {
    return { ok: false, reason: "That game is already over." };
  }
  return game;
}

async function finishInTx(
  tx: Tx,
  game: typeof games.$inferSelect,
  ending: { result: Result; reason: ResultReason; winnerId: number | null },
): Promise<GameState> {
  const now = Date.now();

  // Freeze the clocks at the moment the game ended, so a finished game shows
  // what was left rather than continuing to drain.
  const position = rules.positionAfter(
    (
      await tx
        .select({ uci: gameMoves.uci })
        .from(gameMoves)
        .where(eq(gameMoves.gameId, game.id))
        .orderBy(asc(gameMoves.ply))
    ).map((move) => move.uci),
  );
  const frozen = clock.remaining(
    {
      whiteMs: game.whiteMs,
      blackMs: game.blackMs,
      clockStartedAt: game.clockStartedAt,
      turn: position.turn,
      initialMs: game.initialMs,
      incrementMs: game.incrementMs,
    },
    now,
  );

  await tx
    .update(games)
    .set({
      status: "finished",
      result: ending.result,
      resultReason: ending.reason,
      winnerId: ending.winnerId,
      whiteMs: frozen.whiteMs,
      blackMs: frozen.blackMs,
      drawOfferBy: null,
      finishedAt: new Date(now),
    })
    .where(eq(games.id, game.id));

  return reload(tx, game.id, now);
}

async function reload(tx: Tx, gameId: number, now: number): Promise<GameState> {
  const rows = await tx
    .select({
      game: games,
      whitePlayer: {
        id: sql<number>`w.id`,
        username: sql<string>`w.username`,
        displayName: sql<string>`w.display_name`,
        avatar: sql<string>`w.avatar`,
        role: sql<string>`w.role`,
      },
      blackPlayer: {
        id: sql<number>`b.id`,
        username: sql<string>`b.username`,
        displayName: sql<string>`b.display_name`,
        avatar: sql<string>`b.avatar`,
        role: sql<string>`b.role`,
      },
    })
    .from(games)
    .innerJoin(sql`users w`, sql`w.id = ${games.whiteId}`)
    .innerJoin(sql`users b`, sql`b.id = ${games.blackId}`)
    .where(eq(games.id, gameId))
    .limit(1);

  const moves = await tx
    .select({
      ply: gameMoves.ply,
      san: gameMoves.san,
      uci: gameMoves.uci,
      fenAfter: gameMoves.fenAfter,
      whiteMs: gameMoves.whiteMs,
      blackMs: gameMoves.blackMs,
    })
    .from(gameMoves)
    .where(eq(gameMoves.gameId, gameId))
    .orderBy(asc(gameMoves.ply));

  const row = rows[0];
  return assemble(row.game, row.whitePlayer, row.blackPlayer, moves, now);
}

export type GameSummary = {
  id: number;
  white: GamePlayer;
  black: GamePlayer;
  status: "active" | "finished";
  result: Result | null;
  resultReason: ResultReason | null;
  winnerId: number | null;
  ply: number;
  timeControl: string;
  startedAt: Date;
  finishedAt: Date | null;
};

function summaryQuery() {
  return db
    .select({
      id: games.id,
      status: games.status,
      result: games.result,
      resultReason: games.resultReason,
      winnerId: games.winnerId,
      ply: games.ply,
      initialMs: games.initialMs,
      incrementMs: games.incrementMs,
      startedAt: games.startedAt,
      finishedAt: games.finishedAt,
      whitePlayer: {
        id: sql<number>`w.id`,
        username: sql<string>`w.username`,
        displayName: sql<string>`w.display_name`,
        avatar: sql<string>`w.avatar`,
        role: sql<string>`w.role`,
      },
      blackPlayer: {
        id: sql<number>`b.id`,
        username: sql<string>`b.username`,
        displayName: sql<string>`b.display_name`,
        avatar: sql<string>`b.avatar`,
        role: sql<string>`b.role`,
      },
    })
    .from(games)
    .innerJoin(sql`users w`, sql`w.id = ${games.whiteId}`)
    .innerJoin(sql`users b`, sql`b.id = ${games.blackId}`);
}

type SummaryRow = Awaited<ReturnType<typeof summaryQuery>>[number];

function toSummary(row: SummaryRow): GameSummary {
  return {
    id: row.id,
    white: row.whitePlayer,
    black: row.blackPlayer,
    status: row.status === "active" ? "active" : "finished",
    result: (row.result as Result | null) ?? null,
    resultReason: (row.resultReason as ResultReason | null) ?? null,
    winnerId: row.winnerId,
    ply: row.ply,
    timeControl: describeTimeControl(row.initialMs, row.incrementMs),
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

/** Games being played right now — the clubhouse's "watch" list. */
export async function listActive(): Promise<GameSummary[]> {
  const rows = await summaryQuery()
    .where(eq(games.status, "active"))
    .orderBy(desc(games.id));
  return rows.map(toSummary);
}

/** Finished games, newest first. The club's game history. */
export async function listFinished(limit = 50): Promise<GameSummary[]> {
  const rows = await summaryQuery()
    .where(eq(games.status, "finished"))
    .orderBy(desc(games.id))
    .limit(limit);
  return rows.map(toSummary);
}

/** One member's games, active first then most recent. */
export async function listForUser(
  userId: number,
  limit = 30,
): Promise<GameSummary[]> {
  const rows = await summaryQuery()
    .where(or(eq(games.whiteId, userId), eq(games.blackId, userId)))
    // Unfinished games first, then most recent. `asc(finishedAt)` would put
    // them last: Postgres sorts NULLs last on ASC.
    .orderBy(sql`${games.finishedAt} is null desc`, desc(games.id))
    .limit(limit);
  return rows.map(toSummary);
}

/** A member's game that is still running, if they have one. */
export async function activeGameFor(userId: number): Promise<number | null> {
  const rows = await db
    .select({ id: games.id })
    .from(games)
    .where(
      and(
        eq(games.status, "active"),
        or(eq(games.whiteId, userId), eq(games.blackId, userId)),
      ),
    )
    .orderBy(desc(games.id))
    .limit(1);
  return rows[0]?.id ?? null;
}

/** The game as a PGN file. */
export async function toPgn(gameId: number): Promise<string | null> {
  const state = await get(gameId);
  if (!state) return null;

  return rules.toPgn({
    moves: state.moves.map((move) => move.uci),
    white: state.white.displayName,
    black: state.black.displayName,
    result: state.result,
    startedAt: state.startedAt,
    timeControl:
      state.initialMs === 0
        ? "-"
        : `${state.initialMs / 1000}+${state.incrementMs / 1000}`,
    reason: state.resultReason,
  });
}

/**
 * Games abandoned mid-play: still active, nobody has moved for a long time.
 * Not auto-resolved — a kid called to dinner should be able to come back — but
 * surfaced so the clubhouse doesn't advertise a game nobody is playing.
 */
export async function listStale(olderThanMinutes = 60): Promise<GameSummary[]> {
  const rows = await summaryQuery()
    .where(
      and(
        eq(games.status, "active"),
        isNull(games.finishedAt),
        sql`${games.clockStartedAt} < now() - (${olderThanMinutes} * interval '1 minute')`,
      ),
    )
    .orderBy(desc(games.id));
  return rows.map(toSummary);
}
