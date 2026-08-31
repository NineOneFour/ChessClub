/**
 * Role helpers, kept in their own leaf module with no database imports so
 * client components can use them. `lib/services/users.ts` pulls in the
 * Postgres client and argon2; importing it from a Client Component would drag
 * both into the browser bundle.
 */

/**
 * Grown-ups are flagged wherever they appear next to the kids — in the roster,
 * in chat, and on their member card. The distinction is social, not a
 * permission: an administrator is somebody's parent too, so both roles carry
 * the same label.
 */
export function isGrownUp(role: string): boolean {
  return role !== "child";
}

/**
 * May `viewer` see `subject`'s real name?
 *
 * Yourself, always. Otherwise a grown-up looking at somebody in their own
 * family — which is how a parent sees their own children, and how the
 * administrator sees theirs. Nobody else, the administrator included: running
 * the club means knowing which *family* is using it, not what other people's
 * children are called. Everywhere else a member is their username.
 *
 * Both sides need a family for this to pass, so the administrator's null
 * family cannot match another account's null family.
 */
export function canSeeRealName(
  viewer: { id: number; role: string; familyId: number | null },
  subject: { id: number; familyId: number | null },
): boolean {
  if (viewer.id === subject.id) return true;
  if (!isGrownUp(viewer.role)) return false;
  return viewer.familyId !== null && viewer.familyId === subject.familyId;
}
