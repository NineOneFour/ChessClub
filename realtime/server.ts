import "dotenv/config";
import { createServer, type IncomingMessage } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { findSessionUserByToken, readCookie } from "../lib/auth/session-store";
import type { SessionUser } from "../lib/auth/session-store";
import * as chat from "../lib/services/chat";
import * as challenges from "../lib/services/challenges";
import * as gamesService from "../lib/services/games";
import * as offers from "../lib/services/offers";
import * as presence from "../lib/services/presence";
import * as usersService from "../lib/services/users";
import * as clock from "../lib/chess/clock";
import { REALTIME_PORT, SESSION_COOKIE } from "../lib/config";
import {
  decodeClientFrame,
  encode,
  parseChannel,
  type ClientFrame,
  type OnlineMember,
  type ServerFrame,
  type WireChallenge,
  type WireGame,
  type WireGameCard,
  type WireOffer,
} from "./protocol";
import { ValidationError } from "../lib/validation";

/**
 * The realtime service.
 *
 * Runs as its own process, separate from Next.js, for two reasons: restarting
 * or redeploying the web tier must not drop a game in progress, and the
 * Stockfish worker added in phase 3 needs to sit next to the game server
 * rather than inside the web tier. See design.md §5.
 *
 * It is transport and a clock watchdog — never the source of truth. Every
 * action is handed to the service layer, which settles it against the database
 * inside a transaction, and whatever comes back is broadcast. No game state is
 * cached here, which is why a restart of this process costs nothing.
 *
 * Authentication reuses the web tier's session cookie: the browser opens the
 * socket to the same origin, the proxy forwards the upgrade, and we resolve the
 * cookie through the same query the pages use. No separate token, and nothing
 * secret in a URL.
 */

const HEARTBEAT_MS = 30_000;

type Connection = {
  socket: WebSocket;
  user: SessionUser;
  /** The session token this socket authenticated with, re-checked per action. */
  token: string;
  /** Games this socket is following. */
  watching: Set<number>;
  /** Timestamps of recent chat messages, for rate limiting. */
  recentMessages: number[];
  alive: boolean;
};

/** Live sockets, keyed by user id — a kid with two tabs open has two. */
const connections = new Map<number, Set<Connection>>();

/** Who is following which game. */
const rooms = new Map<number, Set<Connection>>();

/** One pending flag-fall timer per running game that has a clock. */
const watchdogs = new Map<number, ReturnType<typeof setTimeout>>();

/* --- sending ------------------------------------------------------------- */

function send(socket: WebSocket, frame: ServerFrame) {
  if (socket.readyState === socket.OPEN) socket.send(encode(frame));
}

function notice(connection: Connection, message: string) {
  send(connection.socket, { t: "notice", message });
}

function broadcast(frame: ServerFrame) {
  const payload = encode(frame);
  for (const set of connections.values()) {
    for (const connection of set) {
      if (connection.socket.readyState === connection.socket.OPEN) {
        connection.socket.send(payload);
      }
    }
  }
}

function sendToUser(userId: number, frame: ServerFrame) {
  const set = connections.get(userId);
  if (!set) return;
  const payload = encode(frame);
  for (const connection of set) {
    if (connection.socket.readyState === connection.socket.OPEN) {
      connection.socket.send(payload);
    }
  }
}

function broadcastToRoom(gameId: number, frame: ServerFrame) {
  const room = rooms.get(gameId);
  if (!room) return;
  const payload = encode(frame);
  for (const connection of room) {
    if (connection.socket.readyState === connection.socket.OPEN) {
      connection.socket.send(payload);
    }
  }
}

/* --- fire and forget ------------------------------------------------------ */

/**
 * Start work nobody awaits, and make sure a failure is logged rather than
 * thrown into the void.
 *
 * A bare `void somePromise()` turns any rejection into an unhandled rejection,
 * which by default takes the whole process down — and this process is the club
 * for everyone currently connected. One member's socket closing on a bad
 * database write must not disconnect the other seven, so every detached call
 * goes through here.
 */
function detach(label: string, work: () => Promise<unknown>) {
  work().catch((err) => console.error(`[realtime] ${label} failed`, err));
}

/* --- presence ------------------------------------------------------------ */

function onlineMembers(): OnlineMember[] {
  return [...connections.values()]
    .map((set) => [...set][0]?.user)
    .filter((user): user is SessionUser => Boolean(user))
    .map((user) => ({
      id: user.id,
      username: user.username,
      avatar: user.avatar,
      role: user.role,
    }))
    .sort((a, b) => a.username.localeCompare(b.username));
}

function broadcastPresence() {
  broadcast({ t: "presence", online: onlineMembers() });
}

async function register(connection: Connection) {
  const { id } = connection.user;
  let set = connections.get(id);
  if (!set) {
    set = new Set();
    connections.set(id, set);
  }
  set.add(connection);
  await presence.setConnections(id, set.size);
  broadcastPresence();
}

async function unregister(connection: Connection) {
  for (const gameId of [...connection.watching]) {
    leaveRoom(connection, gameId);
  }

  const { id } = connection.user;
  const set = connections.get(id);
  if (!set) return;
  set.delete(connection);

  if (set.size === 0) {
    connections.delete(id);
    await presence.setConnections(id, 0);
    await presence.markLastSeen(id);
    // A board left out by somebody who has gone home would start a game
    // against an empty chair.
    if (await offers.expireFor(id)) await publishOffers();
  } else {
    await presence.setConnections(id, set.size);
  }
  broadcastPresence();
}

/* --- serialisation ------------------------------------------------------- */

function toWire(state: gamesService.GameState): WireGame {
  // `clockStartedAt` deliberately does not cross the wire: `state.clock`
  // already holds time remaining *now*, and a client subtracting a server
  // timestamp from its own clock would double-count and add skew.
  const { clockStartedAt, ...rest } = state;
  void clockStartedAt;
  return {
    ...rest,
    startedAt: state.startedAt.toISOString(),
    finishedAt: state.finishedAt?.toISOString() ?? null,
  };
}

function toWireChallenge(challenge: challenges.Challenge): WireChallenge {
  return {
    id: challenge.id,
    fromId: challenge.fromId,
    fromAvatar: challenge.fromAvatar,
    fromUsername: challenge.fromUsername,
    toId: challenge.toId,
    toUsername: challenge.toUsername,
    color: challenge.color,
    timeControl: challenge.timeControl,
  };
}

function toWireOffer(offer: offers.Offer): WireOffer {
  return {
    id: offer.id,
    fromId: offer.fromId,
    fromUsername: offer.fromUsername,
    fromAvatar: offer.fromAvatar,
    fromRole: offer.fromRole,
    color: offer.color,
    timeControl: offer.timeControl,
  };
}

function toWireCard(summary: gamesService.GameSummary): WireGameCard {
  return {
    id: summary.id,
    whiteUsername: summary.white.username,
    whiteAvatar: summary.white.avatar,
    blackUsername: summary.black.username,
    blackAvatar: summary.black.avatar,
    timeControl: summary.timeControl,
    ply: summary.ply,
  };
}

/* --- rooms --------------------------------------------------------------- */

function joinRoom(connection: Connection, gameId: number) {
  let room = rooms.get(gameId);
  if (!room) {
    room = new Set();
    rooms.set(gameId, room);
  }
  room.add(connection);
  connection.watching.add(gameId);
}

function leaveRoom(connection: Connection, gameId: number) {
  const room = rooms.get(gameId);
  if (room) {
    room.delete(connection);
    if (room.size === 0) rooms.delete(gameId);
  }
  connection.watching.delete(gameId);
}

/** Push a game's state to everyone watching it, and re-arm its watchdog. */
function publishGame(state: gamesService.GameState) {
  broadcastToRoom(state.id, { t: "game", game: toWire(state) });
  scheduleFlagCheck(state);
}

/* --- the flag watchdog --------------------------------------------------- */

/**
 * A game can end with nobody touching it: the player to move simply runs out
 * of time. One timer per running game, set for the moment the clock hits zero
 * and re-armed on every move.
 *
 * The timer only *asks* the service to look. `claimFlag` re-reads the clock in
 * a transaction and does nothing if there is still time, so a timer that fires
 * early, late, or twice cannot end a game wrongly.
 */
function scheduleFlagCheck(state: gamesService.GameState) {
  const existing = watchdogs.get(state.id);
  if (existing) {
    clearTimeout(existing);
    watchdogs.delete(state.id);
  }

  if (state.status !== "active" || state.initialMs === 0) return;

  // state.clock already holds time remaining *now*, so measure from now.
  const ms = clock.msUntilFlag(
    {
      whiteMs: state.clock.whiteMs,
      blackMs: state.clock.blackMs,
      clockStartedAt: new Date(),
      turn: state.turn,
      initialMs: state.initialMs,
      incrementMs: state.incrementMs,
    },
    Date.now(),
  );
  if (ms === null) return;

  // A small margin, so the check lands after the clock has actually expired
  // rather than a millisecond before it.
  const timer = setTimeout(() => {
    watchdogs.delete(state.id);
    void (async () => {
      try {
        const outcome = await gamesService.claimFlag(state.id);
        if (outcome.ok) {
          publishGame(outcome.state);
          await publishLobby();
        }
      } catch (err) {
        console.error("[realtime] flag check failed", err);
      }
    })();
  }, ms + 250);

  timer.unref();
  watchdogs.set(state.id, timer);
}

/** On startup, re-arm the watchdog for every game that was in progress. */
async function armExistingGames() {
  const active = await gamesService.listActive();
  for (const summary of active) {
    const state = await gamesService.get(summary.id);
    if (state) scheduleFlagCheck(state);
  }
  if (active.length) {
    console.log(`[realtime] watching clocks on ${active.length} game(s)`);
  }
}

/* --- lobby and challenges ------------------------------------------------ */

async function publishLobby() {
  const active = await gamesService.listActive();
  broadcast({ t: "lobby", games: active.map(toWireCard) });
}

/**
 * Open offers, to everybody. Unlike a challenge an offer isn't addressed to
 * anyone, so the whole room needs the same list — and the accept button has to
 * disappear for the seven people who didn't get there first.
 */
async function publishOffers(only?: number) {
  const open = await offers.listOpen();
  const frame: ServerFrame = { t: "offers", offers: open.map(toWireOffer) };
  if (only === undefined) broadcast(frame);
  else sendToUser(only, frame);
}

async function publishChallenges(userId: number) {
  const [incoming, outgoing] = await Promise.all([
    challenges.listIncoming(userId),
    challenges.listOutgoing(userId),
  ]);
  sendToUser(userId, {
    t: "challenges",
    incoming: incoming.map(toWireChallenge),
    outgoing: outgoing.map(toWireChallenge),
  });
}

/* --- authorisation ------------------------------------------------------- */

/**
 * Re-resolve the member behind a connection before acting on their behalf.
 *
 * Every action does this rather than trusting the user captured at connect
 * time, so disabling an account, muting someone, or a parent switching chat
 * off all take effect on the next frame rather than the next login.
 */
async function currentUser(
  connection: Connection,
): Promise<SessionUser | null> {
  const fresh = await findSessionUserByToken(connection.token);
  if (!fresh) {
    connection.socket.close(4001, "session ended");
    return null;
  }
  connection.user = fresh;
  return fresh;
}

/* --- handlers ------------------------------------------------------------ */

function withinRateLimit(connection: Connection): boolean {
  const now = Date.now();
  const windowStart = now - chat.RATE_LIMIT.windowSeconds * 1000;
  connection.recentMessages = connection.recentMessages.filter(
    (at) => at > windowStart,
  );
  if (connection.recentMessages.length >= chat.RATE_LIMIT.messages) {
    return false;
  }
  connection.recentMessages.push(now);
  return true;
}

async function handleChat(
  connection: Connection,
  frame: { channel: string; body: string },
) {
  const target = parseChannel(frame.channel);
  if (!target) {
    notice(connection, "Unknown channel.");
    return;
  }

  const user = await currentUser(connection);
  if (!user) return;

  const speak = chat.canSpeak(user);
  if (!speak.ok) {
    notice(connection, speak.reason);
    return;
  }
  if (!withinRateLimit(connection)) {
    notice(connection, "Slow down a moment — too many messages at once.");
    return;
  }

  // Talking in a game room requires actually being in it.
  if (target.kind === "game" && !connection.watching.has(target.gameId)) {
    notice(connection, "Open the game before talking in it.");
    return;
  }

  try {
    const message = await chat.post({
      channel: frame.channel,
      userId: user.id,
      body: frame.body,
    });
    const wire: ServerFrame = {
      t: "chat",
      message: { ...message, createdAt: message.createdAt.toISOString() },
    };
    if (target.kind === "club") broadcast(wire);
    else broadcastToRoom(target.gameId, wire);
  } catch (err) {
    if (err instanceof ValidationError) {
      notice(connection, err.message);
      return;
    }
    console.error("[realtime] failed to post message", err);
    notice(connection, "That message didn't send. Try again.");
  }
}

async function handleWatch(connection: Connection, gameId: number) {
  const state = await gamesService.get(gameId);
  if (!state) {
    notice(connection, "That game doesn't exist.");
    return;
  }
  joinRoom(connection, gameId);
  send(connection.socket, { t: "game", game: toWire(state) });
  scheduleFlagCheck(state);
}

/** `handleGameAction`, detached — the socket's message loop cannot await. */
function detachGameAction(
  connection: Connection,
  gameId: number,
  action: (userId: number) => Promise<gamesService.MoveOutcome>,
) {
  detach("game action", () => handleGameAction(connection, gameId, action));
}

/**
 * Every game action goes through here: re-check who is asking, hand the action
 * to the service, publish whatever state comes back. The service decides
 * legality, turn order and clocks; this function decides nothing.
 */
async function handleGameAction(
  connection: Connection,
  gameId: number,
  action: (userId: number) => Promise<gamesService.MoveOutcome>,
) {
  const user = await currentUser(connection);
  if (!user) return;

  try {
    const outcome = await action(user.id);
    if (!outcome.ok) {
      notice(connection, outcome.reason);
      // Re-send the true state, so a client that got out of step is corrected
      // rather than left showing a move that never happened.
      const state = await gamesService.get(gameId);
      if (state) send(connection.socket, { t: "game", game: toWire(state) });
      return;
    }

    publishGame(outcome.state);
    if (outcome.state.status === "finished") await publishLobby();
  } catch (err) {
    if (err instanceof ValidationError) {
      notice(connection, err.message);
      return;
    }
    console.error("[realtime] game action failed", err);
    notice(connection, "That didn't work. Try again.");
  }
}

async function handleChallenge(connection: Connection, frame: ClientFrame) {
  const user = await currentUser(connection);
  if (!user) return;

  try {
    switch (frame.t) {
      case "challenge": {
        await challenges.create({
          fromId: user.id,
          toUsername: frame.username,
          timeControlKey: frame.timeControl,
          color: frame.color,
        });
        const opponent = await usersService.getByUsername(frame.username);
        await publishChallenges(user.id);
        if (opponent) await publishChallenges(opponent.id);
        break;
      }

      case "challengeAccept": {
        // Look the other party up first: once accepted, the challenge is no
        // longer open and can't be found.
        const opponentId = await challenges.otherPartyId(frame.id, user.id);
        const gameId = await challenges.accept(frame.id, user.id);

        await publishChallenges(user.id);
        if (opponentId) await publishChallenges(opponentId);

        // Both players are sent to the board.
        sendToUser(user.id, { t: "gameStarted", gameId });
        if (opponentId) sendToUser(opponentId, { t: "gameStarted", gameId });

        const state = await gamesService.get(gameId);
        if (state) scheduleFlagCheck(state);
        // Both players' boards came in with the challenge.
        await publishOffers();
        await publishLobby();
        break;
      }

      case "rematch": {
        const { opponentId, gameId } = await challenges.rematch({
          gameId: frame.gameId,
          fromId: user.id,
        });
        await publishChallenges(user.id);
        await publishChallenges(opponentId);

        // Null while it is still an offer: the other player's tap starts it.
        if (gameId !== null) {
          sendToUser(user.id, { t: "gameStarted", gameId });
          sendToUser(opponentId, { t: "gameStarted", gameId });
          const state = await gamesService.get(gameId);
          if (state) scheduleFlagCheck(state);
          await publishOffers();
          await publishLobby();
        }
        break;
      }

      case "challengeDecline": {
        const opponentId = await challenges.otherPartyId(frame.id, user.id);
        await challenges.decline(frame.id, user.id);
        await publishChallenges(user.id);
        if (opponentId) await publishChallenges(opponentId);
        break;
      }

      case "challengeCancel": {
        const opponentId = await challenges.otherPartyId(frame.id, user.id);
        await challenges.cancel(frame.id, user.id);
        await publishChallenges(user.id);
        if (opponentId) await publishChallenges(opponentId);
        break;
      }
    }
  } catch (err) {
    if (err instanceof ValidationError) {
      notice(connection, err.message);
      return;
    }
    console.error("[realtime] challenge action failed", err);
    notice(connection, "That didn't work. Try again.");
  }
}

/**
 * Open offers: putting a board out, taking it away, and taking somebody up on
 * one. Accepting is the only action here that can start a game, and the race
 * between two members tapping at once is settled in the service.
 */
async function handleOffer(connection: Connection, frame: ClientFrame) {
  const user = await currentUser(connection);
  if (!user) return;

  try {
    switch (frame.t) {
      case "offer":
        await offers.create({
          fromId: user.id,
          timeControlKey: frame.timeControl,
          color: frame.color,
        });
        await publishOffers();
        break;

      case "offerCancel":
        await offers.cancel(frame.id, user.id);
        await publishOffers();
        break;

      case "offerAccept": {
        const offererId = await offers.offererId(frame.id);
        const gameId = await offers.accept(frame.id, user.id);

        // Both players are sent to the board.
        sendToUser(user.id, { t: "gameStarted", gameId });
        if (offererId) sendToUser(offererId, { t: "gameStarted", gameId });

        await publishOffers();
        await publishChallenges(user.id);
        if (offererId) await publishChallenges(offererId);

        const state = await gamesService.get(gameId);
        if (state) scheduleFlagCheck(state);
        await publishLobby();
        break;
      }
    }
  } catch (err) {
    if (err instanceof ValidationError) {
      notice(connection, err.message);
      return;
    }
    console.error("[realtime] offer action failed", err);
    notice(connection, "That didn't work. Try again.");
  }
}

/* --- server -------------------------------------------------------------- */

const server = createServer((req, res) => {
  // The only plain HTTP route: a health check for the reverse proxy.
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        online: connections.size,
        rooms: rooms.size,
        clocksWatched: watchdogs.size,
      }),
    );
    return;
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", async (req, socket, head) => {
  const token = readCookie(req.headers.cookie, SESSION_COOKIE);
  const user = token ? await findSessionUserByToken(token) : null;

  if (!user || !token) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req, user, token);
  });
});

wss.on(
  "connection",
  (ws: WebSocket, _req: IncomingMessage, user: SessionUser, token: string) => {
    const connection: Connection = {
      socket: ws,
      user,
      token,
      watching: new Set(),
      recentMessages: [],
      alive: true,
    };

    const speak = chat.canSpeak(user);
    send(ws, {
      t: "ready",
      me: {
        id: user.id,
        username: user.username,
        avatar: user.avatar,
        role: user.role,
      },
      canChat: speak.ok,
      chatBlockedReason: speak.ok ? undefined : speak.reason,
    });

    detach("registering a connection", async () => {
      await register(connection);
      await publishChallenges(user.id);
      await publishOffers(user.id);
      await publishLobby();
    });

    ws.on("message", (data) => {
      const frame = decodeClientFrame(data.toString());
      if (!frame) return;

      switch (frame.t) {
        case "ping":
          send(ws, { t: "pong" });
          break;
        case "chat":
          detach("chat", () => handleChat(connection, frame));
          break;
        case "watch":
          detach("watching a game", () =>
            handleWatch(connection, frame.gameId),
          );
          break;
        case "unwatch":
          leaveRoom(connection, frame.gameId);
          break;
        case "move":
          detachGameAction(connection, frame.gameId, (userId) =>
            gamesService.playMove(frame.gameId, userId, {
              from: frame.from,
              to: frame.to,
              ...(frame.promotion ? { promotion: frame.promotion } : {}),
            }),
          );
          break;
        case "resign":
          detachGameAction(connection, frame.gameId, (userId) =>
            gamesService.resign(frame.gameId, userId),
          );
          break;
        case "draw":
          detachGameAction(connection, frame.gameId, (userId) =>
            gamesService.offerOrAcceptDraw(frame.gameId, userId),
          );
          break;
        case "drawCancel":
          detachGameAction(connection, frame.gameId, (userId) =>
            gamesService.clearDrawOffer(frame.gameId, userId),
          );
          break;
        case "offer":
        case "offerAccept":
        case "offerCancel":
          detach("offer", () => handleOffer(connection, frame));
          break;
        case "flag":
          // Anyone may ask; the service decides whether the clock really fell.
          detachGameAction(connection, frame.gameId, () =>
            gamesService.claimFlag(frame.gameId),
          );
          break;
        default:
          detach("challenge", () => handleChallenge(connection, frame));
      }
    });

    ws.on("pong", () => {
      connection.alive = true;
    });

    ws.on("close", () => {
      detach("unregistering a connection", () => unregister(connection));
    });

    ws.on("error", (err) => {
      console.error("[realtime] socket error", err);
    });
  },
);

/**
 * Ping every socket periodically. Drops connections whose client half has
 * vanished without a close frame (a laptop lid closing), and refreshes the
 * presence rows so the web tier's freshness check keeps passing.
 */
setInterval(() => {
  for (const set of connections.values()) {
    for (const connection of set) {
      if (!connection.alive) {
        connection.socket.terminate();
        continue;
      }
      connection.alive = false;
      connection.socket.ping();
    }
  }
  detach("presence heartbeat", () =>
    presence.heartbeat([...connections.keys()]),
  );
}, HEARTBEAT_MS).unref();

async function main() {
  // Counts left behind by a previous process are lies.
  await presence.resetAll();
  // By the same rule as above: nobody is connected, so no offer is genuine.
  await offers.expireAll();
  await armExistingGames();
  server.listen(REALTIME_PORT, () => {
    console.log(`[realtime] listening on :${REALTIME_PORT}`);
  });
}

/**
 * A last line of defence. Everything above routes its own failures through
 * `detach`, but a stray rejection anywhere else would otherwise end the
 * process and disconnect every member. Log it and keep serving: a socket
 * service that stays up with one broken operation is worth more to the club
 * than one that exits cleanly.
 */
process.on("unhandledRejection", (reason) => {
  console.error("[realtime] unhandled rejection", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[realtime] uncaught exception", err);
});

main().catch((err) => {
  // Startup is different: without the presence reset and the re-armed
  // watchdogs the service would be lying about who is online, so refuse to run.
  console.error("[realtime] failed to start", err);
  process.exit(1);
});
