import { and, desc, eq, ne, or, sql } from "drizzle-orm";
import { db } from "../db";
import { challenges, users } from "../db/schema";
import { isTimeControlKey, timeControl } from "../chess/time-controls";
import { describeTimeControl } from "../chess/time-controls";
import { fail } from "../validation";
import * as games from "./games";

/**
 * Challenges.
 *
 * No matchmaking, no seek pool, no ratings-based pairing: you challenge
 * somebody you can see in the clubhouse, and they say yes or no. That is how
 * it works at a real club, and with a dozen members it is all that's needed.
 */

export const COLOR_CHOICES = ["random", "white", "black"] as const;
export type ColorChoice = (typeof COLOR_CHOICES)[number];

export type Challenge = {
  id: number;
  fromId: number;
  fromName: string;
  fromAvatar: string;
  fromUsername: string;
  toId: number;
  toName: string;
  toUsername: string;
  color: ColorChoice;
  timeControl: string;
  initialMs: number;
  incrementMs: number;
  createdAt: Date;
};

const challengeColumns = {
  id: challenges.id,
  fromId: challenges.fromId,
  fromName: sql<string>`f.display_name`,
  fromAvatar: sql<string>`f.avatar`,
  fromUsername: sql<string>`f.username`,
  toId: challenges.toId,
  toName: sql<string>`t.display_name`,
  toUsername: sql<string>`t.username`,
  color: challenges.color,
  initialMs: challenges.initialMs,
  incrementMs: challenges.incrementMs,
  createdAt: challenges.createdAt,
};

/** Does this error, or anything it wraps, mention `needle`? */
function mentions(err: unknown, needle: string): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    if (current.message.includes(needle)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function joined() {
  return db
    .select(challengeColumns)
    .from(challenges)
    .innerJoin(sql`users f`, sql`f.id = ${challenges.fromId}`)
    .innerJoin(sql`users t`, sql`t.id = ${challenges.toId}`);
}

type Row = Awaited<ReturnType<typeof joined>>[number];

function toChallenge(row: Row): Challenge {
  return {
    ...row,
    color: row.color as ColorChoice,
    timeControl: describeTimeControl(row.initialMs, row.incrementMs),
  };
}

/**
 * Issue a challenge. Refuses if either player is already in a game — one board
 * at a time keeps the clubhouse honest about who is available.
 */
export async function create(input: {
  fromId: number;
  toUsername: unknown;
  timeControlKey: unknown;
  color: unknown;
}): Promise<number> {
  const key = String(input.timeControlKey ?? "");
  if (!isTimeControlKey(key)) fail("Pick one of the time controls.");
  const control = timeControl(key)!;

  const colorRaw = String(input.color ?? "random");
  const color = (COLOR_CHOICES as readonly string[]).includes(colorRaw)
    ? (colorRaw as ColorChoice)
    : "random";

  const opponentRows = await db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(
      and(
        eq(users.username, String(input.toUsername ?? "").toLowerCase()),
        eq(users.isActive, true),
      ),
    )
    .limit(1);

  const opponent = opponentRows[0];
  if (!opponent) fail("That member isn't in the club.");
  if (opponent.id === input.fromId) fail("You can't challenge yourself.");

  if (await games.activeGameFor(input.fromId)) {
    fail("Finish the game you're in first.");
  }
  if (await games.activeGameFor(opponent.id)) {
    fail(`${opponent.displayName} is already playing.`);
  }

  try {
    const rows = await db
      .insert(challenges)
      .values({
        fromId: input.fromId,
        toId: opponent.id,
        initialMs: control.initialMs,
        incrementMs: control.incrementMs,
        color,
      })
      .returning({ id: challenges.id });
    return rows[0].id;
  } catch (err) {
    // The partial unique index on (from, to) where status = 'open'. Drizzle
    // wraps driver errors, so the constraint name is down the cause chain
    // rather than on the error itself.
    if (mentions(err, "challenges_open_pair_key")) {
      fail(`You've already challenged ${opponent.displayName}.`);
    }
    throw err;
  }
}

/** Challenges waiting for this member to answer. */
export async function listIncoming(userId: number): Promise<Challenge[]> {
  const rows = await joined()
    .where(and(eq(challenges.toId, userId), eq(challenges.status, "open")))
    .orderBy(desc(challenges.id));
  return rows.map(toChallenge);
}

/** Challenges this member has sent and is waiting on. */
export async function listOutgoing(userId: number): Promise<Challenge[]> {
  const rows = await joined()
    .where(and(eq(challenges.fromId, userId), eq(challenges.status, "open")))
    .orderBy(desc(challenges.id));
  return rows.map(toChallenge);
}

/**
 * Accept a challenge and start the game.
 *
 * One transaction: the challenge is claimed with a conditional update, so two
 * taps on the same challenge can't produce two games. Colours are decided here
 * — the only place `random` is resolved.
 */
export async function accept(
  challengeId: number,
  userId: number,
): Promise<number> {
  const claimed = await db
    .update(challenges)
    .set({ status: "accepted", resolvedAt: new Date() })
    .where(
      and(
        eq(challenges.id, challengeId),
        eq(challenges.toId, userId),
        eq(challenges.status, "open"),
      ),
    )
    .returning({
      id: challenges.id,
      fromId: challenges.fromId,
      toId: challenges.toId,
      color: challenges.color,
      initialMs: challenges.initialMs,
      incrementMs: challenges.incrementMs,
    });

  const challenge = claimed[0];
  if (!challenge) fail("That challenge is no longer open.");

  const challengerIsWhite =
    challenge.color === "white"
      ? true
      : challenge.color === "black"
        ? false
        : Math.random() < 0.5;

  let gameId: number;
  try {
    gameId = await games.create({
      whiteId: challengerIsWhite ? challenge.fromId : challenge.toId,
      blackId: challengerIsWhite ? challenge.toId : challenge.fromId,
      initialMs: challenge.initialMs,
      incrementMs: challenge.incrementMs,
    });
  } catch (err) {
    // Put the challenge back rather than losing it to a failed game creation.
    await db
      .update(challenges)
      .set({ status: "open", resolvedAt: null })
      .where(eq(challenges.id, challenge.id));
    throw err;
  }

  await db
    .update(challenges)
    .set({ gameId })
    .where(eq(challenges.id, challenge.id));

  // Any other open challenge involving either player is now moot.
  await db
    .update(challenges)
    .set({ status: "expired", resolvedAt: new Date() })
    .where(
      and(
        eq(challenges.status, "open"),
        ne(challenges.id, challenge.id),
        or(
          eq(challenges.fromId, challenge.fromId),
          eq(challenges.toId, challenge.fromId),
          eq(challenges.fromId, challenge.toId),
          eq(challenges.toId, challenge.toId),
        ),
      ),
    );

  return gameId;
}

/** Say no. Only the person challenged may decline. */
export async function decline(challengeId: number, userId: number) {
  const rows = await db
    .update(challenges)
    .set({ status: "declined", resolvedAt: new Date() })
    .where(
      and(
        eq(challenges.id, challengeId),
        eq(challenges.toId, userId),
        eq(challenges.status, "open"),
      ),
    )
    .returning({ id: challenges.id });
  if (!rows.length) fail("That challenge is no longer open.");
}

/** Take it back. Only the challenger may cancel. */
export async function cancel(challengeId: number, userId: number) {
  const rows = await db
    .update(challenges)
    .set({ status: "cancelled", resolvedAt: new Date() })
    .where(
      and(
        eq(challenges.id, challengeId),
        eq(challenges.fromId, userId),
        eq(challenges.status, "open"),
      ),
    )
    .returning({ id: challenges.id });
  if (!rows.length) fail("That challenge is no longer open.");
}

/**
 * The other party to an open challenge, from `viewerId`'s point of view.
 *
 * The realtime service calls this *before* resolving a challenge, so it knows
 * who else to notify — once accepted or declined the challenge is no longer
 * open and can't be found.
 */
export async function otherPartyId(
  challengeId: number,
  viewerId: number,
): Promise<number | null> {
  const rows = await db
    .select({ fromId: challenges.fromId, toId: challenges.toId })
    .from(challenges)
    .where(and(eq(challenges.id, challengeId), eq(challenges.status, "open")))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (row.fromId === viewerId) return row.toId;
  if (row.toId === viewerId) return row.fromId;
  return null;
}

/** Everyone with an open challenge in either direction, for the roster. */
export async function participantIds(): Promise<Set<number>> {
  const rows = await db
    .select({ fromId: challenges.fromId, toId: challenges.toId })
    .from(challenges)
    .where(eq(challenges.status, "open"));
  const ids = new Set<number>();
  for (const row of rows) {
    ids.add(row.fromId);
    ids.add(row.toId);
  }
  return ids;
}
