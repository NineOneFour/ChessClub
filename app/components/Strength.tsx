import type { GamePerformance } from "@/lib/chess/rating";
import type { Strength } from "@/lib/chess/rating";

/**
 * Estimated playing strength.
 *
 * Not Elo, and the panel says so, because the difference is the point: this is
 * "what level are you playing like", read from what Stockfish made of your
 * moves. Beating the same friend twenty times does not move it.
 *
 * It is shown to the nearest whole number because a rating with a decimal point
 * would claim a precision this does not have — and marked *provisional* while
 * the sample is thin, so a child is not told a number and then watched it change
 * by three hundred points next week without explanation.
 */
export function StrengthPanel({
  strength,
  empty,
}: {
  strength: Strength | null;
  empty: string;
}) {
  if (!strength) {
    return <p className="text-sm text-ink-soft">{empty}</p>;
  }

  return (
    <div className="sheet p-5">
      <p className="masthead text-4xl">
        {strength.rating}
        {strength.provisional && (
          <span className="ml-2 align-middle font-mono text-[0.65rem] text-brass">
            provisional
          </span>
        )}
      </p>
      <p className="eyebrow mt-1">estimated playing strength</p>

      <p className="mt-3 text-sm text-ink-soft">
        From how well you played your last{" "}
        {strength.games === 1 ? "game" : `${strength.games} games`}, not from who
        you beat. Your best single game was about{" "}
        <strong className="text-ink">{strength.best}</strong>
        {strength.worst !== strength.best && (
          <>
            {" "}
            and your quietest about{" "}
            <strong className="text-ink">{strength.worst}</strong>
          </>
        )}
        .
      </p>

      {strength.provisional && (
        <p className="mt-2 border-l-2 border-brass pl-3 text-xs text-ink-soft">
          Still settling. It needs a few more games before it means much.
        </p>
      )}
    </div>
  );
}

/**
 * One game's performance, in the sentence the brief asks for.
 *
 * Shown only to the two players, and only once the game is over — the engine's
 * opinion is never available while a game is being played.
 */
export function PerformanceLine({
  performance,
}: {
  performance: GamePerformance;
}) {
  if (performance.rating === null) {
    return (
      <p className="mt-3 text-sm text-ink-soft">
        Too short to judge — {performance.moves}{" "}
        {performance.moves === 1 ? "move" : "moves"} isn&apos;t enough to say how
        you played.
      </p>
    );
  }

  const slips = performance.mistakes + performance.inaccuracies;

  return (
    <div className="mt-3 border-l-2 border-brass pl-3 text-sm">
      You played this game at about{" "}
      <strong>{performance.rating}</strong> level.
      <p className="mt-1 font-mono text-[0.65rem] text-ink-soft">
        {performance.acpl} average loss ·{" "}
        {performance.blunders === 0
          ? "no blunders"
          : `${performance.blunders} blunder${performance.blunders === 1 ? "" : "s"}`}
        {slips > 0 && ` · ${slips} slip${slips === 1 ? "" : "s"}`} ·{" "}
        {Math.round(performance.bestShare * 100)}% the engine&apos;s own move
      </p>
    </div>
  );
}

/**
 * The AI coach's plain-language take on this player's own game — Groq's
 * explanation of what the numbers above mean, not a second opinion on them.
 * Shown only once it exists; a game can be fully analysed with no coaching
 * text yet (Groq unconfigured, or not yet its turn in the worker's queue).
 */
export function CoachSummaryLine({ text }: { text: string }) {
  return (
    <div className="mt-3 border-l-2 border-rule pl-3 text-sm">
      <p className="eyebrow text-xs">Coach</p>
      <p className="mt-1 text-ink-soft">{text}</p>
    </div>
  );
}
