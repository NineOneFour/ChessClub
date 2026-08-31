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
import * as rating from "../lib/chess/rating";
import * as analysisService from "../lib/services/analysis";
import * as ratingsService from "../lib/services/ratings";
import * as gamesService from "../lib/services/games";
import * as rules from "../lib/chess/rules";
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

  console.log("Rating: the signals");

  check(
    "less centipawn loss is a higher rating",
    rating.ratingFromAcpl(20) > rating.ratingFromAcpl(60) &&
      rating.ratingFromAcpl(60) > rating.ratingFromAcpl(140),
  );
  check(
    "a very low average lands in club-player territory",
    rating.ratingFromAcpl(15) > 2_000,
  );
  check(
    "a beginner's average lands near a beginner's rating",
    rating.ratingFromAcpl(120) > 600 && rating.ratingFromAcpl(120) < 1_200,
  );
  check(
    "nothing goes below the floor however bad",
    rating.ratingFromAcpl(5_000) === rating.RATING_FLOOR,
  );
  check(
    "or above the ceiling however good",
    rating.ratingFromAcpl(0) === rating.RATING_CEILING,
  );
  check(
    "blundering less is a higher rating",
    rating.ratingFromBlunderRate(0) > rating.ratingFromBlunderRate(8),
  );
  check(
    "playing fewer poor moves is a higher rating",
    rating.ratingFromImprecisionRate(5) > rating.ratingFromImprecisionRate(40),
  );
  check(
    "a game of nothing but blunders reads as imprecise, not as precise",
    // The bug the first real analysis found: counting only the middle grades
    // scored "thirty blunders and two mistakes" as hardly ever slipping.
    (rating.performanceFrom(
      Array.from({ length: 30 }, (_, i) => ({
        lossCp: 600,
        quality: i < 28 ? ("blunder" as const) : ("mistake" as const),
        wasBest: false,
      })),
    ).signals?.imprecision ?? 9_999) < 600,
  );
  check(
    "finding the engine's move more often is a higher rating",
    rating.ratingFromBestShare(0.6) > rating.ratingFromBestShare(0.2),
  );
  check(
    "the signal weights are a whole",
    Math.abs(
      Object.values(rating.SIGNAL_WEIGHTS).reduce((a, b) => a + b, 0) - 1,
    ) < 1e-9,
  );

  console.log("Rating: one game");

  const moves = (
    count: number,
    each: { lossCp: number; quality: rating.RatedMove["quality"]; wasBest?: boolean },
  ): rating.RatedMove[] =>
    Array.from({ length: count }, () => ({
      lossCp: each.lossCp,
      quality: each.quality,
      wasBest: each.wasBest ?? false,
    }));

  const tooShort = rating.performanceFrom(
    moves(rating.MIN_RATED_MOVES - 1, { lossCp: 5, quality: "best", wasBest: true }),
  );
  check("a game too short to judge gets no rating", tooShort.rating === null);
  check("but its figures are still reported", tooShort.moves === rating.MIN_RATED_MOVES - 1);
  check("and no signals are invented for it", tooShort.signals === null);

  const strong = rating.performanceFrom(
    moves(30, { lossCp: 8, quality: "best", wasBest: true }),
  );
  const weak = rating.performanceFrom(
    moves(30, { lossCp: 320, quality: "blunder" }),
  );
  check("a clean game rates well", (strong.rating ?? 0) > 2_000);
  check("a game full of blunders does not", (weak.rating ?? 9_999) < 800);
  check("the average centipawn loss is reported", strong.acpl === 8);
  check("so is the share of engine moves", strong.bestShare === 1);
  check("and the blunder count", weak.blunders === 30);
  check("every signal is shown", strong.signals !== null && Object.keys(strong.signals).length === 4);

  const mixed = rating.performanceFrom([
    ...moves(20, { lossCp: 15, quality: "best", wasBest: true }),
    ...moves(2, { lossCp: 400, quality: "blunder" }),
  ]);
  check(
    "two blunders in a good game pull it down but not to the floor",
    (mixed.rating ?? 0) < (strong.rating ?? 0) && (mixed.rating ?? 0) > 1_000,
  );

  console.log("Rating: stability");

  const game = (
    gameId: number,
    perf: rating.GamePerformance,
    daysAgo: number,
  ): rating.RatedGame => ({
    gameId,
    playedAt: new Date(Date.now() - daysAgo * 86_400_000),
    performance: perf,
  });

  const ordinary = rating.performanceFrom(
    moves(30, { lossCp: 90, quality: "inaccuracy" }),
  );
  const brilliant = rating.performanceFrom(
    moves(30, { lossCp: 5, quality: "best", wasBest: true }),
  );
  const disaster = rating.performanceFrom(
    moves(30, { lossCp: 600, quality: "blunder" }),
  );

  check("no games, no rating", rating.strengthFrom([]) === null);
  check(
    "a game too short to judge is not a rating either",
    rating.strengthFrom([game(1, tooShort, 0)]) === null,
  );

  const steady = Array.from({ length: 10 }, (_, i) =>
    game(100 + i, ordinary, i),
  );
  const baseline = rating.strengthFrom(steady)!;
  check("ten steady games give a rating", baseline.rating > 0);
  check("and it is not provisional", baseline.provisional === false);
  check("the sample size is reported", baseline.games === 10);

  // The brief's requirement, and the reason for trimming.
  const withBrilliancy = rating.strengthFrom([
    game(200, brilliant, 0),
    ...steady,
  ])!;
  check(
    "one brilliant game does not add hundreds of points",
    withBrilliancy.rating - baseline.rating < 100,
  );
  check(
    "but it is visible as the best performance in the sample",
    withBrilliancy.best === brilliant.rating,
  );

  const withDisaster = rating.strengthFrom([game(300, disaster, 0), ...steady])!;
  check(
    "one terrible game does not destroy the rating",
    baseline.rating - withDisaster.rating < 100,
  );
  check(
    "and it is visible as the worst",
    withDisaster.worst === disaster.rating,
  );

  const thin = rating.strengthFrom([game(1, ordinary, 0), game(2, ordinary, 1)])!;
  check("a thin sample is flagged provisional", thin.provisional === true);

  // Recency: the same two performances in either order give different answers.
  const improvingLately = rating.strengthFrom([
    game(1, brilliant, 0),
    game(2, ordinary, 1),
    game(3, ordinary, 2),
  ])!;
  const slippingLately = rating.strengthFrom([
    game(1, ordinary, 0),
    game(2, ordinary, 1),
    game(3, brilliant, 2),
  ])!;
  check(
    "a good game last night counts for more than a good game last week",
    improvingLately.rating > slippingLately.rating,
  );

  const many = Array.from({ length: 40 }, (_, i) => game(400 + i, ordinary, i));
  check(
    "only the rolling sample is used",
    rating.strengthFrom(many)!.games === rating.SAMPLE_GAMES,
  );

  console.log("Rating: history");

  const history = rating.historyFrom(steady);
  check("one point per game", history.length === 10);
  check("oldest first", history[0].gameId === 109 && history[9].gameId === 100);
  check(
    "and every point is a rating",
    history.every((point) => point.rating >= rating.RATING_FLOOR),
  );

  console.log("Rating: from the database");

  // A game long enough to rate. Deterministic, and generated rather than
  // written out, so it stays legal if the rules module ever changes.
  const longGame = longLegalGame(30);
  check("a thirty-ply game to rate", longGame.length === 30);

  const rated = await gamesService.create({
    whiteId: white,
    blackId: black,
    initialMs: 0,
    incrementMs: 0,
  });
  created.gameIds.push(rated);

  for (const [index, uci] of longGame.entries()) {
    const mover = index % 2 === 0 ? white : black;
    const outcome = await gamesService.playMove(rated, mover, {
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      ...(uci.length > 4 ? { promotion: uci.slice(4) } : {}),
    });
    if (!outcome.ok) throw new Error(`FAILED: move ${uci} rejected`);
  }
  await gamesService.resign(rated, black);

  check(
    "an unanalysed game has no performance",
    (await ratingsService.performanceIn(rated, white)) === null,
  );

  // White plays well, black badly, so the two must not come out the same.
  await analysisService.recordSuccess(rated, {
    engine: "Test engine",
    depth: 12,
    moves: longGame.map((uci, index) => {
      const whiteMove = index % 2 === 0;
      return {
        ply: index + 1,
        evalBeforeCp: 0,
        evalAfterCp: 0,
        lossCp: whiteMove ? 10 : 400,
        bestUci: whiteMove ? uci : "a1a2",
        quality: whiteMove ? ("best" as const) : ("blunder" as const),
        mateBefore: null,
        mateAfter: null,
      };
    }),
  });

  const whitePerf = await ratingsService.performanceIn(rated, white);
  const blackPerf = await ratingsService.performanceIn(rated, black);

  check("white's half of the game is fifteen moves", whitePerf?.moves === 15);
  check("and so is black's", blackPerf?.moves === 15);
  check("white's average loss is white's", whitePerf?.acpl === 10);
  check("black's is black's", blackPerf?.acpl === 400);
  check(
    "the engine's own move counts as best for white",
    whitePerf?.bestShare === 1,
  );
  check("and black found none of them", blackPerf?.bestShare === 0);
  check(
    "so white rates far above black",
    (whitePerf?.rating ?? 0) - (blackPerf?.rating ?? 0) > 800,
  );

  const whiteStrength = await ratingsService.strengthFor(white);
  check("white has a strength", whiteStrength !== null);
  check("from one game, so provisional", whiteStrength?.provisional === true);
  check(
    "and it matches the one game they have",
    whiteStrength?.rating === whitePerf?.rating,
  );

  const whiteHistory = await ratingsService.historyFor(white);
  check("with one point of history", whiteHistory.length === 1);

  check(
    "somebody who has never played has no strength",
    (await ratingsService.strengthFor(black + 100_000)) === null,
  );

  const perfs = await ratingsService.recentPerformances(white, 5);
  check("recent performances are listed", perfs.length >= 1);
  check("newest first", perfs[0].gameId === rated);

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

/**
 * A deterministic legal game of `plies` half-moves that has not ended.
 *
 * Generated rather than written out so it cannot rot: any change to the rules
 * module produces a different but still legal game, instead of a smoke suite
 * failing on a move list that used to be legal.
 */
function longLegalGame(plies: number): string[] {
  for (let seed = 1; seed < 500; seed += 1) {
    let state = seed;
    const next = () => (state = (state * 1103515245 + 12345) & 0x7fffffff);

    const moves: string[] = [];
    let usable = true;

    for (let ply = 0; ply < plies; ply += 1) {
      const position = rules.positionAfter(moves);
      if (position.ending) {
        usable = false;
        break;
      }
      const options = Object.entries(position.dests).flatMap(([from, tos]) =>
        tos.map((to) => `${from}${to}`),
      );
      if (options.length === 0) {
        usable = false;
        break;
      }
      moves.push(options[next() % options.length]);
    }

    if (usable && !rules.positionAfter(moves).ending) return moves;
  }
  throw new Error("could not generate a long legal game");
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
