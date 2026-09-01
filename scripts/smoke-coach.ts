import "dotenv/config";
import { eq, inArray } from "drizzle-orm";
import { client, db } from "../lib/db";
import {
  families,
  gameAnalysis,
  gameCoachSummary,
  gameMoveAnalysis,
  gameMoves,
  games,
  users,
} from "../lib/db/schema";
import * as analysisService from "../lib/services/analysis";
import * as coachService from "../lib/services/coach";
import * as gamesService from "../lib/services/games";
import * as usersService from "../lib/services/users";
import * as groq from "../lib/llm/groq";

/**
 * Phase 4's first slice, end to end: the coaching queue and storage always;
 * a real Groq call only if GROQ_API_KEY is set, so this suite still means
 * something with no key configured. It says loudly which it did.
 */

const SUFFIX = "coachsmoke";
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
  console.log("The coaching queue");

  const familyId = await usersService.createFamily(`Coach Family ${SUFFIX}`);
  created.familyIds.push(familyId);

  const [white, black] = await Promise.all(
    ["Cara", "Deni"].map((name) =>
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

  // Scholar's mate: quick to play out, and gives black one genuine blunder
  // (3...Nf6, allowing Qxf7#) to hang a "costliest move" test on later.
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

  check(
    "an unanalysed game offers no coaching claim",
    !(await isOurClaim(gameId)),
  );

  await analysisService.recordSuccess(gameId, {
    engine: "Test engine",
    depth: 4,
    moves: [
      { ply: 1, evalBeforeCp: 20, evalAfterCp: 20, lossCp: 0, bestUci: "e2e4", quality: "best", mateBefore: null, mateAfter: null },
      { ply: 2, evalBeforeCp: -20, evalAfterCp: -10, lossCp: 0, bestUci: "e7e5", quality: "best", mateBefore: null, mateAfter: null },
      { ply: 3, evalBeforeCp: 10, evalAfterCp: 30, lossCp: 0, bestUci: "f1c4", quality: "best", mateBefore: null, mateAfter: null },
      { ply: 4, evalBeforeCp: -30, evalAfterCp: -20, lossCp: 0, bestUci: "b8c6", quality: "good", mateBefore: null, mateAfter: null },
      { ply: 5, evalBeforeCp: 20, evalAfterCp: 350, lossCp: 0, bestUci: "d1h5", quality: "best", mateBefore: null, mateAfter: null },
      // Black's real blunder: this allows Qxf7#, a mate that was there.
      { ply: 6, evalBeforeCp: -350, evalAfterCp: 10_000, lossCp: 620, bestUci: "g7g6", quality: "blunder", mateBefore: null, mateAfter: -1 },
      { ply: 7, evalBeforeCp: 10_000, evalAfterCp: 10_000, lossCp: 0, bestUci: "h5f7", quality: "best", mateBefore: 1, mateAfter: null },
    ],
  });

  // Force this row to the front of the queue regardless of any other done
  // games already in the (real, shared) club database.
  await db
    .update(gameAnalysis)
    .set({ finishedAt: new Date(0) })
    .where(eq(gameAnalysis.gameId, gameId));

  const firstClaim = await coachService.claimNextForCoaching();
  check("white is offered first", firstClaim?.gameId === gameId && firstClaim?.userId === white);

  await coachService.recordCoachSummary(gameId, white, "Great opening, keep it up!", "test-model");
  check(
    "the summary reads back",
    (await coachService.summaryFor(gameId, white)) === "Great opening, keep it up!",
  );

  const secondClaim = await coachService.claimNextForCoaching();
  check("black is offered next", secondClaim?.gameId === gameId && secondClaim?.userId === black);

  await coachService.recordCoachFailure(gameId, black, "the model timed out");
  check("a failure leaves no summary", (await coachService.summaryFor(gameId, black)) === null);

  const thirdClaim = await coachService.claimNextForCoaching();
  check(
    "a failed attempt is retried on the next poll",
    thirdClaim?.gameId === gameId && thirdClaim?.userId === black,
  );

  await coachService.recordCoachSummary(gameId, black, "Watch your knight moves next time.", "test-model");
  check(
    "once both players have a summary, this game is no longer offered",
    !(await isOurClaim(gameId)),
  );

  console.log("Groq itself");
  if (!groq.isConfigured()) {
    skip(
      "the Groq client checks: GROQ_API_KEY is not set. Add it to .env to test a real call.",
    );
  } else {
    const reply = await groq.complete(
      "You reply with exactly the word 'pong', nothing else.",
      "ping",
    );
    check("Groq returned some text", reply.length > 0);
    console.log(`      (model ${groq.model()}, replied: ${JSON.stringify(reply)})`);
  }
}

/** Whether calling claimNextForCoaching would currently return our game. */
async function isOurClaim(gameId: number): Promise<boolean> {
  const claim = await coachService.claimNextForCoaching();
  return claim?.gameId === gameId;
}

async function cleanup() {
  if (created.gameIds.length) {
    await db.delete(gameCoachSummary).where(inArray(gameCoachSummary.gameId, created.gameIds));
    await db.delete(gameMoveAnalysis).where(inArray(gameMoveAnalysis.gameId, created.gameIds));
    await db.delete(gameAnalysis).where(inArray(gameAnalysis.gameId, created.gameIds));
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
