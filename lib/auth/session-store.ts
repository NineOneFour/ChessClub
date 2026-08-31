import { and, eq, gt, lt } from "drizzle-orm";
import { db } from "../db";
import { families, sessions, users } from "../db/schema";
import { hashToken } from "./tokens";

/**
 * Session storage, with no dependency on Next.js.
 *
 * The web tier reads the cookie via `next/headers` (see session.ts) and the
 * realtime service reads it off the WebSocket upgrade request; both resolve
 * the token through this one query, so there is a single definition of "who
 * is this". Keeping it Next-free is what lets the realtime service reuse it.
 */

export type SessionUser = {
  id: number;
  username: string;
  role: string;
  familyId: number | null;
  familyName: string | null;
  avatar: string;
  chatEnabled: boolean;
  gameChatEnabled: boolean;
  isMuted: boolean;
};

export async function findSessionUserByToken(
  token: string,
): Promise<SessionUser | null> {
  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      role: users.role,
      familyId: users.familyId,
      familyName: families.name,
      avatar: users.avatar,
      chatEnabled: users.chatEnabled,
      gameChatEnabled: users.gameChatEnabled,
      isMuted: users.isMuted,
      isActive: users.isActive,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .leftJoin(families, eq(families.id, users.familyId))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  const row = rows[0];
  // A disabled account resolves to nobody even while its session row lives,
  // so revoking access never waits on cleanup.
  if (!row || !row.isActive) return null;

  const { isActive, ...sessionUser } = row;
  void isActive;
  return sessionUser;
}

/** Pull one cookie out of a raw `Cookie:` header. */
export function readCookie(
  header: string | undefined,
  name: string,
): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

export async function insertSession(input: {
  tokenHash: string;
  userId: number;
  expiresAt: Date;
  userAgent: string | null;
}) {
  await db.insert(sessions).values(input);
}

export async function deleteSessionByTokenHash(tokenHash: string) {
  await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
}

/** Log a member out everywhere: disabling an account, or a password change. */
export async function deleteSessionsForUser(userId: number) {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

/** Housekeeping: drop expired rows. Called opportunistically on login. */
export async function pruneExpiredSessions() {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}
