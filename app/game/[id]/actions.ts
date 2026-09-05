"use server";

import type { GamePerformance } from "@/lib/chess/rating";
import { requireUser } from "@/lib/auth/guards";
import * as analysisService from "@/lib/services/analysis";
import * as coach from "@/lib/services/coach";
import * as ratings from "@/lib/services/ratings";
import type { GameAnalysis } from "@/lib/services/analysis";
import { fail } from "@/lib/validation";

/**
 * Everything the game page learns about a finished game *after* it has
 * rendered.
 *
 * The board arrives over the socket, but Stockfish and the coach finish
 * minutes later and have nothing to do with the realtime process — putting
 * them on the socket would mean teaching the realtime service about the
 * analysis queue for the sake of two numbers a browser can simply ask for.
 * So the page asks, every few seconds, until there is nothing left to wait
 * for. See app/components/useGameReview.ts for when it stops asking.
 */
export type GameReview = {
  /** The viewer's own play. Null for a spectator or an unanalysed game. */
  performance: GamePerformance | null;
  /** Per-move quality for the score sheet — open to anyone reviewing. */
  analysis: GameAnalysis | null;
  /** The coach's text about the viewer's own game. Null until Groq is done. */
  coachSummary: string | null;
};

/**
 * The current review of one game, for whoever is asking. Same three reads,
 * with the same visibility rules, as the first render in page.tsx — the
 * services decide what a viewer may see, not the caller.
 */
export async function reviewOf(gameId: number): Promise<GameReview> {
  const me = await requireUser();
  if (!Number.isInteger(gameId)) fail("That isn't a game.");

  const [performance, analysis, coachSummary] = await Promise.all([
    ratings.performanceIn(gameId, me.id),
    analysisService.forGame(gameId),
    coach.summaryFor(gameId, me.id),
  ]);

  return { performance, analysis, coachSummary };
}
