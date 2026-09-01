/**
 * Small hand-rolled validators. There is no schema library here on purpose:
 * the whole app has a handful of forms, and the neighbouring project keeps
 * its dependency list short too.
 */

export class ValidationError extends Error {}

export function fail(message: string): never {
  throw new ValidationError(message);
}

const USERNAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,23}$/;

/**
 * The case a member types is kept, so `Ellie` displays as `Ellie` — but it is
 * never the basis for identity: lookups and uniqueness go through
 * `usernameEquals()` in `lib/db/schema/users.ts`, which compares
 * case-insensitively, so `Ellie` and `ellie` are still the same login. Kids
 * will not remember which case they typed.
 */
export function normalizeUsername(raw: unknown): string {
  const value = String(raw ?? "").trim();
  if (!USERNAME_RE.test(value)) {
    fail(
      "Usernames must be 2-24 characters: letters, numbers, dashes and underscores, starting with a letter or number.",
    );
  }
  return value;
}

export function requireText(
  raw: unknown,
  field: string,
  { min = 1, max = 100 }: { min?: number; max?: number } = {},
): string {
  const value = String(raw ?? "").trim();
  if (value.length < min) fail(`${field} is required.`);
  if (value.length > max) fail(`${field} must be ${max} characters or fewer.`);
  return value;
}

export function optionalText(
  raw: unknown,
  field: string,
  max = 200,
): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  if (value.length > max) fail(`${field} must be ${max} characters or fewer.`);
  return value;
}

export function optionalEmail(raw: unknown): string | null {
  const value = optionalText(raw, "Email", 200);
  if (value === null) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    fail("That email doesn't look right.");
  }
  return value.toLowerCase();
}

export const MAX_CHAT_LENGTH = 500;

/**
 * Chat bodies: strip control characters (keeping tab and newline), collapse
 * runaway whitespace, cap the length. Output is rendered as text by React, so
 * HTML escaping is not our job here — this is about keeping the transcript
 * readable and the column bounded.
 */
export function cleanChatBody(raw: unknown): string {
  const value = String(raw ?? "")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/[ \t]{4,}/g, "   ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!value) fail("Message is empty.");
  if (value.length > MAX_CHAT_LENGTH) {
    fail(`Messages must be ${MAX_CHAT_LENGTH} characters or fewer.`);
  }
  return value;
}
