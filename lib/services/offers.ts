import { and, desc, eq, inArray, ne, or } from "drizzle-orm";
import { db } from "../db";
import { challenges, gameOffers, users } from "../db/schema";
import {
  describeTimeControl,
  isTimeControlKey,
  timeControl,
} from "../chess/time-controls";
import { fail } from "../validation";
import * as games from "./games";
import { COLOR_CHOICES, type ColorChoice } from "./challenges";
import * as usersService from "./users";

/**
 * Open offers — "I'll play anyone".
 *
 * A challenge names an opponent; an offer doesn't, and the first member to
 * accept gets the game. It exists because with eight kids the person you want
 * to play is often "whoever is here", and making them guess who is free is a
 * worse experience than putting a board out and waiting.
 *
 * Everything that makes a challenge safe applies here too: one open offer per
 * member, one game at a time, and accepting claims the row with a conditional
 * `UPDATE` so two taps at the same moment can only produce one game.
 */

export type Offer = {
  id: number;
  fromId: number;
  fromUsername: string;
  fromAvatar: string;
  fromRole: string;
  color: ColorChoice;
  timeControl: string;
  initialMs: number;
  incrementMs: number;
  createdAt: Date;
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

/**
 * Put a board out. Refused while you're playing, for the same reason a
 * challenge is: one game at a time keeps the clubhouse honest about who is
 * available.
 */
export async function create(input: {
  fromId: number;
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

  if (await games.activeGameFor(input.fromId)) {
    fail("Finish the game you're in first.");
  }
  await usersService.assertCanStartGame([input.fromId], input.fromId);

  try {
    const rows = await db
      .insert(gameOffers)
      .values({
        fromId: input.fromId,
        initialMs: control.initialMs,
        incrementMs: control.incrementMs,
        color,
      })
      .returning({ id: gameOffers.id });
    return rows[0].id;
  } catch (err) {
    // The partial unique index on (from) where status = 'open'. Drizzle wraps
    // driver errors, so the constraint name is down the cause chain.
    if (mentions(err, "game_offers_open_from_key")) {
      fail("Your board is already out.");
    }
    throw err;
  }
}

/** Every open offer, newest first. This list is public to the club. */
export async function listOpen(): Promise<Offer[]> {
  const rows = await db
    .select({
      id: gameOffers.id,
      fromId: gameOffers.fromId,
      fromUsername: users.username,
      fromAvatar: users.avatar,
      fromRole: users.role,
      color: gameOffers.color,
      initialMs: gameOffers.initialMs,
      incrementMs: gameOffers.incrementMs,
      createdAt: gameOffers.createdAt,
    })
    .from(gameOffers)
    .innerJoin(users, eq(users.id, gameOffers.fromId))
    .where(and(eq(gameOffers.status, "open"), eq(users.isActive, true)))
    .orderBy(desc(gameOffers.id));

  return rows.map((row) => ({
    ...row,
    color: row.color as ColorChoice,
    timeControl: describeTimeControl(row.initialMs, row.incrementMs),
  }));
}

/**
 * Accept somebody's offer and start the game.
 *
 * The conditional `UPDATE` is the whole race protection: whoever's statement
 * lands first claims the row, and everyone else is told it's gone. Colours are
 * resolved here from the offerer's point of view, mirroring
 * `challenges.accept()`.
 */
export async function accept(
  offerId: number,
  userId: number,
): Promise<number> {
  if (await games.activeGameFor(userId)) {
    fail("Finish the game you're in first.");
  }
  // Checked here only for the wording; the `ne` below is what actually stops
  // it, race or no race.
  const owner = await offererId(offerId);
  if (owner === userId) {
    fail("That's your own board. Wait for somebody to sit down.");
  }
  if (owner !== null) {
    await usersService.assertCanStartGame([userId, owner], userId);
  }

  const claimed = await db
    .update(gameOffers)
    .set({ status: "accepted", resolvedAt: new Date() })
    .where(
      and(
        eq(gameOffers.id, offerId),
        eq(gameOffers.status, "open"),
        // Not your own board.
        ne(gameOffers.fromId, userId),
      ),
    )
    .returning({
      id: gameOffers.id,
      fromId: gameOffers.fromId,
      color: gameOffers.color,
      initialMs: gameOffers.initialMs,
      incrementMs: gameOffers.incrementMs,
    });

  const offer = claimed[0];
  if (!offer) fail("That game has already been taken.");

  const offererIsWhite =
    offer.color === "white"
      ? true
      : offer.color === "black"
        ? false
        : Math.random() < 0.5;

  let gameId: number;
  try {
    gameId = await games.create({
      whiteId: offererIsWhite ? offer.fromId : userId,
      blackId: offererIsWhite ? userId : offer.fromId,
      initialMs: offer.initialMs,
      incrementMs: offer.incrementMs,
    });
  } catch (err) {
    // Put the board back rather than losing it to a failed game creation.
    await db
      .update(gameOffers)
      .set({ status: "open", resolvedAt: null })
      .where(eq(gameOffers.id, offer.id));
    throw err;
  }

  await db
    .update(gameOffers)
    .set({ gameId })
    .where(eq(gameOffers.id, offer.id));

  await expireInvolving([offer.fromId, userId], offer.id);

  return gameId;
}

/**
 * Who put this board out, while the offer is still open.
 *
 * The realtime service calls this *before* accepting, so it knows who else to
 * send to the board — once accepted the offer is no longer open and can't be
 * found.
 */
export async function offererId(offerId: number): Promise<number | null> {
  const rows = await db
    .select({ fromId: gameOffers.fromId })
    .from(gameOffers)
    .where(and(eq(gameOffers.id, offerId), eq(gameOffers.status, "open")))
    .limit(1);
  return rows[0]?.fromId ?? null;
}

/** Take the board away again. Only the member who put it out may. */
export async function cancel(offerId: number, userId: number) {
  const rows = await db
    .update(gameOffers)
    .set({ status: "cancelled", resolvedAt: new Date() })
    .where(
      and(
        eq(gameOffers.id, offerId),
        eq(gameOffers.fromId, userId),
        eq(gameOffers.status, "open"),
      ),
    )
    .returning({ id: gameOffers.id });
  if (!rows.length) fail("That offer is no longer open.");
}

/**
 * Everything either player had outstanding is now moot: their other offers and
 * every open challenge in either direction.
 */
async function expireInvolving(userIds: number[], keepOfferId: number) {
  const now = new Date();

  await db
    .update(gameOffers)
    .set({ status: "expired", resolvedAt: now })
    .where(
      and(
        eq(gameOffers.status, "open"),
        ne(gameOffers.id, keepOfferId),
        inArray(gameOffers.fromId, userIds),
      ),
    );

  await db
    .update(challenges)
    .set({ status: "expired", resolvedAt: now })
    .where(
      and(
        eq(challenges.status, "open"),
        or(
          inArray(challenges.fromId, userIds),
          inArray(challenges.toId, userIds),
        ),
      ),
    );
}

/**
 * Withdraw a member's open offer because they've left the room.
 *
 * The realtime service calls this when a member's last socket closes: an offer
 * from somebody who isn't here would start a game against an empty chair.
 * Returns true if anything was actually withdrawn, so the caller knows whether
 * the list needs republishing.
 */
export async function expireFor(userId: number): Promise<boolean> {
  const rows = await db
    .update(gameOffers)
    .set({ status: "expired", resolvedAt: new Date() })
    .where(and(eq(gameOffers.fromId, userId), eq(gameOffers.status, "open")))
    .returning({ id: gameOffers.id });
  return rows.length > 0;
}

/**
 * Clear the board on startup. Nobody is connected yet, so by the rule above no
 * open offer can be genuine.
 */
export async function expireAll() {
  await db
    .update(gameOffers)
    .set({ status: "expired", resolvedAt: new Date() })
    .where(eq(gameOffers.status, "open"));
}
