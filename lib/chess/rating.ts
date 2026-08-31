import type { MoveQuality } from "../db/schema/analysis";

/**
 * "What rating level are you currently playing like?"
 *
 * The brief is emphatic that this is *not* opponent-based Elo: beating the same
 * weaker friend repeatedly must not push a number up for ever. So nothing here
 * looks at who won or who they were playing. It looks at the moves.
 *
 * Its own module, and pure, because the brief asks for exactly that: "the
 * rating estimator should be its own module/service so the algorithm can evolve
 * independently". **Nothing derived here is stored.** Every figure comes from
 * `game_move_analysis` on read, so changing a constant in this file changes
 * every rating and every historical rating at once, with no migration and no
 * stale column. That is the whole reason the analysis is stored per move.
 *
 * ## Honesty about the constants
 *
 * They are a first pass, fitted to nothing. There is no corpus of rated
 * children's games here to fit against — eight kids and a few games a day is the
 * corpus, and it is three games old. The curves below are shaped to agree
 * roughly with the published centipawn-loss folklore at the ends and to be
 * monotonic and smooth in between, and they are deliberately all in one place
 * with names, so that when there *are* two hundred real games the argument is
 * about numbers in this file rather than about code.
 *
 * Treat a rating from this as "about right, to the nearest hundred".
 */

/**
 * The band a rating can land in. The floor is not zero because a number like 60
 * would be a thing to feel bad about rather than a measurement, and the ceiling
 * is above anybody who will ever use this club.
 */
export const RATING_FLOOR = 300;
export const RATING_CEILING = 2900;

export function clampRating(rating: number): number {
  return Math.round(
    Math.max(RATING_FLOOR, Math.min(RATING_CEILING, rating)),
  );
}

/**
 * A game is only worth rating if the player actually played a game in it.
 *
 * The brief's list of games to be careful about — very short games, opening
 * traps, early resignations, opponent disconnects — are mostly this one
 * condition. Eight moves is not evidence about anybody's chess.
 */
export const MIN_RATED_MOVES = 8;

/** Games in the rolling sample. The brief suggests ten to twenty. */
export const SAMPLE_GAMES = 20;

/**
 * Below this many rated games the number is shown as provisional. Three is
 * enough to stop it swinging wildly and few enough that a child sees something
 * after an afternoon.
 */
export const PROVISIONAL_BELOW = 5;

/**
 * How fast older games stop mattering. 0.93 per game back, so the newest game
 * carries about 8% of a full sample — the brief's "recent games should carry
 * more weight" without letting one afternoon rewrite the number.
 */
export const RECENCY_DECAY = 0.93;

/**
 * A game gets its full say at this many rated moves and a proportionate say
 * below it. A twelve-move win tells you less than a forty-move grind.
 */
export const FULL_WEIGHT_MOVES = 25;

/**
 * With at least this many games in the sample, the best and worst are dropped
 * before averaging.
 *
 * This is what actually delivers the brief's "one unusually strong game should
 * not suddenly add hundreds of points" and "one terrible game should not
 * destroy a player's rating" — a weighted mean alone cannot, because the
 * newest game is also the heaviest. Trimming is blunt, but a child who plays
 * one brilliant game and one disaster in an afternoon should end the afternoon
 * roughly where they started.
 */
export const TRIM_ABOVE_GAMES = 6;

// --- the four signals ------------------------------------------------------

/**
 * Average centipawn loss, the workhorse — and the one the brief explicitly
 * warns against trusting alone: "do not assume that average centipawn loss
 * alone maps directly to player rating."
 *
 * An exponential decay through the folklore: ~20 acpl reads as club-strong,
 * ~100 as a beginner who mostly sees material, ~250 as somebody learning where
 * the pieces go.
 */
export const ACPL_SCALE = 100;

export function ratingFromAcpl(acpl: number): number {
  return clampRating(RATING_CEILING * Math.exp(-Math.max(0, acpl) / ACPL_SCALE));
}

/**
 * Blunders per hundred moves. A separate signal from centipawn loss because
 * they fail differently: a player can have a respectable average and still hand
 * over a piece once a game, and that one move is what is actually costing them
 * games.
 */
export const BLUNDER_SCALE = 12;

export function ratingFromBlunderRate(per100: number): number {
  return clampRating(
    2_600 * Math.exp(-Math.max(0, per100) / BLUNDER_SCALE),
  );
}

/**
 * Moves that were *not* good, per hundred: inaccuracies, mistakes and blunders
 * together. The quieter signal — how often a player is simply not finding the
 * move — and what separates somebody drifting from somebody playing.
 *
 * Blunders are counted here as well as in their own signal, and that is
 * deliberate. Counting only the middle grades rewarded a player whose bad moves
 * were *all* catastrophic: a game of thirty-three blunders and two mistakes
 * scored as "hardly ever slips", and the first real analysis rated random legal
 * moves at 548 because of it. A blunder is not a good move, so it belongs in
 * the count of moves that were not good.
 */
export const IMPRECISION_SCALE = 45;

export function ratingFromImprecisionRate(per100: number): number {
  return clampRating(
    2_500 * Math.exp(-Math.max(0, per100) / IMPRECISION_SCALE),
  );
}

/**
 * The share of moves that were the engine's own choice.
 *
 * Linear, and shallow on purpose: at the depth this club searches, matching the
 * engine a third of the time is respectable and matching it four fifths of the
 * time would be suspicious.
 */
export function ratingFromBestShare(share: number): number {
  const bounded = Math.max(0, Math.min(1, share));
  return clampRating(RATING_FLOOR + 2_800 * bounded);
}

/**
 * How much each signal counts. Centipawn loss leads because it uses every move;
 * best-move share is least trusted because it is the most sensitive to search
 * depth, and a club that changes depth should not see every rating move.
 */
export const SIGNAL_WEIGHTS = {
  acpl: 0.4,
  blunders: 0.3,
  imprecision: 0.15,
  bestShare: 0.15,
} as const;

// --- one game --------------------------------------------------------------

/** One player's analysed moves from one game. */
export type RatedMove = {
  lossCp: number;
  quality: MoveQuality;
  /** Whether the engine's choice and the played move were the same. */
  wasBest: boolean;
};

export type GamePerformance = {
  moves: number;
  /** Average centipawn loss over this player's moves. */
  acpl: number;
  blunders: number;
  mistakes: number;
  inaccuracies: number;
  /** Share of moves that were the engine's own choice, 0-1. */
  bestShare: number;
  /**
   * "You played this game at approximately this level." Null when there were
   * too few moves to say anything — see MIN_RATED_MOVES.
   */
  rating: number | null;
  /** What each signal thought, for showing the working. */
  signals: {
    acpl: number;
    blunders: number;
    imprecision: number;
    bestShare: number;
  } | null;
};

/**
 * Rate one player's play in one game.
 *
 * The brief's "individual games can still receive an estimated performance",
 * and the input to everything below.
 */
export function performanceFrom(moves: RatedMove[]): GamePerformance {
  const count = moves.length;

  const totals = moves.reduce(
    (acc, move) => ({
      loss: acc.loss + move.lossCp,
      blunders: acc.blunders + (move.quality === "blunder" ? 1 : 0),
      mistakes: acc.mistakes + (move.quality === "mistake" ? 1 : 0),
      inaccuracies: acc.inaccuracies + (move.quality === "inaccuracy" ? 1 : 0),
      best: acc.best + (move.wasBest ? 1 : 0),
    }),
    { loss: 0, blunders: 0, mistakes: 0, inaccuracies: 0, best: 0 },
  );

  const acpl = count === 0 ? 0 : totals.loss / count;
  const bestShare = count === 0 ? 0 : totals.best / count;

  const base = {
    moves: count,
    acpl: Math.round(acpl * 10) / 10,
    blunders: totals.blunders,
    mistakes: totals.mistakes,
    inaccuracies: totals.inaccuracies,
    bestShare: Math.round(bestShare * 1000) / 1000,
  };

  if (count < MIN_RATED_MOVES) {
    return { ...base, rating: null, signals: null };
  }

  const per100 = (n: number) => (n / count) * 100;

  const signals = {
    acpl: ratingFromAcpl(acpl),
    blunders: ratingFromBlunderRate(per100(totals.blunders)),
    imprecision: ratingFromImprecisionRate(
      per100(totals.inaccuracies + totals.mistakes + totals.blunders),
    ),
    bestShare: ratingFromBestShare(bestShare),
  };

  const rating = clampRating(
    signals.acpl * SIGNAL_WEIGHTS.acpl +
      signals.blunders * SIGNAL_WEIGHTS.blunders +
      signals.imprecision * SIGNAL_WEIGHTS.imprecision +
      signals.bestShare * SIGNAL_WEIGHTS.bestShare,
  );

  return { ...base, rating, signals };
}

// --- many games ------------------------------------------------------------

/** A rated game, newest first, as the estimator wants them. */
export type RatedGame = {
  gameId: number;
  playedAt: Date;
  performance: GamePerformance;
};

export type Strength = {
  rating: number;
  /** How many rated games went into it. */
  games: number;
  /** True while the sample is thin — show it as a guess, not a measurement. */
  provisional: boolean;
  /** The best and worst single performances in the sample, for context. */
  best: number;
  worst: number;
};

/**
 * Current estimated playing strength from a run of games, newest first.
 *
 * The brief's rating-stability list, in order: a rolling sample of at most
 * twenty; recent games weighted more; unusual games excluded by
 * MIN_RATED_MOVES; and the best and worst trimmed once there are enough games,
 * so neither a brilliancy nor a catastrophe moves the number by hundreds.
 *
 * Null when nothing in the sample was rateable at all, which is a different
 * thing from a low rating and should be shown differently.
 */
export function strengthFrom(games: RatedGame[]): Strength | null {
  const rated = games
    .filter((game) => game.performance.rating !== null)
    .slice(0, SAMPLE_GAMES);

  if (rated.length === 0) return null;

  const ratings = rated.map((game) => game.performance.rating as number);

  // Recency × length. Index 0 is the newest game.
  const weights = rated.map(
    (game, index) =>
      Math.pow(RECENCY_DECAY, index) *
      Math.min(1, game.performance.moves / FULL_WEIGHT_MOVES),
  );

  let indices = ratings.map((_, index) => index);

  if (rated.length >= TRIM_ABOVE_GAMES) {
    const byRating = [...indices].sort((a, b) => ratings[a] - ratings[b]);
    const dropped = new Set([byRating[0], byRating[byRating.length - 1]]);
    indices = indices.filter((index) => !dropped.has(index));
  }

  const totalWeight = indices.reduce((sum, index) => sum + weights[index], 0);

  // Every game shorter than a handful of moves can weigh almost nothing; fall
  // back to a plain mean rather than dividing by ~zero.
  const rating =
    totalWeight > 0
      ? indices.reduce(
          (sum, index) => sum + ratings[index] * weights[index],
          0,
        ) / totalWeight
      : ratings.reduce((sum, value) => sum + value, 0) / ratings.length;

  return {
    rating: clampRating(rating),
    games: rated.length,
    provisional: rated.length < PROVISIONAL_BELOW,
    best: Math.max(...ratings),
    worst: Math.min(...ratings),
  };
}

/**
 * The rating as it stood after each game, oldest first.
 *
 * Phase 3's "rating history", and it is a `map` rather than a table: the rating
 * after game *n* is just the estimator run over the games up to *n*. Nothing is
 * stored, so a change to the constants above redraws the whole history rather
 * than leaving a graph of what an older algorithm thought.
 */
export function historyFrom(
  games: RatedGame[],
): { gameId: number; playedAt: Date; rating: number }[] {
  // `games` arrives newest first; walk forwards through time.
  const oldestFirst = [...games].reverse();

  const points: { gameId: number; playedAt: Date; rating: number }[] = [];

  for (let index = 0; index < oldestFirst.length; index += 1) {
    const upTo = oldestFirst.slice(0, index + 1).reverse();
    const strength = strengthFrom(upTo);
    if (!strength) continue;

    points.push({
      gameId: oldestFirst[index].gameId,
      playedAt: oldestFirst[index].playedAt,
      rating: strength.rating,
    });
  }

  return points;
}
