/**
 * Clock arithmetic.
 *
 * Nothing here ticks. A game stores each side's remaining time *as it stood* at
 * `clockStartedAt`, and the player to move is spending wall-clock time since
 * then. Every reader — the server validating a move, a spectator's browser, the
 * flag watchdog — derives the live figure from those three numbers, so there is
 * no ticking value to get out of step and a reconnecting player sees exactly
 * what everyone else sees.
 *
 * Pure functions with the clock passed in, so the tests don't have to wait.
 */

export type ClockState = {
  whiteMs: number;
  blackMs: number;
  clockStartedAt: Date;
  /** Whose turn it is, and therefore whose clock is running. */
  turn: "white" | "black";
  initialMs: number;
  incrementMs: number;
};

export function isUntimed(state: { initialMs: number }): boolean {
  return state.initialMs === 0;
}

/**
 * Remaining time for both sides right now. For an untimed game both sides
 * always read zero and nothing should display them.
 */
export function remaining(
  state: ClockState,
  now: number,
): { whiteMs: number; blackMs: number } {
  if (isUntimed(state)) {
    return { whiteMs: 0, blackMs: 0 };
  }

  const spent = Math.max(0, now - state.clockStartedAt.getTime());
  return state.turn === "white"
    ? { whiteMs: Math.max(0, state.whiteMs - spent), blackMs: state.blackMs }
    : { whiteMs: state.whiteMs, blackMs: Math.max(0, state.blackMs - spent) };
}

/** Has the player to move run out of time? Always false when untimed. */
export function hasFlagged(state: ClockState, now: number): boolean {
  if (isUntimed(state)) return false;
  const left = remaining(state, now);
  return (state.turn === "white" ? left.whiteMs : left.blackMs) <= 0;
}

/** Milliseconds until the player to move flags, or null if they never will. */
export function msUntilFlag(state: ClockState, now: number): number | null {
  if (isUntimed(state)) return null;
  const left = remaining(state, now);
  return Math.max(0, state.turn === "white" ? left.whiteMs : left.blackMs);
}

/**
 * Apply a move to the clocks: deduct what the mover spent, then credit their
 * increment. Returns the values to store, with the clock now running for the
 * opponent.
 *
 * The increment is credited even on the move that takes a player to zero,
 * matching how a physical clock with delay behaves — you don't lose for
 * thinking exactly your remaining time and then pressing.
 */
export function applyMove(
  state: ClockState,
  now: number,
): { whiteMs: number; blackMs: number } {
  if (isUntimed(state)) {
    return { whiteMs: 0, blackMs: 0 };
  }

  const left = remaining(state, now);
  return state.turn === "white"
    ? { whiteMs: left.whiteMs + state.incrementMs, blackMs: left.blackMs }
    : { whiteMs: left.whiteMs, blackMs: left.blackMs + state.incrementMs };
}

/**
 * Format for display: `m:ss` normally, `m:ss.t` under ten seconds so a player
 * in trouble can see tenths, and `h:mm:ss` if a long game ever needs it.
 */
export function formatClock(ms: number): string {
  const clamped = Math.max(0, ms);
  const totalSeconds = clamped / 1000;

  if (clamped < 10_000) {
    return `0:${Math.floor(totalSeconds).toString().padStart(2, "0")}.${Math.floor(
      (clamped % 1000) / 100,
    )}`;
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
    : `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
