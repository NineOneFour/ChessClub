import "server-only";
import { cookies } from "next/headers";
import { generateToken, hashToken } from "./tokens";
import {
  deleteSessionByTokenHash,
  findSessionUserByToken,
  insertSession,
  type SessionUser,
} from "./session-store";
import { COOKIE_SECURE, SESSION_COOKIE, SESSION_TTL_DAYS } from "../config";

export type { SessionUser };

/**
 * Issue a session and set the cookie. Callable only from a Server Action or
 * Route Handler — Server Components may not write cookies.
 */
export async function createSession(userId: number, userAgent?: string | null) {
  const token = generateToken();
  const expiresAt = new Date(
    Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
  );

  await insertSession({
    tokenHash: hashToken(token),
    userId,
    expiresAt,
    userAgent: userAgent?.slice(0, 300) ?? null,
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

/** Resolve the current member from the session cookie, or null. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return findSessionUserByToken(token);
}

/** Drop the caller's own session and clear the cookie. */
export async function destroySession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await deleteSessionByTokenHash(hashToken(token));
  store.delete(SESSION_COOKIE);
}
