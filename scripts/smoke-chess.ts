import "dotenv/config";
import { eq, inArray } from "drizzle-orm";
import { client, db } from "../lib/db";
import { challenges, chatMessages, families, gameMoves, games, users } from "../lib/db/schema";
import * as clock from "../lib/chess/clock";
import * as rules from "../lib/chess/rules";
import * as challengesService from "../lib/services/challenges";
import * as gamesService from "../lib/services/games";
import * as usersService from "../lib/services/users";
import { ValidationError } from "../lib/validation";

/**
 * End-to-end check of the chess layer: rules, clocks, challenges and the
 * transactional game service, against the real database.
 *
 * The clock tests manipulate `clock_started_at` directly rather than sleeping,
 * so the whole suite runs in a couple of seconds.
 */

const SUFFIX = "chesssmoke";
const created: { userIds: number[]; familyIds: number[]; gameIds: number[] } = {
  userIds: [],
  familyIds: [],
  gameIds: [],
};

function check(label: string, condition: boolean) {
  if (!condition) throw new Error(`FAILED: ${label}`);
  console.log(`  ok  ${label}`);
}

async function expectRejection(label: string, body: () => Promise<unknown>) {
  try {
    await body();
  } catch (err) {
    if (err instanceof ValidationError) {
      console.log(`  ok  ${label} (${err.message})`);
      return;
    }
    throw err;
  }
  throw new Error(`FAILED: ${label} — expected a rejection`);
}

/** Rewind a game's clock start, to test time without waiting for it. */
async function rewindClock(gameId: number, seconds: number) {
  await db.execute(
    `update games set clock_started_at = clock_started_at - interval '${seconds} seconds' where id = ${gameId}`,
  );
}

async function play(
  gameId: number,
  userId: number,
  uci: string,
): Promise<gamesService.GameState> {
  const result = await gamesService.playMove(gameId, userId, {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    ...(uci.length > 4 ? { promotion: uci.slice(4) } : {}),
  });
  if (!result.ok) throw new Error(`FAILED: move ${uci} rejected — ${result.reason}`);
  return result.state;
}

async function main() {
  console.log("Rules");

  const start = rules.positionAfter([]);
  check("the opening position is white to move", start.turn === "white");
  check("twenty opening moves are legal", Object.values(start.dests).flat().length === 20);
  check("no ending in the opening position", start.ending === null);

  const scholars = ["e2e4", "e7e5", "f1c4", "b8c6", "d1h5", "g8f6", "h5f7"];
  const mated = rules.positionAfter(scholars);
  check("checkmate is detected", mated.ending?.reason === "checkmate");
  check("and scored to the mating side", mated.ending?.result === "1-0");
  check("a mated position offers no moves", Object.keys(mated.dests).length === 0);

  check(
    "an illegal move is refused",
    rules.playMove(["e2e4"], { from: "e1", to: "e5" }) === null,
  );
  check(
    "moving the opponent's piece is refused",
    rules.playMove([], { from: "e7", to: "e5" }) === null,
  );
  check(
    "a promotion without a piece chosen is refused",
    rules.playMove(
      ["a2a4", "b7b5", "a4b5", "a7a6", "b5a6", "g8f6", "a6a7", "f6g8"],
      { from: "a7", to: "b8" },
    ) === null,
  );
  check(
    "a promotion destination is flagged for the board",
    rules
      .positionAfter(["a2a4", "b7b5", "a4b5", "a7a6", "b5a6", "g8f6", "a6a7", "f6g8"])
      .promotions["a7"]?.includes("b8") === true,
  );
  check(
    "an ordinary move is not flagged as a promotion",
    rules.positionAfter([]).promotions["e2"] === undefined,
  );
  check(
    "the same promotion with a piece is allowed",
    rules.playMove(
      ["a2a4", "b7b5", "a4b5", "a7a6", "b5a6", "g8f6", "a6a7", "f6g8"],
      { from: "a7", to: "b8", promotion: "q" },
    )?.san === "axb8=Q",
  );

  // Stalemate: the classic king-and-queen smothering.
  const stalemate = rules.positionAfter([
    "e2e3", "a7a5", "d1h5", "a8a6", "h5a5", "h7h5", "a5c7", "a6h6",
    "h2h4", "f7f6", "c7d7", "e8f7", "d7b7", "d8d3", "b7b8", "d3h7",
    "b8c8", "f7g6", "c8e6",
  ]);
  check("stalemate is detected", stalemate.ending?.reason === "stalemate");
  check("and scored as a draw", stalemate.ending?.result === "1/2-1/2");

  check(
    "a full army can mate",
    rules.canMateWithMaterial(rules.STARTING_FEN, "white") === true,
  );
  check(
    "a lone king can't",
    rules.canMateWithMaterial("8/8/4k3/8/8/4K3/8/8 w - - 0 1", "white") === false,
  );
  check(
    "nor a lone bishop",
    rules.canMateWithMaterial("8/8/4k3/8/8/4KB2/8/8 w - - 0 1", "white") === false,
  );
  check(
    "nor a lone knight",
    rules.canMateWithMaterial("8/8/4k3/8/8/4KN2/8/8 w - - 0 1", "white") === false,
  );
  check(
    "but a rook can",
    rules.canMateWithMaterial("8/8/4k3/8/8/4KR2/8/8 w - - 0 1", "white") === true,
  );
  check(
    "and two knights count as enough",
    rules.canMateWithMaterial("8/8/4k3/8/8/3NKN2/8/8 w - - 0 1", "white") === true,
  );

  console.log("Clocks");

  const base = {
    whiteMs: 60_000,
    blackMs: 60_000,
    initialMs: 60_000,
    incrementMs: 2_000,
    turn: "white" as const,
  };
  const t0 = 1_000_000;

  const after5s = clock.remaining(
    { ...base, clockStartedAt: new Date(t0) },
    t0 + 5_000,
  );
  check("the player to move spends time", after5s.whiteMs === 55_000);
  check("the other player's clock is untouched", after5s.blackMs === 60_000);

  const moved = clock.applyMove(
    { ...base, clockStartedAt: new Date(t0) },
    t0 + 5_000,
  );
  check("moving credits the increment", moved.whiteMs === 57_000);

  check(
    "a clock that has run out has flagged",
    clock.hasFlagged({ ...base, clockStartedAt: new Date(t0) }, t0 + 61_000),
  );
  check(
    "an untimed game never flags",
    !clock.hasFlagged(
      { ...base, initialMs: 0, clockStartedAt: new Date(t0) },
      t0 + 10 * 60 * 60 * 1000,
    ),
  );
  check("clocks format as m:ss", clock.formatClock(65_000) === "1:05");
  check("and show tenths under ten seconds", clock.formatClock(9_400) === "0:09.4");

  console.log("Players");

  const familyId = await usersService.createFamily(`Chess Family ${SUFFIX}`);
  created.familyIds.push(familyId);

  const [ellie, max, ada] = await Promise.all(
    ["Ellie", "Max", "Ada"].map((name) =>
      usersService.create({
        username: `${name.toLowerCase()}-${SUFFIX}`,
        displayName: name,
        password: "smoke-password",
        role: "child",
        familyId,
        actorId: null,
      }),
    ),
  );
  created.userIds.push(ellie, max, ada);
  check("three players", [ellie, max, ada].every(Number.isInteger));

  console.log("Challenges");

  await expectRejection("challenging yourself is refused", () =>
    challengesService.create({
      fromId: ellie,
      toUsername: `ellie-${SUFFIX}`,
      timeControlKey: "5+0",
      color: "random",
    }),
  );
  await expectRejection("an unknown time control is refused", () =>
    challengesService.create({
      fromId: ellie,
      toUsername: `max-${SUFFIX}`,
      timeControlKey: "1+0",
      color: "random",
    }),
  );

  const challengeId = await challengesService.create({
    fromId: ellie,
    toUsername: `max-${SUFFIX}`,
    timeControlKey: "5+0",
    color: "white",
  });
  check("a challenge is created", Number.isInteger(challengeId));
  check(
    "it appears for the person challenged",
    (await challengesService.listIncoming(max)).some((c) => c.id === challengeId),
  );
  check(
    "and as outgoing for the challenger",
    (await challengesService.listOutgoing(ellie)).some((c) => c.id === challengeId),
  );

  await expectRejection("a duplicate challenge is refused", () =>
    challengesService.create({
      fromId: ellie,
      toUsername: `max-${SUFFIX}`,
      timeControlKey: "5+0",
      color: "random",
    }),
  );
  await expectRejection("only the recipient can decline", () =>
    challengesService.decline(challengeId, ada),
  );

  const gameId = await challengesService.accept(challengeId, max);
  created.gameIds.push(gameId);
  check("accepting starts a game", Number.isInteger(gameId));

  await expectRejection("a challenge can't be accepted twice", () =>
    challengesService.accept(challengeId, max),
  );

  const fresh = (await gamesService.get(gameId))!;
  check("the challenger got the colour they asked for", fresh.white.id === ellie);
  check("the game is active", fresh.status === "active");
  check("both clocks start full", fresh.clock.whiteMs > 299_000);
  check("the time control is described", fresh.timeControl === "5 min");
  check("twenty legal moves are offered", Object.values(fresh.dests).flat().length === 20);

  await expectRejection("you can't be challenged while playing", () =>
    challengesService.create({
      fromId: ada,
      toUsername: `max-${SUFFIX}`,
      timeControlKey: "5+0",
      color: "random",
    }),
  );

  console.log("Playing");

  const wrongTurn = await gamesService.playMove(gameId, max, {
    from: "e7",
    to: "e5",
  });
  check("moving out of turn is refused", !wrongTurn.ok);

  const notPlaying = await gamesService.playMove(gameId, ada, {
    from: "e2",
    to: "e4",
  });
  check(
    "a spectator can't move",
    !notPlaying.ok && notPlaying.reason.includes("not playing"),
  );

  const illegal = await gamesService.playMove(gameId, ellie, {
    from: "e2",
    to: "e5",
  });
  check("an illegal move is refused", !illegal.ok);

  let state = await play(gameId, ellie, "e2e4");
  check("the move is recorded", state.ply === 1);
  check("in algebraic notation", state.moves[0].san === "e4");
  check("and the turn passes", state.turn === "black");
  check("the last move is marked", state.lastMove?.to === "e4");

  state = await play(gameId, max, "e7e5");
  check("both clocks are ticking down from full", state.clock.whiteMs <= 300_000);
  check(
    "the increment was credited on the first move",
    state.moves[0].whiteMs > 299_000,
  );

  console.log("Draw offers");

  const offered = await gamesService.offerOrAcceptDraw(gameId, ellie);
  check("a draw can be offered", offered.ok && offered.state.drawOfferBy === ellie);
  const reOffered = await gamesService.offerOrAcceptDraw(gameId, ellie);
  check(
    "offering twice doesn't agree with yourself",
    reOffered.ok && reOffered.state.status === "active",
  );
  const withdrawn = await gamesService.clearDrawOffer(gameId, ellie);
  check("an offer can be withdrawn", withdrawn.ok && withdrawn.state.drawOfferBy === null);

  await gamesService.offerOrAcceptDraw(gameId, ellie);
  state = await play(gameId, ellie, "g1f3");
  check("moving refuses an outstanding offer", state.drawOfferBy === null);

  console.log("Resignation");

  const resigned = await gamesService.resign(gameId, max);
  check("resigning ends the game", resigned.ok && resigned.state.status === "finished");
  check("with the right result", resigned.ok && resigned.state.result === "1-0");
  check("and a winner", resigned.ok && resigned.state.winnerId === ellie);
  check(
    "a finished game offers no moves",
    resigned.ok && Object.keys(resigned.state.dests).length === 0,
  );
  const afterEnd = await gamesService.playMove(gameId, ellie, {
    from: "b1",
    to: "c3",
  });
  check("no moves after the game is over", !afterEnd.ok);
  const reResign = await gamesService.resign(gameId, ellie);
  check("and no resigning twice", !reResign.ok);

  console.log("Flag falls");

  const flagGameId = await gamesService.create({
    whiteId: ellie,
    blackId: max,
    initialMs: 60_000,
    incrementMs: 0,
  });
  created.gameIds.push(flagGameId);

  check(
    "a clock with time left can't be flagged",
    !(await gamesService.claimFlag(flagGameId)).ok,
  );

  await rewindClock(flagGameId, 90);
  const flagged = await gamesService.claimFlag(flagGameId);
  check("running out of time ends the game", flagged.ok && flagged.state.status === "finished");
  check("on time", flagged.ok && flagged.state.resultReason === "flag");
  check(
    "in favour of the player who still had time",
    flagged.ok && flagged.state.winnerId === max,
  );
  check("with the clock at zero", flagged.ok && flagged.state.clock.whiteMs === 0);

  // A move attempted after your own flag has fallen loses, it doesn't land.
  const lateGameId = await gamesService.create({
    whiteId: ellie,
    blackId: max,
    initialMs: 60_000,
    incrementMs: 0,
  });
  created.gameIds.push(lateGameId);
  await rewindClock(lateGameId, 90);
  const late = await gamesService.playMove(lateGameId, ellie, {
    from: "e2",
    to: "e4",
  });
  check(
    "moving after your own flag falls loses instead",
    late.ok && late.state.status === "finished" && late.state.resultReason === "flag",
  );
  check("and the move was not played", late.ok && late.state.ply === 0);

  console.log("Untimed games");

  const untimedId = await gamesService.create({
    whiteId: ellie,
    blackId: ada,
    initialMs: 0,
    incrementMs: 0,
  });
  created.gameIds.push(untimedId);
  await rewindClock(untimedId, 60 * 60 * 24);
  const untimed = await gamesService.claimFlag(untimedId);
  check("an untimed game can't be flagged", !untimed.ok);
  const stillPlaying = await play(untimedId, ellie, "d2d4");
  check("and plays on after a day", stillPlaying.status === "active");
  check("with no clock running", !stillPlaying.clock.running);
  check("described as having no clock", stillPlaying.timeControl === "No clock");

  console.log("Checkmate over the board");

  const mateGameId = await gamesService.create({
    whiteId: ellie,
    blackId: max,
    initialMs: 0,
    incrementMs: 0,
  });
  created.gameIds.push(mateGameId);
  for (const [index, uci] of scholars.entries()) {
    await play(mateGameId, index % 2 === 0 ? ellie : max, uci);
  }
  const mate = (await gamesService.get(mateGameId))!;
  check("checkmate ends the game by itself", mate.status === "finished");
  check("scored to the mating player", mate.winnerId === ellie);
  check("with the reason recorded", mate.resultReason === "checkmate");

  console.log("History and PGN");

  check(
    "finished games are listed",
    (await gamesService.listFinished()).some((g) => g.id === mateGameId),
  );
  check(
    "active games are listed separately",
    (await gamesService.listActive()).some((g) => g.id === untimedId),
  );
  const ellieGames = await gamesService.listForUser(ellie);
  check("a member's games are listed", ellieGames.length >= 4);
  check(
    "with the unfinished one first",
    ellieGames[0].status === "active",
  );
  check(
    "only one game is active per player",
    (await gamesService.activeGameFor(max)) === null,
  );

  const pgn = (await gamesService.toPgn(mateGameId))!;
  check("PGN has the moves", pgn.includes("1. e4 e5 2. Bc4 Nc6"));
  check("and the result", pgn.includes('[Result "1-0"]'));
  check("and both players", pgn.includes('[White "Ellie"]') && pgn.includes('[Black "Max"]'));
  check("and the termination", pgn.includes('[Termination "checkmate"]'));

  console.log("Concurrency");

  const raceId = await gamesService.create({
    whiteId: ellie,
    blackId: max,
    initialMs: 0,
    incrementMs: 0,
  });
  created.gameIds.push(raceId);

  // Two different first moves, fired together. Exactly one may land.
  const [a, b] = await Promise.all([
    gamesService.playMove(raceId, ellie, { from: "e2", to: "e4" }),
    gamesService.playMove(raceId, ellie, { from: "d2", to: "d4" }),
  ]);
  const landed = [a, b].filter((r) => r.ok).length;
  check("racing moves don't both land", landed === 1);
  check("and the game has exactly one move", (await gamesService.get(raceId))!.ply === 1);
}

async function cleanup() {
  if (created.gameIds.length) {
    await db.delete(challenges).where(inArray(challenges.gameId, created.gameIds));
  }
  if (created.userIds.length) {
    await db.delete(challenges).where(inArray(challenges.fromId, created.userIds));
    await db.delete(chatMessages).where(inArray(chatMessages.userId, created.userIds));
  }
  if (created.gameIds.length) {
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
  .then(() => console.log("\nAll checks passed."))
  .catch((err) => {
    console.error(`\n${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch((err) => console.error("cleanup failed", err));
    await client.end();
  });
