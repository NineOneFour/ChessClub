"use client";

import { useEffect, useState } from "react";
import { reviewOf, type GameReview } from "@/app/game/[id]/actions";

/**
 * Keeps a finished game's assessment up to date without a page reload.
 *
 * A game finishes, and only then does the analysis worker pick it up: several
 * seconds for a short game, a few minutes for a long one at depth, and the
 * coach's text after that. Before this, all of it appeared only on the next
 * reload — you finished a game, were told nothing, and had to know to press
 * F5. Now the page asks for itself.
 *
 * It polls rather than listening for the same reason the worker does (see
 * analysis/worker.ts): at this club's size a few asks are indistinguishable
 * from a notification, and there is no LISTEN/NOTIFY plumbing to get wrong.
 * The gap grows so a browser left open on an old game isn't asking every four
 * seconds an hour later, and it gives up eventually — coaching is optional
 * (no GROQ_API_KEY means no summary, ever) so "wait until it arrives" would
 * be waiting forever.
 */

const FIRST_GAP_MS = 4_000;
const LONGEST_GAP_MS = 30_000;
const GAP_GROWTH = 1.4;
/** About a quarter of an hour of asking, which outlasts any game this club will play. */
const MAX_ASKS = 40;

function gapAfter(asks: number): number {
  return Math.min(FIRST_GAP_MS * GAP_GROWTH ** asks, LONGEST_GAP_MS);
}

/**
 * Whether anything is still expected.
 *
 * `asked` is the awkward but load-bearing part: no analysis row *at all* means
 * one thing on the page's first render (the game may still have been live) and
 * the opposite in a poll's answer. A finished game's row is written in the same
 * transaction that finishes it, so a poll that finds none has found a game from
 * before the queue existed, and waiting on it is waiting on nothing.
 *
 * A failed analysis is also settled — the worker recorded a failure and nothing
 * more is coming — and a spectator only ever waits for the score sheet, never
 * for a performance or a summary that isn't theirs to see.
 */
function settled(review: GameReview, isPlayer: boolean, asked: boolean): boolean {
  const status = review.analysis?.status;
  if (status === undefined) return asked;
  if (status === "failed") return true;
  if (status !== "done") return false;
  if (!isPlayer) return true;
  return review.performance !== null && review.coachSummary !== null;
}

export type GameReviewState = {
  review: GameReview;
  /** True while more is still expected — the UI says so rather than showing nothing. */
  waiting: boolean;
};

export function useGameReview(
  gameId: number,
  /** Nothing is analysed until the game is over, so nothing is asked either. */
  finished: boolean,
  isPlayer: boolean,
  initial: GameReview,
): GameReviewState {
  /** The most recent answer, or null while the server render is all there is. */
  const [answer, setAnswer] = useState<GameReview | null>(null);
  /** Set once the asking has gone on long enough. Never unset — a reload restarts it. */
  const [gaveUp, setGaveUp] = useState(false);

  const review = answer ?? initial;
  const done = settled(review, isPlayer, answer !== null);
  const waiting = finished && !done && !gaveUp;

  useEffect(() => {
    if (!waiting) return;

    let cancelled = false;
    let asks = 0;
    let timer: ReturnType<typeof setTimeout>;

    const ask = async () => {
      try {
        const next = await reviewOf(gameId);
        if (cancelled) return;
        setAnswer(next);
        // Settling tears this loop down through `waiting` on the next render;
        // stopping here as well keeps one last timer from being scheduled.
        if (settled(next, isPlayer, true)) return;
      } catch {
        // A failed ask is a dropped network or a slept laptop, not something
        // to put in front of a child. Try again on the next gap.
      }
      if (cancelled) return;
      asks += 1;
      if (asks >= MAX_ASKS) {
        setGaveUp(true);
        return;
      }
      timer = setTimeout(ask, gapAfter(asks));
    };

    timer = setTimeout(ask, gapAfter(asks));
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [gameId, waiting, isPlayer]);

  return { review, waiting };
}
