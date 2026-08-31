import "dotenv/config";
import { inArray } from "drizzle-orm";
import WebSocket from "ws";
import { client, db } from "../lib/db";
import { chatMessages, families, users } from "../lib/db/schema";
import { generateToken, hashToken } from "../lib/auth/tokens";
import { insertSession, deleteSessionsForUser } from "../lib/auth/session-store";
import * as usersService from "../lib/services/users";
import { REALTIME_PORT } from "../lib/config";
import type { ServerFrame } from "../realtime/protocol";

/**
 * Live check of the realtime service. Needs it running:
 *
 *   npm run realtime      (or npm run dev:all)
 *   npm run smoke:realtime
 *
 * Creates two throwaway children, connects a socket as each, and checks that
 * presence and chat actually cross between them — the part the service-layer
 * smoke test can't reach, since it never opens a socket.
 */

const SUFFIX = "rtsmoke";
const created: { userIds: number[]; familyIds: number[] } = {
  userIds: [],
  familyIds: [],
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
      displayName: name,
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
    "message carries the author's name",
    delivered.message.displayName === "Bruno",
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

  console.log("Departure");

  bruno.close();
  await ada.waitFor(
    "presence",
    (frame) => !frame.online.some((m) => m.id === kids[1].id),
    "Bruno leaving Ada's roster",
  );
  check("a departure is broadcast", true);

  ada.close();
  await new Promise((resolve) => setTimeout(resolve, 400));
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
