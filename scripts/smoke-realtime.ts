import "dotenv/config";
import { inArray } from "drizzle-orm";
import WebSocket from "ws";
import { client, db } from "../lib/db";
import { challenges, chatMessages, families, gameMoves, gameOffers, games, users } from "../lib/db/schema";
import { generateToken, hashToken } from "../lib/auth/tokens";
import { insertSession, deleteSessionsForUser } from "../lib/auth/session-store";
import * as usersService from "../lib/services/users";
import * as gamesService from "../lib/services/games";
import * as offersService from "../lib/services/offers";
import { REALTIME_PORT } from "../lib/config";
import type { ClientFrame, ServerFrame } from "../realtime/protocol";

/**
 * Live check of the realtime service. Needs it running:
 *
 *   npm run realtime      (or npm run dev:all)
 *   npm run smoke:realtime
 *
 * Creates two throwaway children, connects a socket as each, and checks that
 * presence, chat and open offers actually cross between them — the part the
 * service-layer smoke test can't reach, since it never opens a socket.
 */

const SUFFIX = "rtsmoke";
const created: { userIds: number[]; familyIds: number[]; gameIds: number[] } = {
  userIds: [],
  familyIds: [],
  gameIds: [],
};

function check(label: string, condition: boolean) {
  if (!condition) throw new Error(`FAILED: ${label}`);
  console.log(`  ok  ${label}`);
}

/** A socket that records every frame it receives, for assertions. */
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

  send(body: string) {
    this.socket.send(JSON.stringify({ t: "chat", channel: "club", body }));
  }

  /** Any other client frame, for the parts of the protocol that aren't chat. */
  request(frame: ClientFrame) {
    this.socket.send(JSON.stringify(frame));
  }

  close() {
    this.socket.close();
  }

  /** Wait until a frame matching the predicate arrives, or time out. */
  async waitFor<T extends ServerFrame["t"]>(
    type: T,
    predicate: (frame: Extract<ServerFrame, { t: T }>) => boolean,
    label: string,
  ): Promise<Extract<ServerFrame, { t: T }>> {
    const deadline = Date.now() + 4000;
    for (;;) {
      const match = this.frames.find(
        (frame): frame is Extract<ServerFrame, { t: T }> =>
          frame.t === type && predicate(frame as Extract<ServerFrame, { t: T }>),
      );
      if (match) return match;
      if (Date.now() > deadline) {
        throw new Error(
          `FAILED: timed out waiting for ${label}. Frames seen: ${JSON.stringify(
            this.frames,
          )}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

async function mintSession(userId: number): Promise<string> {
  const token = generateToken();
  await insertSession({
    tokenHash: hashToken(token),
    userId,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    userAgent: "smoke:realtime",
  });
  return token;
}

async function main() {
  const healthz = await fetch(`http://localhost:${REALTIME_PORT}/healthz`).catch(
    () => null,
  );
  if (!healthz?.ok) {
    throw new Error(
      `The realtime service isn't answering on :${REALTIME_PORT}. Start it with "npm run realtime".`,
    );
  }
  console.log("Setup");

  const familyId = await usersService.createFamily(`Realtime Family ${SUFFIX}`);
  created.familyIds.push(familyId);

  const kids: { id: number; token: string; name: string }[] = [];
  for (const name of ["Ada", "Bruno"]) {
    const id = await usersService.create({
      username: `${name.toLowerCase()}-${SUFFIX}`,
      realName: name,
      password: "smoke-password",
      role: "child",
      familyId,
      actorId: null,
    });
    created.userIds.push(id);
    kids.push({ id, token: await mintSession(id), name });
  }
  check("two children with sessions", kids.length === 2);

  console.log("Unauthenticated connection");

  const anonymous = new WebSocket(`ws://localhost:${REALTIME_PORT}/`);
  const rejected = await new Promise<boolean>((resolve) => {
    anonymous.on("error", () => resolve(true));
    anonymous.on("open", () => {
      anonymous.close();
      resolve(false);
    });
  });
  check("a socket with no session cookie is refused", rejected);

  console.log("Presence");

  const ada = new Client(kids[0].token);
  await ada.open();
  const ready = await ada.waitFor(
    "ready",
    (frame) => frame.me.id === kids[0].id,
    "ready",
  );
  check("ready frame identifies the member", ready.me.role === "child");
  await ada.waitFor(
    "presence",
    (frame) => frame.online.some((m) => m.id === kids[0].id),
    "own presence",
  );

  const bruno = new Client(kids[1].token);
  await bruno.open();
  const withBruno = await ada.waitFor(
    "presence",
    (frame) => frame.online.some((m) => m.id === kids[1].id),
    "Bruno appearing in Ada's roster",
  );
  check(
    "a second arrival is broadcast to the first, with their role",
    withBruno.online.every((m) => typeof m.role === "string"),
  );

  const rosterDuringVisit = await usersService.listClubMembers();
  check(
    "the presence table shows both as online",
    kids.every(
      (kid) => rosterDuringVisit.find((m) => m.id === kid.id)?.isOnline === true,
    ),
  );

  console.log("Chat");

  bruno.send("want a game?");
  const delivered = await ada.waitFor(
    "chat",
    (frame) => frame.message.body === "want a game?",
    "Bruno's message reaching Ada",
  );
  check(
    "message carries the author's username, never their real name",
    delivered.message.username === `bruno-${SUFFIX}`,
  );
  check(
    "message carries the author's role, so the transcript can tag grown-ups",
    delivered.message.role === "child",
  );
  check(
    "sender receives their own message too",
    (await bruno.waitFor(
      "chat",
      (frame) => frame.message.body === "want a game?",
      "echo to sender",
    )) !== undefined,
  );

  bruno.send("   ");
  await bruno.waitFor(
    "notice",
    (frame) => frame.message.toLowerCase().includes("empty"),
    "an empty message being refused",
  );
  check("an empty message is refused with a notice", true);

  // A parent switching chat off must bite on the next message, not the next login.
  await usersService.setFlags(kids[1].id, { chatEnabled: false }, null);
  bruno.send("still here?");
  await bruno.waitFor(
    "notice",
    (frame) => frame.message.includes("switched off"),
    "the parental chat switch being enforced mid-connection",
  );
  check("chat switched off mid-connection is enforced", true);
  await usersService.setFlags(kids[1].id, { chatEnabled: true }, null);

  console.log("Open offers");

  ada.request({ t: "offer", timeControl: "5+0", color: "white" });
  const posted = await bruno.waitFor(
    "offers",
    (frame) => frame.offers.some((offer) => offer.fromId === kids[0].id),
    "Ada's board appearing for Bruno",
  );
  const adaOffer = posted.offers.find((o) => o.fromId === kids[0].id)!;
  check("an offer carries the time control", adaOffer.timeControl === "5 min");
  check(
    "and the offerer, by username and role",
    adaOffer.fromUsername === `ada-${SUFFIX}` && adaOffer.fromRole === "child",
  );

  ada.request({ t: "offer", timeControl: "3+2", color: "random" });
  await ada.waitFor(
    "notice",
    (frame) => frame.message.includes("already out"),
    "a second board being refused",
  );
  check("one board out per member", true);

  ada.request({ t: "offerCancel", id: adaOffer.id });
  await bruno.waitFor(
    "offers",
    (frame) => !frame.offers.some((offer) => offer.id === adaOffer.id),
    "the board coming back in",
  );
  check("cancelling is broadcast to the room", true);

  // Put it out again and have Bruno sit down: both players are sent to the
  // board, and the offer leaves everybody's list.
  ada.request({ t: "offer", timeControl: "5+0", color: "white" });
  // `waitFor` scans from the first frame, so this has to look for the *new*
  // offer rather than any of Ada's.
  const reposted = await bruno.waitFor(
    "offers",
    (frame) =>
      frame.offers.some(
        (offer) => offer.fromId === kids[0].id && offer.id !== adaOffer.id,
      ),
    "Ada's board again",
  );
  const takenOffer = reposted.offers.find(
    (o) => o.fromId === kids[0].id && o.id !== adaOffer.id,
  )!;

  bruno.request({ t: "offerAccept", id: takenOffer.id });
  const brunoStarted = await bruno.waitFor(
    "gameStarted",
    () => true,
    "Bruno being sent to the board",
  );
  const adaStarted = await ada.waitFor(
    "gameStarted",
    () => true,
    "Ada being sent to the board",
  );
  created.gameIds.push(brunoStarted.gameId);
  check(
    "both players are sent to the same game",
    adaStarted.gameId === brunoStarted.gameId,
  );
  await bruno.waitFor(
    "offers",
    (frame) => !frame.offers.some((offer) => offer.id === takenOffer.id),
    "the taken board leaving the list",
  );
  check("a taken board leaves the list", true);
  await bruno.waitFor(
    "lobby",
    (frame) => frame.games.some((game) => game.id === brunoStarted.gameId),
    "the new game appearing in the lobby",
  );
  check("and the game appears in the watch list", true);

  // Finish it, so the rematch below has a finished game to work from.
  await gamesService.resign(brunoStarted.gameId, kids[0].id);

  console.log("Play again");

  ada.request({ t: "rematch", gameId: brunoStarted.gameId });
  const asked = await bruno.waitFor(
    "challenges",
    (frame) =>
      frame.incoming.some((c) => c.fromUsername === `ada-${SUFFIX}`),
    "Ada's rematch offer reaching Bruno",
  );
  const rematchOffer = asked.incoming.find(
    (c) => c.fromUsername === `ada-${SUFFIX}`,
  )!;
  check(
    "a rematch reaches the other player where they are sitting",
    rematchOffer.timeControl === "5 min",
  );
  check(
    "asking for the colour they didn't have",
    rematchOffer.color === "black",
  );

  bruno.request({ t: "rematch", gameId: brunoStarted.gameId });
  const again = await bruno.waitFor(
    "gameStarted",
    (frame) => frame.gameId !== brunoStarted.gameId,
    "the rematch starting for Bruno",
  );
  const adaAgain = await ada.waitFor(
    "gameStarted",
    (frame) => frame.gameId !== brunoStarted.gameId,
    "the rematch starting for Ada",
  );
  created.gameIds.push(again.gameId);
  check("the second tap starts it for both", adaAgain.gameId === again.gameId);

  // And finish that one too, so the departure checks aren't fighting a live game.
  await gamesService.resign(again.gameId, kids[0].id);

  console.log("Departure");

  bruno.close();
  await ada.waitFor(
    "presence",
    (frame) => !frame.online.some((m) => m.id === kids[1].id),
    "Bruno leaving Ada's roster",
  );
  check("a departure is broadcast", true);

  // A board left out by somebody who has gone home would start a game against
  // an empty chair, so leaving withdraws it.
  ada.request({ t: "offer", timeControl: "5+0", color: "random" });
  // Again, the *new* offer: the socket must have really put the board out
  // before closing, or this would be testing nothing.
  await ada.waitFor(
    "offers",
    (frame) =>
      frame.offers.some(
        (offer) => offer.fromId === kids[0].id && offer.id > takenOffer.id,
      ),
    "Ada's parting board",
  );

  ada.close();
  await new Promise((resolve) => setTimeout(resolve, 400));
  check(
    "leaving the room withdraws your board",
    (await offersService.listOpen()).every(
      (offer) => offer.fromId !== kids[0].id,
    ),
  );
  const rosterAfter = await usersService.listClubMembers();
  check(
    "the presence table is cleared on disconnect",
    kids.every((kid) => rosterAfter.find((m) => m.id === kid.id)?.isOnline === false),
  );
  check(
    "last seen was recorded",
    (await usersService.getById(kids[0].id))?.lastSeenAt !== null,
  );
}

async function cleanup() {
  for (const userId of created.userIds) await deleteSessionsForUser(userId);
  if (created.userIds.length) {
    await db
      .delete(chatMessages)
      .where(inArray(chatMessages.userId, created.userIds));
    await db.delete(gameOffers).where(inArray(gameOffers.fromId, created.userIds));
  }
  if (created.gameIds.length) {
    // Rematch challenges point at the game they produced.
    await db.delete(challenges).where(inArray(challenges.gameId, created.gameIds));
  }
  if (created.userIds.length) {
    await db.delete(challenges).where(inArray(challenges.fromId, created.userIds));
  }
  if (created.gameIds.length) {
    await db.delete(gameMoves).where(inArray(gameMoves.gameId, created.gameIds));
    await db.delete(games).where(inArray(games.id, created.gameIds));
  }
  if (created.userIds.length) {
    await db.delete(users).where(inArray(users.id, created.userIds));
  }
  if (created.familyIds.length) {
    await db.delete(families).where(inArray(families.id, created.familyIds));
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
