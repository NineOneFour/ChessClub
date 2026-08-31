/**
 * Wire protocol between the browser and the realtime service.
 *
 * Deliberately small and JSON — with eight kids there is no traffic to
 * optimise, and being able to read the frames in devtools is worth more than a
 * compact encoding.
 *
 * Members are identified on the wire by `username` and never by their real
 * name: real names are private to the family (see design.md §13), and the
 * simplest way to keep them private is for the socket to never carry one.
 *
 * This file has no imports on purpose. Both the browser bundle and the Node
 * service compile it, so nothing here may reach for the database, and the wire
 * types are declared structurally rather than borrowed from the services.
 * Dates cross the wire as ISO strings.
 */

/* --- client → server ----------------------------------------------------- */

export type ClientFrame =
  | { t: "ping" }
  | { t: "chat"; channel: string; body: string }
  /** Follow a game: its room's updates start arriving. */
  | { t: "watch"; gameId: number }
  | { t: "unwatch"; gameId: number }
  | { t: "move"; gameId: number; from: string; to: string; promotion?: string }
  | { t: "resign"; gameId: number }
  /** Offer a draw, or accept one already offered. */
  | { t: "draw"; gameId: number }
  | { t: "drawCancel"; gameId: number }
  /** Ask the server to check whether a clock has run out. */
  | { t: "flag"; gameId: number }
  | { t: "challenge"; username: string; timeControl: string; color: string }
  /** Put a board out for whoever is in the room. */
  | { t: "offer"; timeControl: string; color: string }
  | { t: "offerAccept"; id: number }
  | { t: "offerCancel"; id: number }
  /** Play again after a finished game: offers, or accepts theirs. */
  | { t: "rematch"; gameId: number }
  | { t: "challengeAccept"; id: number }
  | { t: "challengeDecline"; id: number }
  | { t: "challengeCancel"; id: number };

/* --- shared shapes ------------------------------------------------------- */

export type OnlineMember = {
  id: number;
  username: string;
  avatar: string;
  role: string;
};

export type ServerChatMessage = {
  id: number;
  channel: string;
  userId: number;
  username: string;
  avatar: string;
  role: string;
  body: string;
  /** ISO-8601; the browser turns it back into a Date. */
  createdAt: string;
};

export type WirePlayer = {
  id: number;
  username: string;
  avatar: string;
  role: string;
};

export type WireMove = {
  ply: number;
  san: string;
  uci: string;
  fenAfter: string;
  whiteMs: number;
  blackMs: number;
};

/**
 * A game as the browser sees it. Note `dests` and `promotions`: the client is
 * *told* what is legal and holds no chess logic of its own.
 */
export type WireGame = {
  id: number;
  white: WirePlayer;
  black: WirePlayer;
  initialMs: number;
  incrementMs: number;
  timeControl: string;

  status: "active" | "finished";
  result: "1-0" | "0-1" | "1/2-1/2" | null;
  resultReason: string | null;
  winnerId: number | null;

  fen: string;
  ply: number;
  turn: "white" | "black";
  dests: Record<string, string[]>;
  promotions: Record<string, string[]>;
  inCheck: boolean;
  lastMove: { from: string; to: string } | null;

  /**
   * Time remaining for each side *as of when this frame was sent*. The browser
   * counts down from the moment it receives it, using its own clock — never by
   * comparing against a server timestamp, which would be wrong by however far
   * the two machines disagree.
   */
  clock: { whiteMs: number; blackMs: number; running: boolean };
  drawOfferBy: number | null;

  moves: WireMove[];
  startedAt: string;
  finishedAt: string | null;
};

export type WireChallenge = {
  id: number;
  fromId: number;
  fromUsername: string;
  fromAvatar: string;
  toId: number;
  toUsername: string;
  color: string;
  timeControl: string;
};

export type WireOffer = {
  id: number;
  fromId: number;
  fromUsername: string;
  fromAvatar: string;
  fromRole: string;
  color: string;
  timeControl: string;
};

export type WireGameCard = {
  id: number;
  whiteUsername: string;
  whiteAvatar: string;
  blackUsername: string;
  blackAvatar: string;
  timeControl: string;
  ply: number;
};

/* --- server → client ----------------------------------------------------- */

export type ServerFrame =
  | {
      t: "ready";
      me: OnlineMember;
      canChat: boolean;
      chatBlockedReason?: string;
    }
  | { t: "presence"; online: OnlineMember[] }
  | { t: "chat"; message: ServerChatMessage }
  | { t: "notice"; message: string }
  | { t: "pong" }
  /** Full state for one game. Never a diff — see design.md §5. */
  | { t: "game"; game: WireGame }
  /** A game involving you has just begun; the clubhouse navigates to it. */
  | { t: "gameStarted"; gameId: number }
  | { t: "challenges"; incoming: WireChallenge[]; outgoing: WireChallenge[] }
  /** Every open offer. Public to the club, so this one is broadcast. */
  | { t: "offers"; offers: WireOffer[] }
  /** Games in progress, for the clubhouse's watch list. */
  | { t: "lobby"; games: WireGameCard[] };

export function encode(frame: ServerFrame | ClientFrame): string {
  return JSON.stringify(frame);
}

function isSquare(value: unknown): value is string {
  return typeof value === "string" && /^[a-h][1-8]$/.test(value);
}

function isId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/**
 * Parse an incoming frame, rejecting anything malformed.
 *
 * This is only a shape check. Whether the sender may actually make the move,
 * resign that game or speak in that channel is decided by the server against
 * the database — never here.
 */
export function decodeClientFrame(raw: string): ClientFrame | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const f = parsed as Record<string, unknown>;

  switch (f.t) {
    case "ping":
      return { t: "ping" };

    case "chat":
      return typeof f.channel === "string" && typeof f.body === "string"
        ? { t: "chat", channel: f.channel, body: f.body }
        : null;

    case "watch":
      return isId(f.gameId) ? { t: "watch", gameId: f.gameId } : null;
    case "unwatch":
      return isId(f.gameId) ? { t: "unwatch", gameId: f.gameId } : null;
    case "resign":
      return isId(f.gameId) ? { t: "resign", gameId: f.gameId } : null;
    case "draw":
      return isId(f.gameId) ? { t: "draw", gameId: f.gameId } : null;
    case "drawCancel":
      return isId(f.gameId) ? { t: "drawCancel", gameId: f.gameId } : null;
    case "flag":
      return isId(f.gameId) ? { t: "flag", gameId: f.gameId } : null;

    case "move":
      if (!isId(f.gameId) || !isSquare(f.from) || !isSquare(f.to)) return null;
      if (
        f.promotion !== undefined &&
        !(typeof f.promotion === "string" && /^[qrbn]$/.test(f.promotion))
      ) {
        return null;
      }
      return {
        t: "move",
        gameId: f.gameId,
        from: f.from,
        to: f.to,
        ...(typeof f.promotion === "string" ? { promotion: f.promotion } : {}),
      };

    case "challenge":
      return typeof f.username === "string" &&
        typeof f.timeControl === "string" &&
        typeof f.color === "string"
        ? {
            t: "challenge",
            username: f.username,
            timeControl: f.timeControl,
            color: f.color,
          }
        : null;

    case "offer":
      return typeof f.timeControl === "string" && typeof f.color === "string"
        ? { t: "offer", timeControl: f.timeControl, color: f.color }
        : null;

    case "offerAccept":
      return isId(f.id) ? { t: "offerAccept", id: f.id } : null;
    case "offerCancel":
      return isId(f.id) ? { t: "offerCancel", id: f.id } : null;

    case "rematch":
      return isId(f.gameId) ? { t: "rematch", gameId: f.gameId } : null;

    case "challengeAccept":
      return isId(f.id) ? { t: "challengeAccept", id: f.id } : null;
    case "challengeDecline":
      return isId(f.id) ? { t: "challengeDecline", id: f.id } : null;
    case "challengeCancel":
      return isId(f.id) ? { t: "challengeCancel", id: f.id } : null;

    default:
      return null;
  }
}

/** Channel names the server accepts: the clubhouse, or one game's room. */
export function parseChannel(
  channel: string,
): { kind: "club" } | { kind: "game"; gameId: number } | null {
  if (channel === "club") return { kind: "club" };
  const match = /^game:(\d+)$/.exec(channel);
  if (!match) return null;
  const gameId = Number(match[1]);
  return gameId > 0 ? { kind: "game", gameId } : null;
}

export function gameChannel(gameId: number): string {
  return `game:${gameId}`;
}
