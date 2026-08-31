import { and, desc, eq, isNotNull, or, sql } from "drizzle-orm";
import { db } from "../db";
import {
  gameAnalysis,
  gameMoveAnalysis,
  gameMoves,
  games,
  type MoveQuality,
} from "../db/schema";
import {
  historyFrom,
  performanceFrom,
  strengthFrom,
  type GamePerformance,
  type RatedGame,
  type RatedMove,
  type Strength,
} from "../chess/rating";

/**
 * Playing strength, read from stored analysis.
 *
 * This service does the reading; `lib/chess/rating.ts` does the arithmetic and
 * holds every judgement. **Nothing is stored.** There is no ratings table and no
 * cached number: a rating is a query over `game_move_analysis`, so changing the
 * estimator changes every rating and every historical rating at once. That is
 * the brief's "store the underlying game analysis so historical ratings can be
 * recalculated as the algorithm improves", taken literally.
 *
 * At this club's size that is also just cheaper than the alternative. Twenty
 * games of forty moves is eight hundred rows.
 */

/**
 * One player's analysed moves in one game, newest games first.
 *
 * A player's moves are the odd plies if they were white and the even plies if
 * they were black. That is the only place colour enters the rating at all —
 * nothing here knows who won.
 */
async function ratedGamesFor(
  userId: number,
  limit: number,
): Promise<RatedGame[]> {
  const rows = await db
    .select({
      gameId: games.id,
      playedAt: games.finishedAt,
      isWhite: sql<boolean>`${games.whiteId} = ${userId}`,
      ply: gameMoveAnalysis.ply,
      lossCp: gameMoveAnalysis.lossCp,
      quality: gameMoveAnalysis.quality,
      bestUci: gameMoveAnalysis.bestUci,
      playedUci: gameMoves.uci,
    })
    .from(games)
    .innerJoin(gameAnalysis, eq(gameAnalysis.gameId, games.id))
    .innerJoin(gameMoveAnalysis, eq(gameMoveAnalysis.gameId, games.id))
    .innerJoin(
      gameMoves,
      and(
        eq(gameMoves.gameId, gameMoveAnalysis.gameId),
        eq(gameMoves.ply, gameMoveAnalysis.ply),
      ),
    )
    .where(
      and(
        eq(games.status, "finished"),
        eq(gameAnalysis.status, "done"),
        isNotNull(games.finishedAt),
        or(eq(games.whiteId, userId), eq(games.blackId, userId)),
      ),
    )
    .orderBy(desc(games.finishedAt), desc(games.id), gameMoveAnalysis.ply);

  // Group by game, keeping only this player's half-moves.
  const byGame = new Map<
    number,
    { playedAt: Date; moves: RatedMove[] }
  >();

  for (const row of rows) {
    const mine = row.isWhite ? row.ply % 2 === 1 : row.ply % 2 === 0;
    if (!mine) continue;

    const entry = byGame.get(row.gameId) ?? {
      playedAt: row.playedAt as Date,
      moves: [],
    };
    entry.moves.push({
      lossCp: row.lossCp,
      quality: row.quality as MoveQuality,
      wasBest: row.bestUci !== null && row.bestUci === row.playedUci,
    });
    byGame.set(row.gameId, entry);
  }

  return [...byGame.entries()]
    .slice(0, limit)
    .map(([gameId, entry]) => ({
      gameId,
      playedAt: entry.playedAt,
      performance: performanceFrom(entry.moves),
    }));
}

/**
 * How well this member has been playing lately, or null if no analysed game of
 * theirs has enough moves to say.
 */
export async function strengthFor(userId: number): Promise<Strength | null> {
  return strengthFrom(await ratedGamesFor(userId, 40));
}

export type GameRating = {
  gameId: number;
  playedAt: Date;
  performance: GamePerformance;
};

/** Recent games with what each was worth, newest first. */
export async function recentPerformances(
  userId: number,
  limit = 10,
): Promise<GameRating[]> {
  return ratedGamesFor(userId, limit);
}

/** The rating as it stood after each analysed game, oldest first. */
export async function historyFor(
  userId: number,
): Promise<{ gameId: number; playedAt: Date; rating: number }[]> {
  return historyFrom(await ratedGamesFor(userId, 40));
}

/**
 * One player's performance in one game.
 *
 * Returns null for a game that is not finished or not analysed — the same rule
 * as `analysis.forGame()`, and for the same reason: the engine's opinion is not
 * available during a live game.
 */
export async function performanceIn(
  gameId: number,
  userId: number,
): Promise<GamePerformance | null> {
  const [game] = await db
    .select({
      status: games.status,
      whiteId: games.whiteId,
      blackId: games.blackId,
      analysisStatus: gameAnalysis.status,
    })
    .from(games)
    .leftJoin(gameAnalysis, eq(gameAnalysis.gameId, games.id))
    .where(eq(games.id, gameId));

  if (!game || game.status !== "finished") return null;
  if (game.analysisStatus !== "done") return null;
  if (game.whiteId !== userId && game.blackId !== userId) return null;

  const isWhite = game.whiteId === userId;

  const rows = await db
    .select({
      ply: gameMoveAnalysis.ply,
      lossCp: gameMoveAnalysis.lossCp,
      quality: gameMoveAnalysis.quality,
      bestUci: gameMoveAnalysis.bestUci,
      playedUci: gameMoves.uci,
    })
    .from(gameMoveAnalysis)
    .innerJoin(
      gameMoves,
      and(
        eq(gameMoves.gameId, gameMoveAnalysis.gameId),
        eq(gameMoves.ply, gameMoveAnalysis.ply),
      ),
    )
    .where(eq(gameMoveAnalysis.gameId, gameId))
    .orderBy(gameMoveAnalysis.ply);

  const mine = rows.filter((row) =>
    isWhite ? row.ply % 2 === 1 : row.ply % 2 === 0,
  );

  return performanceFrom(
    mine.map((row) => ({
      lossCp: row.lossCp,
      quality: row.quality as MoveQuality,
      wasBest: row.bestUci !== null && row.bestUci === row.playedUci,
    })),
  );
}
