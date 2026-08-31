import "dotenv/config";
import { eq, inArray } from "drizzle-orm";
import WebSocket from "ws";
import { client, db } from "../lib/db";
import {
  challenges,
  chatMessages,
  families,
  gameMoves,
  games,
  users,
} from "../lib/db/schema";
import { generateToken, hashToken } from "../lib/auth/tokens";
import { deleteSessionsForUser, insertSession } from "../lib/auth/session-store";
import * as gamesService from "../lib/services/games";
import * as usersService from "../lib/services/users";
import { REALTIME_PORT } from "../lib/config";
import type { ServerFrame } from "../realtime/protocol";

/**
 * The live path, over real sockets. Needs the realtime service running:
 *
 *   npm run realtime      (or npm run dev:all)
 *   npm run smoke:play
 *
 * Two players challenge, accept, play a complete game and talk about it while a
 * third member watches — everything the phase 2 definition of done asks for,
 * exercised the way the browser does it. The service-layer suite
 * (`smoke:chess`) covers the rules; this covers the wiring.
 */

const SUFFIX = "playsmoke";
const created: { userIds: number[]; familyIds: number[]; gameIds: number[] } = {
  userIds: [],
  familyIds: [],
  gameIds: [],
};

function check(label: string, condition: boolean) {
  if (!condition) throw new Error(`FAILED: ${label}`);
  console.log(`  ok  ${label}`);
}

/** A socket that records every frame, for assertions. */
class Client {
  readonly frames: ServerFrame[] = [];
  private socket: WebSocket;
  /**
   * Settled by listeners attached in the constructor. Attaching them later
   * would race: a socket that connects before `open()` is awaited would have
   * already fired, and the promise would never settle.
   */
  private readonly ready: Promise<void>;

  constructor(token: string) {
    this.socket = new WebSocket(`ws://localhost:${REALTIME_PORT}/`, {
      headers: { cookie: `chessclub_session=${token}` },
    });
    this.ready = new Promise((resolve, reject) => {
      this.socket.once("open", () => resolve());
      this.socket.once("error", reject);
    });
    this.socket.on("message", (data) => {
      this.frames.push(JSON.parse(data.toString()) as ServerFrame);
    });
  }

  open(): Promise<void> {
    return this.ready;
  }

  send(frame: Record<string, unknown>) {
    this.socket.send(JSON.stringify(frame));
  }

  close() {
    this.socket.close();
  }

  /** Discard recorded frames, so a later wait can't match an older one. */
  clear() {
    this.frames.length = 0;
  }

  async waitFor<T extends ServerFrame["t"]>(
    type: T,
    predicate: (frame: Extract<ServerFrame, { t: T }>) => boolean,
    label: string,
    timeoutMs = 5000,
  ): Promise<Extract<ServerFrame, { t: T }>> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const match = this.frames.find(
        (frame): frame is Extract<ServerFrame, { t: T }> =>
          frame.t === type && predicate(frame as Extract<ServerFrame, { t: T }>),
      );
      if (match) return match;
      if (Date.now() > deadline) {
        throw new Error(`FAILED: timed out waiting for ${label}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

async function mintSession(userId: number): Promise<string> {
  const token = generateToken();
  await insertSession({
    tokenHash: hashToken(token),
    userId,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    userAgent: "smoke:play",
  });
  return token;
}

async function main() {
  const healthz = await fetch(
    `http://localhost:${REALTIME_PORT}/healthz`,
  ).catch(() => null);
  if (!healthz?.ok) {
    throw new Error(
      `The realtime service isn't answering on :${REALTIME_PORT}. Start it with "npm run realtime".`,
    );
  }

  console.log("Setup");

  const familyId = await usersService.createFamily(`Play Family ${SUFFIX}`);
  created.familyIds.push(familyId);

  const players: Record<string, { id: number; client: Client }> = {};
  for (const name of ["Ellie", "Max", "Ada"]) {
    const id = await usersService.create({
      username: `${name.toLowerCase()}-${SUFFIX}`,
      realName: name,
      password: "smoke-password",
      role: "child",
      familyId,
      actorId: null,
    });
    created.userIds.push(id);
    players[name] = { id, client: new Client(await mintSession(id)) };
  }

  const ellie = players.Ellie;
  const max = players.Max;
  const ada = players.Ada;

  await Promise.all([
    ellie.client.open(),
    max.client.open(),
    ada.client.open(),
  ]);
  await ellie.client.waitFor("ready", () => true, "ready");
  check("three members connected", true);

  console.log("Challenging");

  ellie.client.send({
    t: "challenge",
    username: `max-${SUFFIX}`,
    timeControl: "5+0",
    color: "white",
  });

  const offered = await max.client.waitFor(
    "challenges",
    (frame) => frame.incoming.some((c) => c.fromId === ellie.id),
    "the challenge reaching Max",
  );
  check(
    "a challenge arrives with its time control",
    offered.incoming[0].timeControl === "5 min",
  );
  check(
    "and appears as outgoing for the challenger",
    (
      await ellie.client.waitFor(
        "challenges",
        (frame) => frame.outgoing.length === 1,
        "outgoing challenge",
      )
    ).outgoing[0].toId === max.id,
  );

  const challengeId = offered.incoming[0].id;
  max.client.send({ t: "challengeAccept", id: challengeId });

  const started = await max.client.waitFor(
    "gameStarted",
    () => true,
    "the game starting for Max",
  );
  const gameId = started.gameId;
  created.gameIds.push(gameId);
  check("accepting starts a game", Number.isInteger(gameId));
  check(
    "and the challenger is sent to the board too",
    (
      await ellie.client.waitFor(
        "gameStarted",
        (frame) => frame.gameId === gameId,
        "the game starting for Ellie",
      )
    ).gameId === gameId,
  );
  check(
    "the game shows up in the club's lobby",
    (
      await ada.client.waitFor(
        "lobby",
        (frame) => frame.games.some((g) => g.id === gameId),
        "lobby listing",
      )
    ).games.length >= 1,
  );

  console.log("Playing");

  for (const player of [ellie, max, ada]) {
    player.client.send({ t: "watch", gameId });
    await player.client.waitFor(
      "game",
      (frame) => frame.game.id === gameId,
      "the board arriving",
    );
  }
  check("both players and a spectator are watching", true);

  const fresh = await ellie.client.waitFor(
    "game",
    (frame) => frame.game.id === gameId,
    "state",
  );
  check("the challenger got white as asked", fresh.game.white.id === ellie.id);
  check(
    "legal moves are sent with the position",
    Object.values(fresh.game.dests).flat().length === 20,
  );
  check("the clock is running", fresh.game.clock.running);
  check(
    "spectators get the legal moves too — they aren't secret",
    (
      await ada.client.waitFor(
        "game",
        (frame) => frame.game.id === gameId,
        "spectator state",
      )
    ).game.dests.e2.includes("e4"),
  );

  // Moving out of turn is refused, and the true state is sent back.
  max.client.clear();
  max.client.send({ t: "move", gameId, from: "e7", to: "e5" });
  await max.client.waitFor(
    "notice",
    (frame) => frame.message.includes("not your turn"),
    "the out-of-turn refusal",
  );
  check("moving out of turn is refused over the wire", true);

  // Somebody who isn't playing can't move either.
  ada.client.clear();
  ada.client.send({ t: "move", gameId, from: "e2", to: "e4" });
  await ada.client.waitFor(
    "notice",
    (frame) => frame.message.includes("not playing"),
    "the spectator refusal",
  );
  check("a spectator can't move the pieces", true);

  // Scholar's mate, alternating, with every frame checked as it lands.
  const line = ["e2e4", "e7e5", "f1c4", "b8c6", "d1h5", "g8f6", "h5f7"];
  for (const [index, uci] of line.entries()) {
    const mover = index % 2 === 0 ? ellie : max;
    ada.client.clear();
    mover.client.send({
      t: "move",
      gameId,
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
    });
    await ada.client.waitFor(
      "game",
      (frame) => frame.game.ply === index + 1,
      `move ${index + 1} reaching the spectator`,
    );
  }
  check("a whole game plays out move by move", true);

  const final = await ada.client.waitFor(
    "game",
    (frame) => frame.game.status === "finished",
    "the finish",
  );
  check("checkmate ends it", final.game.resultReason === "checkmate");
  check("with the right winner", final.game.winnerId === ellie.id);
  check("the score sheet has every move", final.game.moves.length === 7);
  check("in notation", final.game.moves[6].san === "Qxf7#");
  check("and no moves are offered any more", Object.keys(final.game.dests).length === 0);

  console.log("Game chat");

  ada.client.clear();
  max.client.send({ t: "chat", channel: `game:${gameId}`, body: "good game" });
  const said = await ada.client.waitFor(
    "chat",
    (frame) => frame.message.body === "good game",
    "game chat reaching the spectator",
  );
  check("players and spectators share the game's chat", said.message.channel === `game:${gameId}`);

  // Game chat must not leak into the clubhouse channel.
  const clubFrames = ada.client.frames.filter(
    (frame) => frame.t === "chat" && frame.message.channel === "club",
  );
  check("and it doesn't leak into the clubhouse", clubFrames.length === 0);

  // Talking in a room you haven't opened is refused.
  const outsider = new Client(await mintSession(ada.id));
  await outsider.open();
  await outsider.waitFor("ready", () => true, "ready");
  outsider.send({ t: "chat", channel: `game:${gameId}`, body: "hello?" });
  await outsider.waitFor(
    "notice",
    (frame) => frame.message.includes("Open the game"),
    "the refusal to talk in an unopened room",
  );
  check("you can't talk in a game you haven't opened", true);
  outsider.close();

  console.log("Reconnection");

  // A player dropping and coming back gets the whole state, not a diff.
  max.client.close();
  await new Promise((resolve) => setTimeout(resolve, 300));

  const returning = new Client(await mintSession(max.id));
  await returning.open();
  await returning.waitFor("ready", () => true, "ready");
  returning.send({ t: "watch", gameId });
  const resumed = await returning.waitFor(
    "game",
    (frame) => frame.game.id === gameId,
    "the board on reconnect",
  );
  check("a reconnecting player gets the full position", resumed.game.ply === 7);
  check("with the finished result", resumed.game.status === "finished");
  check("and the whole score sheet", resumed.game.moves.length === 7);
  returning.close();

  console.log("The clock watchdog");

  // A short game, rewound so its clock has already expired. Nobody touches
  // it — the service's watchdog must end it on its own.
  const flagGameId = await gamesService.create({
    whiteId: ellie.id,
    blackId: ada.id,
    initialMs: 60_000,
    incrementMs: 0,
  });
  created.gameIds.push(flagGameId);

  ellie.client.clear();
  ellie.client.send({ t: "watch", gameId: flagGameId });
  await ellie.client.waitFor(
    "game",
    (frame) => frame.game.id === flagGameId,
    "the new board",
  );

  await db.execute(
    `update games set clock_started_at = now() - interval '61 seconds' where id = ${flagGameId}`,
  );

  // Re-watching makes the service re-read and re-arm the timer against the
  // rewound clock; the fall itself is then the watchdog's own doing.
  ellie.client.clear();
  ellie.client.send({ t: "watch", gameId: flagGameId });

  const flagged = await ellie.client.waitFor(
    "game",
    (frame) => frame.game.id === flagGameId && frame.game.status === "finished",
    "the watchdog ending the game on time",
    8000,
  );
  check("a clock running out ends the game with nobody moving", true);
  check("recorded as a flag", flagged.game.resultReason === "flag");
  check("in favour of the other player", flagged.game.winnerId === ada.id);

  ellie.client.close();
  ada.client.close();
}

async function cleanup() {
  for (const userId of created.userIds) await deleteSessionsForUser(userId);
  if (created.gameIds.length) {
    await db
      .delete(challenges)
      .where(inArray(challenges.gameId, created.gameIds));
  }
  if (created.userIds.length) {
    await db.delete(challenges).where(inArray(challenges.fromId, created.userIds));
    await db
      .delete(chatMessages)
      .where(inArray(chatMessages.userId, created.userIds));
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
