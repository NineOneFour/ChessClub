import { eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { presence, users } from "../db/schema";

/**
 * Presence is owned by the realtime service, which is the only writer. The web
 * tier reads it for the first server render; after that the browser gets live
 * updates over the socket.
 */

/** Set the live connection count for one member. */
export async function setConnections(userId: number, connections: number) {
  await db
    .insert(presence)
    .values({ userId, connections, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: presence.userId,
      set: { connections, updatedAt: new Date() },
    });
}

/**
 * Bump `updated_at` for everyone currently connected. Without this the
 * freshness check in lib/services/users.ts would eventually mark a
 * long-connected member offline.
 */
export async function heartbeat(userIds: number[]) {
  if (!userIds.length) return;
  await db
    .update(presence)
    .set({ updatedAt: new Date() })
    .where(inArray(presence.userId, userIds));
}

/**
 * Called when the realtime service starts. Any counts left behind by a
 * previous process are lies, so clear them.
 */
export async function resetAll() {
  await db.update(presence).set({ connections: 0, updatedAt: new Date() });
}

export async function markLastSeen(userId: number) {
  await db
    .update(users)
    .set({ lastSeenAt: new Date() })
    .where(eq(users.id, userId));
}
