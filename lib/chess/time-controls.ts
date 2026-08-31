/**
 * The time controls on offer.
 *
 * Deliberately five, not a builder. A kid choosing a game should be picking
 * from a short menu, and "untimed" is first because a clock is the thing most
 * likely to put a seven-year-old off playing at all.
 */
export const TIME_CONTROLS = [
  {
    key: "untimed",
    label: "No clock",
    blurb: "Take as long as you like",
    initialMs: 0,
    incrementMs: 0,
  },
  {
    key: "15+10",
    label: "15 + 10",
    blurb: "Proper thinking time",
    initialMs: 15 * 60_000,
    incrementMs: 10_000,
  },
  {
    key: "10+0",
    label: "10 minutes",
    blurb: "A normal game",
    initialMs: 10 * 60_000,
    incrementMs: 0,
  },
  {
    key: "5+0",
    label: "5 minutes",
    blurb: "Quick",
    initialMs: 5 * 60_000,
    incrementMs: 0,
  },
  {
    key: "3+2",
    label: "3 + 2",
    blurb: "Very quick",
    initialMs: 3 * 60_000,
    incrementMs: 2_000,
  },
] as const;

export type TimeControlKey = (typeof TIME_CONTROLS)[number]["key"];
export type TimeControl = (typeof TIME_CONTROLS)[number];

const BY_KEY = new Map(TIME_CONTROLS.map((tc) => [tc.key, tc] as const));

export function isTimeControlKey(value: string): value is TimeControlKey {
  return BY_KEY.has(value as TimeControlKey);
}

export function timeControl(key: string): TimeControl | undefined {
  return BY_KEY.get(key as TimeControlKey);
}

/**
 * Describe a stored game's time control. Games keep milliseconds rather than a
 * key, so an old game still reads correctly if this menu changes.
 */
export function describeTimeControl(
  initialMs: number,
  incrementMs: number,
): string {
  if (initialMs === 0) return "No clock";
  const minutes = Math.round(initialMs / 60_000);
  if (incrementMs === 0) return `${minutes} min`;
  return `${minutes} + ${Math.round(incrementMs / 1000)}`;
}
