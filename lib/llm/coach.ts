import { and, asc, eq } from "drizzle-orm";
import { db } from "../db";
import { gameMoveAnalysis, gameMoves } from "../db/schema";
import * as games from "../services/games";
import { performanceIn } from "../services/ratings";
import type { GamePerformance } from "../chess/rating";
import type { MoveQuality } from "../db/schema";
import { sanForUci } from "../chess/rules";
import { complete } from "./groq";

/**
 * Turns Stockfish's already-computed judgement of one player's game into a
 * prompt for Groq, and gets the coaching text back. Stockfish determined
 * what happened (performanceIn, the move grades); this module only explains
 * it and says what to practise next — see the "AI Chess Coach" section of
 * the project brief.
 *
 * The reply is one string, and its shape matters to the UI: a short prose
 * paragraph, then one tip per line starting with "- ". App/components/Strength.tsx
 * splits it back apart on exactly that. Prose-only text from before tips
 * existed still renders — it simply has no tips to show.
 */

const WORST_MOVES = 3;
// This codebase's own "good" threshold (lib/chess/evaluation.ts's
// classifyLoss) — below this a move isn't a genuine mistake, and describing
// it to the LLM as "costly" invites it to invent a plausible-sounding reason
// for a move that wasn't actually wrong.
const MIN_NOTABLE_LOSS_CP = 50;
const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export const COACH_SYSTEM_PROMPT = `
You are a friendly chess coach writing directly to a child, aged 8 to 13, \
about a chess game they just finished at a small private chess club for \
kids and their friends. A chess engine (Stockfish) has already analysed the \
game; your only job is to explain its findings in warm, simple, encouraging \
language a child that age can read and act on, and to tell them what to do \
differently next time.

Write your answer in exactly this shape, and nothing else:
- First, two or three sentences of ordinary prose: how the game went, and \
one real thing from the data below that they did well.
- Then two or three tips, each on its own line, each starting with "- " (a \
hyphen and a space). A tip names one specific thing that went wrong in this \
game — the move number, the move, and roughly what it cost — and then one \
small, concrete habit that would have caught it next time, such as "before \
you move, check which of your pieces your opponent can take". Make the habit \
something they can actually do at the board, never "play better" or "study \
more".
- If no costly moves were found, say plainly that nothing went badly wrong, \
and give two tips about habits that keep a game clean anyway.

Rules you must follow:
- Never contradict or change any number, result, or move given to you in \
the message below — those come directly from the chess engine and are \
always correct.
- Never invent details (piece names, tactics, reasons) beyond what is given \
to you. If you describe why a costly move went badly, hedge it ("it looks \
like...", "that may have let...") rather than stating it as settled fact. \
The move the engine preferred is given to you where one is known; you may \
name it, but do not explain what would have happened after it.
- Plain language throughout: explain any chess word you use in the same \
breath. No headings, no bold, no numbered lists, no markdown beyond the \
"- " that starts each tip. Do not repeat the raw statistics back as a list.
- Be specific and encouraging, never harsh: this is a child reading about \
their own game, and a mistake is a thing to fix, not a thing to feel bad \
about.
`.trim();

type WorstMove = {
  ply: number;
  san: string;
  lossCp: number;
  quality: MoveQuality;
  /** What the engine wanted instead, in notation, when it recorded one. */
  bestSan: string | null;
  fenBefore: string;
  fenAfter: string;
};

async function worstMoves(gameId: number, isWhite: boolean): Promise<WorstMove[]> {
  const rows = await db
    .select({
      ply: gameMoves.ply,
      san: gameMoves.san,
      fenAfter: gameMoves.fenAfter,
      lossCp: gameMoveAnalysis.lossCp,
      quality: gameMoveAnalysis.quality,
      bestUci: gameMoveAnalysis.bestUci,
    })
    .from(gameMoves)
    .innerJoin(
      gameMoveAnalysis,
      and(eq(gameMoveAnalysis.gameId, gameMoves.gameId), eq(gameMoveAnalysis.ply, gameMoves.ply)),
    )
    .where(eq(gameMoves.gameId, gameId))
    .orderBy(asc(gameMoves.ply));

  const fenBefore = (ply: number): string =>
    ply === 1 ? START_FEN : rows.find((r) => r.ply === ply - 1)?.fenAfter ?? START_FEN;

  return rows
    .filter((r) => r.ply % 2 === 1 === isWhite)
    .filter((r) => r.lossCp > MIN_NOTABLE_LOSS_CP)
    .sort((a, b) => b.lossCp - a.lossCp)
    .slice(0, WORST_MOVES)
    .map((r) => {
      const before = fenBefore(r.ply);
      return {
        ply: r.ply,
        san: r.san,
        lossCp: r.lossCp,
        quality: r.quality as MoveQuality,
        bestSan: r.bestUci ? sanForUci(before, r.bestUci) : null,
        fenBefore: before,
        fenAfter: r.fenAfter,
      };
    });
}

function buildPrompt(input: {
  state: games.GameState;
  isWhite: boolean;
  performance: GamePerformance;
  worst: WorstMove[];
}): string {
  const { state, isWhite, performance, worst } = input;
  const myId = isWhite ? state.white.id : state.black.id;

  const outcome =
    state.winnerId === null
      ? "The game was a draw"
      : state.winnerId === myId
        ? "You won the game"
        : "You lost the game";

  const worstText =
    worst.length === 0
      ? "No notably costly moves were found."
      : worst
          .map(
            (m, i) =>
              `${i + 1}. Move ${Math.ceil(m.ply / 2)} (${m.san}), graded a ${m.quality}, ` +
              `cost about ${(m.lossCp / 100).toFixed(1)} pawns of advantage.\n` +
              (m.bestSan
                ? `   The engine would have played ${m.bestSan} instead.\n`
                : "") +
              `   Position before this move (FEN): ${m.fenBefore}\n` +
              `   Position after this move (FEN): ${m.fenAfter}`,
          )
          .join("\n");

  return `
You are writing a coaching summary for the player who just finished a chess game.

Result: ${outcome}, by ${state.resultReason ?? "unknown reason"}, against your opponent.

Performance this game, already computed by the chess engine — trust these numbers exactly:
- Estimated playing level this game: ${performance.rating ?? "not enough moves to estimate"}
- Moves played: ${performance.moves}
- Average centipawn loss: ${performance.acpl}
- Blunders: ${performance.blunders}
- Mistakes: ${performance.mistakes}
- Inaccuracies: ${performance.inaccuracies}
- Share of moves matching the engine's own top choice: ${Math.round(performance.bestShare * 100)}%

The costliest moves you made this game, worst first — these are the mistakes your tips should be about:
${worstText}

Write the coaching summary now, speaking directly to the player as "you": two or three
sentences of prose, then two or three "- " tips that each name one of the mistakes above
and one habit that would catch it next time. Follow the system instructions exactly.
`.trim();
}

/** Build and send the coaching prompt for one player in one finished game. */
export async function generateCoachSummary(gameId: number, userId: number): Promise<string> {
  const state = await games.get(gameId);
  if (!state) throw new Error("the game is gone");
  if (state.status !== "finished") throw new Error("the game is not finished");

  const isWhite = state.white.id === userId;
  if (!isWhite && state.black.id !== userId) {
    throw new Error("that player is not in this game");
  }

  const performance = await performanceIn(gameId, userId);
  if (!performance) throw new Error("no analysis performance available for this player");

  const worst = await worstMoves(gameId, isWhite);
  const prompt = buildPrompt({ state, isWhite, performance, worst });

  return complete(COACH_SYSTEM_PROMPT, prompt);
}
