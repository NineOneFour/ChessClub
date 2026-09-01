import "dotenv/config";
import {
  analyseMove,
  type AnalysedMove,
  type EngineScore,
} from "../lib/chess/evaluation";
import * as analysis from "../lib/services/analysis";
import * as games from "../lib/services/games";
import * as coach from "../lib/services/coach";
import { generateCoachSummary } from "../lib/llm/coach";
import * as groq from "../lib/llm/groq";
import { Engine, EngineError, DEFAULT_DEPTH } from "./engine";

/**
 * The analysis worker.
 *
 * A third process, beside the web tier and the realtime service, and isolated
 * from both on purpose: the brief asks that heavy analysis cannot interfere with
 * active games, and a search pinning a core for two minutes inside the socket
 * process would do exactly that. Nothing waits for this. Nothing breaks when it
 * is off — the queue simply gets longer.
 *
 * It polls rather than listening. At eight children and a few games a day, a
 * five-second poll is indistinguishable from a notification and there is no
 * LISTEN/NOTIFY plumbing to get wrong.
 *
 * How a game is analysed: **each position once.** The engine scores the position
 * before each move and names its preferred move; the score after the move played
 * is the score of the *next* position, flipped. So an eighty-move game is
 * eighty-one searches, not a hundred and sixty, and every figure in the database
 * came from one consistent search.
 */

const POLL_MS = Number(process.env.ANALYSIS_POLL_MS ?? 5_000);
const DEPTH = Number(process.env.ANALYSIS_DEPTH ?? DEFAULT_DEPTH);

let stopping = false;

async function analyseGame(engine: Engine, gameId: number): Promise<void> {
  const state = await games.get(gameId);
  if (!state) throw new Error("the game is gone");
  if (state.status !== "finished") throw new Error("the game is not finished");

  const played = state.moves.map((move) => move.uci);

  // Position 0 is the start; position n is after n half-moves. One search each,
  // in order, so the engine's hash table is warm for the position that follows.
  const scores: { score: EngineScore; bestUci: string | null }[] = [];

  for (let index = 0; index <= played.length; index += 1) {
    const result = await engine.analyse(played.slice(0, index));
    scores.push({ score: result.score, bestUci: result.bestUci });
  }

  const moves: AnalysedMove[] = played.map((uci, index) =>
    analyseMove({
      ply: index + 1,
      before: scores[index].score,
      bestUci: scores[index].bestUci,
      afterOther: scores[index + 1].score,
      playedUci: uci,
    }),
  );

  await analysis.recordSuccess(gameId, {
    engine: engine.name,
    depth: engine.depth,
    moves,
  });

  const blunders = moves.filter((move) => move.quality === "blunder").length;
  console.log(
    `[analysis] game ${gameId}: ${moves.length} moves, ${blunders} blunder(s), ` +
      `${engine.name} depth ${engine.depth}`,
  );
}

async function main() {
  const engine = new Engine({ depth: DEPTH });

  console.log(
    `[analysis] worker starting, depth ${DEPTH}, polling every ${POLL_MS}ms`,
  );

  const requeued = await analysis.requeueStale();
  if (requeued > 0) {
    console.log(`[analysis] put ${requeued} abandoned run(s) back in the queue`);
  }

  const counts = await analysis.queueCounts();
  console.log(
    `[analysis] queue: ${counts.queued} queued, ${counts.done} done, ${counts.failed} failed`,
  );

  const coachingEnabled = groq.isConfigured();
  console.log(
    coachingEnabled
      ? `[analysis] coaching enabled (${groq.model()})`
      : "[analysis] coaching disabled: GROQ_API_KEY not set",
  );

  let engineStarted = false;

  while (!stopping) {
    const gameId = await analysis.claimNext();

    if (gameId === null) {
      if (coachingEnabled) {
        try {
          const claim = await coach.claimNextForCoaching();
          if (claim !== null) {
            try {
              const summary = await generateCoachSummary(claim.gameId, claim.userId);
              await coach.recordCoachSummary(claim.gameId, claim.userId, summary, groq.model());
              console.log(
                `[analysis] coach: game ${claim.gameId} player ${claim.userId} summarised`,
              );
              continue; // success — loop straight back to check for more work, no sleep
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              await coach.recordCoachFailure(claim.gameId, claim.userId, message);
              console.error(
                `[analysis] coach: game ${claim.gameId} player ${claim.userId} failed: ${message}`,
              );
              // fall through to sleep below — a persistent failure (bad key,
              // exhausted quota, a decommissioned model) must not spin at
              // full speed against a paid third-party API
            }
          }
        } catch (err) {
          // The claim itself failed (e.g. a missing migration, a transient
          // DB error) — an isolated coaching hiccup must never escape this
          // branch and crash the whole worker, Stockfish included.
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[analysis] coach: claim failed: ${message}`);
          // fall through to sleep below
        }
      }

      await sleep(POLL_MS);
      continue;
    }

    try {
      // Started lazily, so a club with an empty queue and no Stockfish
      // installed never sees an error it cannot act on.
      if (!engineStarted) {
        await engine.start();
        engineStarted = true;
        console.log(`[analysis] engine: ${engine.name}`);
      }

      await analyseGame(engine, gameId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[analysis] game ${gameId} failed: ${message}`);
      await analysis.recordFailure(gameId, message);

      if (err instanceof EngineError) {
        // The engine, not the game, is the problem. Drop it and start a fresh
        // one next time round rather than talking to a broken pipe.
        engineStarted = false;
        await engine.stop().catch(() => undefined);
        await sleep(POLL_MS);
      }
    }
  }

  await engine.stop();
  console.log("[analysis] worker stopped");
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`[analysis] ${signal}, finishing the current game first`);
    stopping = true;
  });
}

main().catch((err) => {
  console.error("[analysis] worker died", err);
  process.exit(1);
});
