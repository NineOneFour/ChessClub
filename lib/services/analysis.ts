import { and, asc, eq, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "../db";
import {
  gameAnalysis,
  gameMoveAnalysis,
  games,
  type AnalysisStatus,
  type MoveQuality,
} from "../db/schema";
import type { AnalysedMove } from "../chess/evaluation";

/**
 * The analysis queue, and the analysis itself.
 *
 * The brief's shape, and the order matters: finishing a game must never wait
 * for Stockfish. So a finished game gets a `queued` row in the *same
 * transaction* that finishes it — a finished game is always a queued game, with
 * no sweeper to write and no window where one is the other — and the worker in
 * `analysis/` picks it up whenever it happens to be running. If the worker is
 * off for a week the club plays chess exactly as before and the queue is a week
 * long.
 *
 * Nothing here starts a process or knows what a blunder is. The worker owns the
 * engine; `lib/chess/evaluation.ts` owns the judgements.
 */

/** How many times a game is attempted before it is left alone. */
export const MAX_ATTEMPTS = 3;

/**
 * A `running` row older than this is assumed to be a worker that died, and goes
 * back in the queue. Generous: a long game at depth 16 is minutes of work.
 */
export const STALE_RUNNING_MINUTES = 30;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Queue a finished game, inside the transaction that finished it.
 *
 * `onConflictDoNothing` rather than an upsert: a game reaching this twice means
 * something odd happened upstream, and quietly re-queueing a finished analysis
 * would waste an engine run.
 */
export async function enqueueIn(tx: Tx, gameId: number): Promise<void> {
  await tx
    .insert(gameAnalysis)
    .values({ gameId, status: "queued" })
    .onConflictDoNothing();
}

/** Queue a game from outside a transaction — the backfill script's entry. */
export async function enqueue(gameId: number): Promise<void> {
  await db.transaction((tx) => enqueueIn(tx, gameId));
}

/**
 * Queue every finished game that has no analysis row.
 *
 * For a club whose games predate the worker, and after a schema change that
 * makes old analyses worth redoing. Returns how many were added.
 */
export async function enqueueMissing(): Promise<number> {
  const rows = await db
    .select({ id: games.id })
    .from(games)
    .leftJoin(gameAnalysis, eq(gameAnalysis.gameId, games.id))
    .where(and(eq(games.status, "finished"), sql`${gameAnalysis.gameId} is null`))
    .orderBy(asc(games.id));

  for (const row of rows) await enqueue(row.id);
  return rows.length;
}

/**
 * Claim the oldest queued game, or null if there is nothing to do.
 *
 * `for update skip locked` so two workers cannot take the same game — not
 * because this club will ever run two, but because the alternative is a
 * plausible-looking race that only shows up as duplicate work nobody notices.
 */
export async function claimNext(): Promise<number | null> {
  return db.transaction(async (tx) => {
    const rows = await tx.execute(sql`
      select game_id from game_analysis
      where status = 'queued' and attempts < ${MAX_ATTEMPTS}
      order by queued_at asc
      limit 1
      for update skip locked
    `);

    const gameId = (rows as unknown as { game_id: number }[])[0]?.game_id;
    if (gameId === undefined) return null;

    await tx
      .update(gameAnalysis)
      .set({
        status: "running",
        startedAt: new Date(),
        attempts: sql`${gameAnalysis.attempts} + 1`,
      })
      .where(eq(gameAnalysis.gameId, gameId));

    return gameId;
  });
}

/**
 * Store a completed analysis: the move rows and the engine that produced them.
 *
 * One transaction, and the move rows are deleted first, so a re-analysis at a
 * new depth replaces the old evidence rather than mixing two yardsticks in one
 * game.
 */
export async function recordSuccess(
  gameId: number,
  input: { engine: string; depth: number; moves: AnalysedMove[] },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(gameMoveAnalysis)
      .where(eq(gameMoveAnalysis.gameId, gameId));

    if (input.moves.length > 0) {
      await tx.insert(gameMoveAnalysis).values(
        input.moves.map((move) => ({ gameId, ...move })),
      );
    }

    await tx
      .update(gameAnalysis)
      .set({
        status: "done",
        engine: input.engine,
        depth: input.depth,
        error: null,
        finishedAt: new Date(),
      })
      .where(eq(gameAnalysis.gameId, gameId));
  });
}

/**
 * Record a failure. Back to `queued` while attempts remain, so a missing engine
 * or a machine that ran out of memory is retried; `failed` once they don't, so
 * one poisonous game cannot spin forever.
 */
export async function recordFailure(
  gameId: number,
  message: string,
): Promise<void> {
  const [row] = await db
    .select({ attempts: gameAnalysis.attempts })
    .from(gameAnalysis)
    .where(eq(gameAnalysis.gameId, gameId));

  const exhausted = (row?.attempts ?? MAX_ATTEMPTS) >= MAX_ATTEMPTS;

  await db
    .update(gameAnalysis)
    .set({
      status: exhausted ? "failed" : "queued",
      error: message.slice(0, 500),
      startedAt: null,
    })
    .where(eq(gameAnalysis.gameId, gameId));
}

/** Put crashed runs back in the queue. Called on worker startup. */
export async function requeueStale(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_RUNNING_MINUTES * 60_000);

  const rows = await db
    .update(gameAnalysis)
    .set({ status: "queued", startedAt: null })
    .where(
      and(
        eq(gameAnalysis.status, "running"),
        isNotNull(gameAnalysis.startedAt),
        lt(gameAnalysis.startedAt, cutoff),
      ),
    )
    .returning({ gameId: gameAnalysis.gameId });

  return rows.length;
}

export type QueueCounts = Record<AnalysisStatus, number>;

/** What the queue looks like, for the admin page and the worker's log. */
export async function queueCounts(): Promise<QueueCounts> {
  const rows = await db
    .select({
      status: gameAnalysis.status,
      count: sql<number>`count(*)::int`,
    })
    .from(gameAnalysis)
    .groupBy(gameAnalysis.status);

  const counts: QueueCounts = { queued: 0, running: 0, done: 0, failed: 0 };
  for (const row of rows) {
    if (row.status in counts) counts[row.status as AnalysisStatus] = row.count;
  }
  return counts;
}

export type MoveAnalysis = {
  ply: number;
  evalBeforeCp: number;
  evalAfterCp: number;
  lossCp: number;
  bestUci: string | null;
  quality: MoveQuality;
  mateBefore: number | null;
  mateAfter: number | null;
};

export type GameAnalysis = {
  gameId: number;
  status: AnalysisStatus;
  engine: string | null;
  depth: number | null;
  error: string | null;
  moves: MoveAnalysis[];
};

/**
 * One game's analysis.
 *
 * **Refuses an unfinished game**, and that is a rule rather than an
 * optimisation: the brief says players and spectators must not see Stockfish's
 * view during a live game, and the cheapest way to keep a promise like that is
 * to make the read impossible rather than to remember to check at each of the
 * places that might render it.
 */
export async function forGame(gameId: number): Promise<GameAnalysis | null> {
  const [game] = await db
    .select({ status: games.status })
    .from(games)
    .where(eq(games.id, gameId));

  if (!game || game.status !== "finished") return null;

  const [row] = await db
    .select({
      gameId: gameAnalysis.gameId,
      status: gameAnalysis.status,
      engine: gameAnalysis.engine,
      depth: gameAnalysis.depth,
      error: gameAnalysis.error,
    })
    .from(gameAnalysis)
    .where(eq(gameAnalysis.gameId, gameId));

  if (!row) return null;

  const moves = await db
    .select({
      ply: gameMoveAnalysis.ply,
      evalBeforeCp: gameMoveAnalysis.evalBeforeCp,
      evalAfterCp: gameMoveAnalysis.evalAfterCp,
      lossCp: gameMoveAnalysis.lossCp,
      bestUci: gameMoveAnalysis.bestUci,
      quality: gameMoveAnalysis.quality,
      mateBefore: gameMoveAnalysis.mateBefore,
      mateAfter: gameMoveAnalysis.mateAfter,
    })
    .from(gameMoveAnalysis)
    .where(eq(gameMoveAnalysis.gameId, gameId))
    .orderBy(asc(gameMoveAnalysis.ply));

  return {
    gameId: row.gameId,
    status: row.status as AnalysisStatus,
    engine: row.engine,
    depth: row.depth,
    error: row.error,
    moves: moves.map((move) => ({
      ...move,
      quality: move.quality as MoveQuality,
    })),
  };
}
