import type { MoveQuality } from "../db/schema/analysis";

/**
 * Turning what the engine said into what it means.
 *
 * Pure, and deliberately separate from both the engine adapter and the
 * database: these are judgements about children's chess, and the brief wants
 * the rating algorithm to evolve without the stored analysis having to change.
 * The engine reports scores; this module decides what counts as a blunder.
 *
 * One convention runs through everything here, and getting it wrong is the
 * classic way an analysis pipeline produces confident nonsense: **every score
 * is from the point of view of the player who moved.** Positive is good for
 * them, whichever colour they are.
 */

/** A raw UCI score: centipawns, or a distance to mate. */
export type EngineScore =
  | { kind: "cp"; cp: number }
  | { kind: "mate"; moves: number };

/**
 * Mate is worth more than any material, and a bigger number for a faster mate,
 * so that "mate in 1" beats "mate in 6" when comparing two positions.
 */
export const MATE_CP = 100_000;

/**
 * Evaluations are clamped to ±10 pawns before anything is subtracted.
 *
 * Without this, one bad move in a lost position produces a "loss" of thousands
 * of centipawns and dominates a child's average — but the game was already
 * gone, and the move barely mattered. Clamping is what makes average
 * centipawn loss mean "how much did your moves cost you" rather than "how
 * badly did you lose".
 */
export const EVAL_CLAMP_CP = 1_000;

/** A mate score as a centipawn number, signed and mate-distance aware. */
export function scoreToCp(score: EngineScore): number {
  if (score.kind === "cp") return score.cp;
  // A mate for us is huge and positive; being mated is huge and negative.
  const magnitude = MATE_CP - Math.abs(score.moves);
  return score.moves >= 0 ? magnitude : -magnitude;
}

/** Mate distance, or null for an ordinary evaluation. */
export function scoreToMate(score: EngineScore): number | null {
  return score.kind === "mate" ? score.moves : null;
}

/** Flip a score to the other player's point of view. */
export function flip(score: EngineScore): EngineScore {
  return score.kind === "cp"
    ? { kind: "cp", cp: -score.cp }
    : { kind: "mate", moves: -score.moves };
}

export function clampCp(cp: number): number {
  return Math.max(-EVAL_CLAMP_CP, Math.min(EVAL_CLAMP_CP, cp));
}

/**
 * What the played move cost, in clamped centipawns.
 *
 * Never negative: an engine searching one position to depth *n* and the next to
 * depth *n* can disagree by a few centipawns in the mover's favour, and a
 * "negative loss" would quietly credit a child for the engine's noise.
 */
export function lossCp(bestCp: number, playedCp: number): number {
  return Math.max(0, clampCp(bestCp) - clampCp(playedCp));
}

/**
 * Where a move sits, by what it cost.
 *
 * These thresholds are wider than a site grading masters. A seven-year-old who
 * drops 60 centipawns has played a reasonable move for a seven-year-old, and
 * telling them otherwise is how you produce a child who thinks they are bad at
 * chess. `blunder` starts at two pawns because that is roughly "you gave
 * something away" — the thing a child can see for themselves once it is pointed
 * out.
 *
 * `best` isn't on this ladder: it is reserved for actually matching the
 * engine's own choice (see `analyseMove`), not merely landing within a few
 * centipawns of it. A ladder tier here would mark every move in a quiet,
 * near-equal position "best", which waters the label down to meaninglessness
 * — a near-optimal move that wasn't the engine's pick is just `good`.
 */
export const QUALITY_THRESHOLDS: readonly {
  quality: MoveQuality;
  upTo: number;
}[] = [
  { quality: "good", upTo: 50 },
  { quality: "inaccuracy", upTo: 100 },
  { quality: "mistake", upTo: 200 },
  { quality: "blunder", upTo: Infinity },
] as const;

export function classifyLoss(loss: number): MoveQuality {
  for (const band of QUALITY_THRESHOLDS) {
    if (loss <= band.upTo) return band.quality;
  }
  return "blunder";
}

/**
 * One analysed half-move, as the worker produces it and the database stores it.
 */
export type AnalysedMove = {
  ply: number;
  evalBeforeCp: number;
  evalAfterCp: number;
  lossCp: number;
  bestUci: string | null;
  quality: MoveQuality;
  mateBefore: number | null;
  mateAfter: number | null;
};

/**
 * Assemble one half-move's analysis.
 *
 * `before` is the position the mover faced, scored from their side. `afterOther`
 * is the position they left, scored from the *opponent's* side — which is what
 * an engine always reports, because it scores the side to move. Flipping it here
 * rather than at the call site keeps the one convention in the one place.
 */
export function analyseMove(input: {
  ply: number;
  before: EngineScore;
  bestUci: string | null;
  afterOther: EngineScore;
  playedUci: string;
}): AnalysedMove {
  const after = flip(input.afterOther);

  const beforeCp = clampCp(scoreToCp(input.before));
  const afterCp = clampCp(scoreToCp(after));
  const loss = lossCp(scoreToCp(input.before), scoreToCp(after));

  // Playing the move the engine wanted is best by definition, whatever the
  // arithmetic says: at a fixed depth the two searches can disagree slightly,
  // and "your best move was an inaccuracy" is nonsense a child would notice.
  const playedBest =
    input.bestUci !== null && input.bestUci === input.playedUci;

  return {
    ply: input.ply,
    evalBeforeCp: beforeCp,
    evalAfterCp: afterCp,
    lossCp: playedBest ? 0 : loss,
    bestUci: input.bestUci,
    quality: playedBest ? "best" : classifyLoss(loss),
    mateBefore: scoreToMate(input.before),
    mateAfter: scoreToMate(after),
  };
}
