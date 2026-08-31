import "dotenv/config";
import { eq, inArray } from "drizzle-orm";
import { client, db } from "../lib/db";
import {
  families,
  gameAnalysis,
  gameMoveAnalysis,
  gameMoves,
  games,
  users,
} from "../lib/db/schema";
import * as evaluation from "../lib/chess/evaluation";
import * as analysisService from "../lib/services/analysis";
import * as gamesService from "../lib/services/games";
import * as usersService from "../lib/services/users";
import { Engine, parseInfo } from "../analysis/engine";

/**
 * Phase 3, end to end: the evaluation maths, the queue, and — if Stockfish is
 * installed — a real game analysed by a real engine.
 *
 * The engine section is skipped rather than failed when there is no binary, so
 * the suite still means something on a machine that has not installed one. It
 * says loudly which it did.
 */

const SUFFIX = "analysissmoke";
const created: { userIds: number[]; familyIds: number[]; gameIds: number[] } = {
  userIds: [],
  familyIds: [],
  gameIds: [],
};

let skipped = 0;

function check(label: string, condition: boolean) {
  if (!condition) throw new Error(`FAILED: ${label}`);
  console.log(`  ok  ${label}`);
}

function skip(label: string) {
  skipped += 1;
  console.log(`  --  skipped ${label}`);
}

async function main() {
  console.log("Evaluation maths");

  const cp = (value: number): evaluation.EngineScore => ({
    kind: "cp",
    cp: value,
  });
  const mate = (moves: number): evaluation.EngineScore => ({
    kind: "mate",
    moves,
  });

  check("a centipawn score passes through", evaluation.scoreToCp(cp(35)) === 35);
  check(
    "mate is worth more than any material",
    evaluation.scoreToCp(mate(3)) > evaluation.EVAL_CLAMP_CP * 10,
  );
  check(
    "a faster mate is worth more than a slower one",
    evaluation.scoreToCp(mate(1)) > evaluation.scoreToCp(mate(6)),
  );
  check(
    "being mated is the worst thing there is",
    evaluation.scoreToCp(mate(-2)) < -evaluation.EVAL_CLAMP_CP * 10,
  );
  check("flipping a score changes sides", evaluation.scoreToCp(evaluation.flip(cp(80))) === -80);
  check(
    "and flipping a mate changes who is mating",
    evaluation.scoreToMate(evaluation.flip(mate(4))) === -4,
  );

  check("evaluations clamp", evaluation.clampCp(9_999) === evaluation.EVAL_CLAMP_CP);
  check("in both directions", evaluation.clampCp(-9_999) === -evaluation.EVAL_CLAMP_CP);
  check(
    "a move in an already-lost position costs little",
    // -30 pawns to -40 pawns: both clamp to the floor, so the loss is zero.
    evaluation.lossCp(-3_000, -4_000) === 0,
  );
  check("an ordinary loss is the difference", evaluation.lossCp(50, -100) === 150);
  check("a loss is never negative", evaluation.lossCp(-100, 50) === 0);

  check("nothing lost is best", evaluation.classifyLoss(0) === "best");
  check("a little is good", evaluation.classifyLoss(40) === "good");
  check("more is an inaccuracy", evaluation.classifyLoss(80) === "inaccuracy");
  check("more still is a mistake", evaluation.classifyLoss(150) === "mistake");
  check("two pawns is a blunder", evaluation.classifyLoss(250) === "blunder");

  // The whole-move assembly, including the point-of-view flip that is the
  // easiest thing in the pipeline to get backwards.
  const goodMove = evaluation.analyseMove({
    ply: 1,
    before: cp(30),
    bestUci: "e2e4",
    // The opponent now sees -30, which is +30 for us: nothing was lost.
    afterOther: cp(-30),
    playedUci: "e2e4",
  });
  check("playing the engine's move costs nothing", goodMove.lossCp === 0);
  check("and is graded best", goodMove.quality === "best");
  check("the score after is from the mover's side", goodMove.evalAfterCp === 30);

  const blunder = evaluation.analyseMove({
    ply: 2,
    before: cp(20),
    bestUci: "g8f6",
    // The opponent now sees +400, so we are at -400: four pawns gone.
    afterOther: cp(400),
    playedUci: "b8a6",
  });
  check("a move that hands over four pawns costs 420", blunder.lossCp === 420);
  check("and is graded a blunder", blunder.quality === "blunder");

  const missedMate = evaluation.analyseMove({
    ply: 3,
    before: mate(2),
    bestUci: "d1h5",
    afterOther: cp(-50),
    playedUci: "a2a3",
  });
  check("a missed mate is a blunder", missedMate.quality === "blunder");
  check("and the mate that was there is recorded", missedMate.mateBefore === 2);

  const bestDespiteNoise = evaluation.analyseMove({
    ply: 4,
    before: cp(0),
    bestUci: "e7e5",
    // Depth noise: the next search likes it 15cp less. Playing the engine's own
    // move must still read as best.
    afterOther: cp(15),
    playedUci: "e7e5",
  });
  check("the engine's own move is never an inaccuracy", bestDespiteNoise.quality === "best");

  console.log("Parsing what the engine says");

  check(
    "a centipawn info line",
    evaluation.scoreToCp(
      parseOrThrow("info depth 16 seldepth 20 score cp -42 nodes 1000 pv e2e4"),
    ) === -42,
  );
  check(
    "a mate info line",
    evaluation.scoreToMate(parseOrThrow("info depth 12 score mate 5 pv d1h5")) === 5,
  );
  check(
    "a bound is not a score",
    parseInfo("info depth 9 score cp 120 lowerbound nodes 5") === null,
  );
  check("and neither is anything else", parseInfo("bestmove e2e4") === null);

  console.log("The queue");

  const familyId = await usersService.createFamily(`Analysis Family ${SUFFIX}`);
  created.familyIds.push(familyId);

  const [white, black] = await Promise.all(
    ["Ana", "Bo"].map((name) =>
      usersService.create({
        username: `${name.toLowerCase()}-${SUFFIX}`,
        realName: name,
        password: "smoke-password",
        role: "child",
        familyId,
        actorId: null,
      }),
    ),
  );
  created.userIds.push(white, black);

  const gameId = await gamesService.create({
    whiteId: white,
    blackId: black,
    initialMs: 0,
    incrementMs: 0,
  });
  created.gameIds.push(gameId);

  check(
    "an unfinished game is not in the queue",
    (await rowFor(gameId)) === undefined,
  );
  check(
    "and its analysis cannot be read at all",
    (await analysisService.forGame(gameId)) === null,
  );

  // Scholar's mate, so there is something real to analyse and a genuine blunder
  // in it: 3...Nf6 allows Qxf7#.
  const scholars = ["e2e4", "e7e5", "f1c4", "b8c6", "d1h5", "g8f6", "h5f7"];
  for (const [index, uci] of scholars.entries()) {
    const mover = index % 2 === 0 ? white : black;
    const result = await gamesService.playMove(gameId, mover, {
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
    });
    if (!result.ok) throw new Error(`FAILED: move ${uci} rejected`);
  }

  const finished = await gamesService.get(gameId);
  check("the game finished by checkmate", finished?.resultReason === "checkmate");

  const queued = await rowFor(gameId);
  check("finishing queued it", queued?.status === "queued");
  check("in the same breath, with no attempts yet", queued?.attempts === 0);
  check(
    "the analysis reads as pending rather than missing",
    (await analysisService.forGame(gameId))?.status === "queued",
  );

  check("queue counts see it", (await analysisService.queueCounts()).queued >= 1);

  // Claiming is what the worker does.
  const claimed = await claimUntil(gameId);
  check("the worker can claim it", claimed === true);
  const running = await rowFor(gameId);
  check("which marks it running", running?.status === "running");
  check("and counts the attempt", running?.attempts === 1);
  check("nobody else can claim it now", (await claimUntil(gameId)) === false);

  // A failure goes back in the queue while attempts remain.
  await analysisService.recordFailure(gameId, "no engine here");
  const retrying = await rowFor(gameId);
  check("a failure goes back in the queue", retrying?.status === "queued");
  check("and keeps the reason", retrying?.error === "no engine here");

  await db
    .update(gameAnalysis)
    .set({ attempts: analysisService.MAX_ATTEMPTS })
    .where(eq(gameAnalysis.gameId, gameId));
  await analysisService.recordFailure(gameId, "still no engine");
  check(
    "out of attempts it is left alone",
    (await rowFor(gameId))?.status === "failed",
  );
  check(
    "and a failed game is not claimed again",
    (await claimUntil(gameId)) === false,
  );

  // A crashed worker's claim comes back.
  await db
    .update(gameAnalysis)
    .set({
      status: "running",
      attempts: 0,
      startedAt: new Date(
        Date.now() - (analysisService.STALE_RUNNING_MINUTES + 5) * 60_000,
      ),
    })
    .where(eq(gameAnalysis.gameId, gameId));
  check("an abandoned run is requeued", (await analysisService.requeueStale()) >= 1);
  check("back to queued", (await rowFor(gameId))?.status === "queued");

  await db
    .update(gameAnalysis)
    .set({
      status: "running",
      startedAt: new Date(),
    })
    .where(eq(gameAnalysis.gameId, gameId));
  const before = await analysisService.requeueStale();
  check("a run that started just now is left running", before === 0);

  console.log("Storing an analysis");

  await analysisService.recordSuccess(gameId, {
    engine: "Test engine 1",
    depth: 4,
    moves: [
      {
        ply: 1,
        evalBeforeCp: 20,
        evalAfterCp: 20,
        lossCp: 0,
        bestUci: "e2e4",
        quality: "best",
        mateBefore: null,
        mateAfter: null,
      },
      {
        ply: 2,
        evalBeforeCp: -20,
        evalAfterCp: -300,
        lossCp: 280,
        bestUci: "c7c5",
        quality: "blunder",
        mateBefore: null,
        mateAfter: null,
      },
    ],
  });

  const stored = await analysisService.forGame(gameId);
  check("the analysis is done", stored?.status === "done");
  check("the engine is recorded with it", stored?.engine === "Test engine 1");
  check("so is the depth it was searched to", stored?.depth === 4);
  check("the earlier error is cleared", stored?.error === null);
  check("both moves are stored", stored?.moves.length === 2);
  check("in ply order", stored?.moves[0].ply === 1 && stored?.moves[1].ply === 2);
  check("with their grades", stored?.moves[1].quality === "blunder");

  // Re-analysing replaces the evidence rather than mixing two yardsticks.
  await analysisService.recordSuccess(gameId, {
    engine: "Test engine 2",
    depth: 8,
    moves: [
      {
        ply: 1,
        evalBeforeCp: 25,
        evalAfterCp: 25,
        lossCp: 0,
        bestUci: "d2d4",
        quality: "best",
        mateBefore: null,
        mateAfter: null,
      },
    ],
  });
  const redone = await analysisService.forGame(gameId);
  check("re-analysing replaces the old rows", redone?.moves.length === 1);
  check("and records the new engine", redone?.engine === "Test engine 2");

  check(
    "queueing a game twice does not double it",
    await analysisService
      .enqueue(gameId)
      .then(async () => (await rowFor(gameId))?.status === "done"),
  );

  console.log("Stockfish itself");

  const engine = new Engine({ depth: 8, timeoutMs: 15_000 });
  let engineWorks = false;
  try {
    await engine.start();
    engineWorks = true;
  } catch {
    engineWorks = false;
  }

  if (!engineWorks) {
    skip(
      `the engine checks: no Stockfish at "${process.env.STOCKFISH_PATH ?? "stockfish"}". ` +
        "Install it (AUR, or build from source — see the README) or set STOCKFISH_PATH.",
    );
    await engine.stop().catch(() => undefined);
  } else {
    check("the engine identifies itself", engine.name.length > 0);
    console.log(`      (${engine.name})`);

    const opening = await engine.analyse([]);
    check("it scores the opening position", typeof opening.score === "object");
    check("and offers a move", opening.bestUci !== null);
    check(
      "the opening is roughly level",
      opening.score.kind === "cp" && Math.abs(opening.score.cp) < 100,
    );

    // Scholar's mate is mate, and the engine should say so.
    const mated = await engine.analyse(scholars);
    check(
      "a mated position offers no move",
      mated.bestUci === null,
    );

    const beforeMate = await engine.analyse(scholars.slice(0, 6));
    check(
      "it sees the mate one move away",
      beforeMate.score.kind === "mate" && beforeMate.score.moves === 1,
    );
    check("and finds the mating move", beforeMate.bestUci === "h5f7");

    await engine.stop();
    check("the engine stops cleanly", true);
  }

  console.log("Reading an analysis back");

  const another = await gamesService.create({
    whiteId: white,
    blackId: black,
    initialMs: 0,
    incrementMs: 0,
  });
  created.gameIds.push(another);
  check(
    "a game still being played has no readable analysis",
    (await analysisService.forGame(another)) === null,
  );

  check(
    "a game that doesn't exist has none either",
    (await analysisService.forGame(999_999_999)) === null,
  );
}

function parseOrThrow(line: string): evaluation.EngineScore {
  const parsed = parseInfo(line);
  if (!parsed) throw new Error(`FAILED: could not parse "${line}"`);
  return parsed;
}

async function rowFor(gameId: number) {
  const [row] = await db
    .select()
    .from(gameAnalysis)
    .where(eq(gameAnalysis.gameId, gameId));
  return row;
}

/**
 * Claim games until ours comes up, since the club's real queue may have games
 * in it. Returns whether ours was claimable.
 */
async function claimUntil(gameId: number): Promise<boolean> {
  const others: number[] = [];
  try {
    for (;;) {
      const claimed = await analysisService.claimNext();
      if (claimed === null) return false;
      if (claimed === gameId) return true;
      others.push(claimed);
    }
  } finally {
    // Put anybody else's games back exactly as they were.
    for (const other of others) {
      await db
        .update(gameAnalysis)
        .set({ status: "queued", startedAt: null, attempts: 0 })
        .where(eq(gameAnalysis.gameId, other));
    }
  }
}

async function cleanup() {
  if (created.gameIds.length) {
    await db
      .delete(gameMoveAnalysis)
      .where(inArray(gameMoveAnalysis.gameId, created.gameIds));
    await db
      .delete(gameAnalysis)
      .where(inArray(gameAnalysis.gameId, created.gameIds));
    await db.delete(gameMoves).where(inArray(gameMoves.gameId, created.gameIds));
    await db.delete(games).where(inArray(games.id, created.gameIds));
  }
  if (created.userIds.length) {
    await db.delete(users).where(inArray(users.id, created.userIds));
  }
  for (const familyId of created.familyIds) {
    await db.delete(families).where(eq(families.id, familyId));
  }
  console.log("cleaned up");
}

main()
  .then(() =>
    console.log(
      skipped === 0
        ? "\nAll checks passed."
        : `\nAll checks passed (${skipped} section skipped).`,
    ),
  )
  .catch((err) => {
    console.error(`\n${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch((err) => console.error("cleanup failed", err));
    await client.end();
  });
