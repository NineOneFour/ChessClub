import { sql } from "drizzle-orm";
import { db } from "../db";
import { games } from "../db/schema";

/**
 * What a member's games add up to.
 *
 * All of it is derived on read. There is no stored tally to drift out of step
 * with the games table, and at eight members with a few games a day there is
 * nothing here worth caching — see the note on scale in CLAUDE.md.
 *
 * Ratings are not this: a rating is phase 4 and is built on Stockfish's view
 * of how well somebody actually played, not on who won. These are just the
 * results.
 */

export type PlayerRecord = {
  played: number;
  wins: number;
  losses: number;
  draws: number;
};

export type Rivalry = {
  opponent: {
    id: number;
    username: string;
    avatar: string;
    role: string;
  };
  played: number;
  /** Wins, losses and draws from the point of view of the member asked about. */
  wins: number;
  losses: number;
  draws: number;
};

/**
 * Only finished games count. An abandoned game left running would otherwise
 * sit in somebody's record forever as a game they neither won nor lost.
 */
const finishedGamesFor = (userId: number) =>
  sql`${games.status} = 'finished' and (${games.whiteId} = ${userId} or ${games.blackId} = ${userId})`;

/** A draw is `winner_id is null`, which is why it needs no separate column. */
export async function recordFor(userId: number): Promise<PlayerRecord> {
  const [row] = await db
    .select({
      played: sql<number>`count(*)::int`,
      wins: sql<number>`(count(*) filter (where ${games.winnerId} = ${userId}))::int`,
      losses: sql<number>`(count(*) filter (where ${games.winnerId} is not null and ${games.winnerId} <> ${userId}))::int`,
      draws: sql<number>`(count(*) filter (where ${games.winnerId} is null))::int`,
    })
    .from(games)
    .where(finishedGamesFor(userId));

  return row ?? { played: 0, wins: 0, losses: 0, draws: 0 };
}

/**
 * Everybody this member has finished a game against, most-played first.
 *
 * The head of the list is the person they play the most, which at this size is
 * the more interesting statistic: eight children in five families produce
 * rivalries, not a ladder.
 */
export async function rivalriesFor(userId: number): Promise<Rivalry[]> {
  const opponentId = sql`case when ${games.whiteId} = ${userId} then ${games.blackId} else ${games.whiteId} end`;

  const rows = await db
    .select({
      id: sql<number>`o.id`,
      username: sql<string>`o.username`,
      avatar: sql<string>`o.avatar`,
      role: sql<string>`o.role`,
      played: sql<number>`count(*)::int`,
      wins: sql<number>`(count(*) filter (where ${games.winnerId} = ${userId}))::int`,
      losses: sql<number>`(count(*) filter (where ${games.winnerId} = o.id))::int`,
      draws: sql<number>`(count(*) filter (where ${games.winnerId} is null))::int`,
    })
    .from(games)
    .innerJoin(sql`users o`, sql`o.id = ${opponentId}`)
    .where(finishedGamesFor(userId))
    .groupBy(sql`o.id, o.username, o.avatar, o.role`)
    .orderBy(sql`count(*) desc, o.username asc`);

  return rows.map((row) => ({
    opponent: {
      id: row.id,
      username: row.username,
      avatar: row.avatar,
      role: row.role,
    },
    played: row.played,
    wins: row.wins,
    losses: row.losses,
    draws: row.draws,
  }));
}

/**
 * How many games against one opponent before "they keep beating me" is a fact
 * rather than a bad afternoon. Three is low, but so is the number of games
 * anybody here has played, and the point is to notice a pattern early enough
 * to do something about it.
 */
export const NEMESIS_MIN_GAMES = 3;

/**
 * The opponent who beats this member most often, if there is one.
 *
 * Pure, and takes the list `rivalriesFor` already returned rather than asking
 * the database again. It wants a losing record over at least a few games, so
 * one unlucky game does not name somebody a nemesis; ties go to the bigger
 * deficit, then to the opponent played more often.
 */
export function nemesis(rivalries: Rivalry[]): Rivalry | null {
  const candidates = rivalries.filter(
    (r) => r.played >= NEMESIS_MIN_GAMES && r.losses > r.wins,
  );

  if (candidates.length === 0) return null;

  return candidates.reduce((worst, r) => {
    const deficit = r.losses - r.wins;
    const worstDeficit = worst.losses - worst.wins;
    if (deficit !== worstDeficit) return deficit > worstDeficit ? r : worst;
    return r.played > worst.played ? r : worst;
  });
}

/**
 * The opponent this member has played most, if they have played anybody.
 *
 * `rivalriesFor` is already ordered by games played, so this is its head — a
 * function rather than an index so the ordering stays one decision in one
 * place.
 */
export function mostPlayed(rivalries: Rivalry[]): Rivalry | null {
  return rivalries[0] ?? null;
}
