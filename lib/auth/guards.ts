import "server-only";
import { notFound, redirect } from "next/navigation";
import { getSessionUser, type SessionUser } from "./session";

/**
 * Authorization lives here, not in `proxy.ts`.
 *
 * Proxy runs before rendering and may be hoisted to a CDN, so it can't be
 * trusted with database-backed session checks. Every page, layout and Server
 * Action that touches member data calls one of these guards instead. Server
 * Actions are reachable by direct POST, so "the UI doesn't show the button"
 * is never a control.
 *
 * Authorization failures answer 404 rather than 403. `forbidden()` is still
 * experimental in Next 16 (needs `experimental.authInterrupts`), and for a
 * private club a 404 is also the better answer: it doesn't confirm to a
 * logged-in child that an admin route exists.
 */

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "admin") notFound();
  return user;
}

/** Parents and the administrator can both reach parent-facing screens. */
export async function requireParent(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "parent" && user.role !== "admin") notFound();
  return user;
}

/**
 * A parent may only act on children in their own family. The administrator
 * may act on anyone.
 */
export function assertManages(
  actor: SessionUser,
  child: { role: string; familyId: number | null },
) {
  if (actor.role === "admin") return;
  if (
    actor.role === "parent" &&
    child.role === "child" &&
    child.familyId !== null &&
    child.familyId === actor.familyId
  ) {
    return;
  }
  notFound();
}
