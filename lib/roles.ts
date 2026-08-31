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
