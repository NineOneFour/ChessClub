/**
 * Playing hours.
 *
 * A parent may say when a child is allowed to *start* a game. The window is
 * two integers, minutes from local midnight, and both null means no window at
 * all — which is how every account starts and how most will stay.
 *
 * Three decisions worth knowing:
 *
 * - **A window that ends before it starts spans midnight.** 22:00 to 07:00 is
 *   one row, not two, and "no chess after bedtime" is the obvious thing a
 *   parent will want to write.
 * - **It gates starting a game, never a game in progress.** Closing time
 *   arriving mid-game does not resign it, flag it or kick anybody out of the
 *   room. A child losing a game they were winning because the clock struck
 *   eight would be a worse thing than a late finish, and the brief's first
 *   principle is fun.
 * - **Server local time.** The club is one group of families in one place, and
 *   a timezone column would be a setting nobody would ever set correctly. If
 *   the club ever spans timezones this is the thing to revisit.
 *
 * A pure leaf module: no database, no Next.js. The services import it, and so
 * does the settings UI, which needs to render the same window a parent typed.
 */

export const MINUTES_IN_DAY = 24 * 60;

export type PlayWindow = {
  fromMinute: number | null;
  toMinute: number | null;
};

/** Is a window actually set? Half a window is not a window. */
export function hasWindow(window: PlayWindow): boolean {
  return window.fromMinute !== null && window.toMinute !== null;
}

/**
 * Is this member allowed to start a game at `at`?
 *
 * `true` whenever no window is set, which keeps every call site free of
 * "unless they have playing hours, in which case…".
 */
export function isWithinPlayWindow(
  window: PlayWindow,
  at: Date = new Date(),
): boolean {
  if (!hasWindow(window)) return true;

  const from = window.fromMinute as number;
  const to = window.toMinute as number;
  const now = at.getHours() * 60 + at.getMinutes();

  // A window that wraps past midnight is the two ends of the day.
  return from <= to ? now >= from && now < to : now >= from || now < to;
}

/** `16 * 60 + 30` → `"16:30"`, for a form field and for a sentence. */
export function formatMinute(minute: number): string {
  const hours = Math.floor(minute / 60) % 24;
  const minutes = minute % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * `"16:30"` → `16 * 60 + 30`, or null for anything that isn't a time of day.
 * An empty string is null rather than an error: clearing both fields is how a
 * parent removes the window.
 */
export function parseMinute(raw: unknown): number | null {
  const value = String(raw ?? "").trim();
  if (value === "") return null;

  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;

  return hours * 60 + minutes;
}

/** The window as a sentence, for the family page and for a refusal. */
export function describeWindow(window: PlayWindow): string {
  if (!hasWindow(window)) return "any time";

  const from = formatMinute(window.fromMinute as number);
  const to = formatMinute(window.toMinute as number);
  return `${from} to ${to}`;
}
