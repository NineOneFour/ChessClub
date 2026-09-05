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
      <p className="mt-4 text-base leading-relaxed text-ink-soft">
        Too short to judge — {performance.moves}{" "}
        {performance.moves === 1 ? "move" : "moves"} isn&apos;t enough to say how
        you played.
      </p>
    );
  }

  const slips = performance.mistakes + performance.inaccuracies;

  return (
    <div className="mt-4 border-l-2 border-brass pl-4 text-base leading-relaxed">
      You played this game at about{" "}
      <strong>{performance.rating}</strong> level.
      <p className="mt-1 font-mono text-xs text-ink-soft">
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
 *
 * Set at a full 1rem and given room to breathe: an eight-year-old is the
 * reader, and this is the one block on the page meant to be read rather than
 * glanced at.
 */
export function CoachSummary({ text }: { text: string }) {
  const { prose, tips } = coachParts(text);

  return (
    <div className="mt-4 border-l-2 border-rule pl-4">
      <p className="eyebrow text-xs">Coach</p>

      {prose.map((paragraph, index) => (
        <p key={index} className="mt-2 text-base leading-relaxed text-ink">
          {paragraph}
        </p>
      ))}

      {tips.length > 0 && (
        <>
          <p className="eyebrow mt-4 text-xs">To work on</p>
          <ul className="mt-2 space-y-2">
            {tips.map((tip, index) => (
              <li
                key={index}
                className="flex gap-2 text-base leading-relaxed text-ink"
              >
                <span aria-hidden className="text-brass">
                  ·
                </span>
                <span>{tip}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/**
 * Split the coach's one stored string into the opening paragraph(s) and the
 * tips — the prompt asks for prose, then one tip per line starting with "- ".
 *
 * A model that ignores the shape, or a summary stored before tips existed,
 * simply comes back as prose with no tips, which still reads correctly. That
 * is why this parses rather than the database storing two columns: the shape
 * is a request, not a guarantee.
 */
function coachParts(text: string): { prose: string[]; tips: string[] } {
  const prose: string[] = [];
  const tips: string[] = [];

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const bullet = /^[-*\u2022]\s+(.+)$/.exec(line);
    if (bullet) tips.push(bullet[1].trim());
    else prose.push(line);
  }

  return { prose, tips };
}

/**
 * What is still coming. A finished game is analysed by a separate worker and
 * coached after that, so there is a gap — a few seconds, or a few minutes for
 * a long game — where the honest thing to show is "this is being worked on"
 * rather than an empty space that gives no reason to wait.
 */
export function ReviewWaitingLine({
  stage,
  /** A spectator waits only for the score sheet; nothing here is about them. */
  forMe,
}: {
  stage: "engine" | "coach";
  forMe: boolean;
}) {
  const message =
    stage === "engine"
      ? forMe
        ? "The engine is going through your moves. This page will fill itself in — no need to reload."
        : "The engine is going through this game. The score sheet will colour itself in when it's done."
      : "Your coach is reading the engine's notes and writing to you now.";

  return (
    <p
      role="status"
      className="mt-4 border-l-2 border-rule pl-4 text-base leading-relaxed text-ink-soft"
    >
      {message}
    </p>
  );
}
