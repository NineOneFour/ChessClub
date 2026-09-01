import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Roles. `admin` runs the club, `parent` manages their own children,
 * `child` plays chess. See design.md §3.
 */
export const ROLES = ["admin", "parent", "child"] as const;
export type Role = (typeof ROLES)[number];

/**
 * A real-world household. Children belong to a family; parents belong to the
 * same family and may manage any child in it (so two parents both work
 * without a second relationship table).
 */
export const families = pgTable("families", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    /**
     * Login handle. The case the member chose is preserved for display;
     * identity and uniqueness are case-insensitive (see `usernameEquals()`)
     * so a child typing `terry` or `TERRY` still reaches `Terry`.
     */
    username: text("username").notNull(),
    /**
     * The member's real-world name. Free-form, may contain spaces/caps.
     *
     * Private: shown only to the member themselves and to grown-ups in the
     * same family. Everyone else — including the administrator, for families
     * other than their own — sees the username. See design.md §13.
     */
    realName: text("real_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role").notNull(),
    /** Null only for the administrator, who belongs to no family. */
    familyId: integer("family_id").references(() => families.id),
    /** Optional, parents only — recovery contact. Never collected for children. */
    email: text("email"),
    /** Key into AVATARS in lib/avatars.ts. Presets only; no uploads. */
    avatar: text("avatar").notNull().default("pawn"),

    /** Admin switch. A disabled account cannot log in and its sessions die. */
    isActive: boolean("is_active").notNull().default(true),
    /** Parental control: may this child use chat at all. */
    chatEnabled: boolean("chat_enabled").notNull().default(true),
    /** Admin control: temporarily silenced in chat. */
    isMuted: boolean("is_muted").notNull().default(false),
    /**
     * Parental control: may this child talk in a game room.
     *
     * The narrower switch. `chatEnabled` is the master — off means no chat
     * anywhere — and this one closes the game rooms while leaving the clubhouse
     * open, for a parent who is happy with the clubhouse but not with a running
     * commentary during somebody's game. See `chat.canSpeak`.
     */
    gameChatEnabled: boolean("game_chat_enabled").notNull().default(true),
    /**
     * Parental control: may this child change their own username and avatar.
     * Off means the grown-ups choose what the club calls them. It does not
     * cover the board and the pieces, which only the member ever sees.
     */
    canCustomize: boolean("can_customize").notNull().default(true),

    /**
     * Playing hours, as minutes from local midnight — 16 * 60 is 4pm. Both
     * null means no restriction, which is the default and how every account
     * starts.
     *
     * A window that ends before it starts spans midnight (22:00 to 07:00), so
     * "not after bedtime" needs no second row. Server local time; see
     * lib/play-window.ts, which is the only place that reads these.
     */
    playFromMinute: integer("play_from_minute"),
    playToMinute: integer("play_to_minute"),

    /** Key into BOARD_STYLES in lib/board-styles.ts. The member's own view. */
    boardStyle: text("board_style").notNull().default("scoresheet"),
    /** Key into PIECE_SETS in lib/board-styles.ts. */
    pieceSet: text("piece_set").notNull().default("scoresheet"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("users_username_key").on(sql`lower(${t.username})`)],
);

/** Case-insensitive match against the stored username — casing is display-only. */
export function usernameEquals(value: string) {
  return sql`lower(${users.username}) = lower(${value})`;
}

/**
 * Database-backed sessions. The browser holds a random token; we store only
 * its SHA-256 hash. Deleting the row logs the member out immediately, which is
 * what makes "disable this account" and "log everyone out" actually work.
 */
export const sessions = pgTable(
  "sessions",
  {
    /** SHA-256 of the session token, hex encoded. */
    tokenHash: text("token_hash").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    userAgent: text("user_agent"),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

/**
 * Single-use invitation links. There is no public signup route; this table is
 * the only path to a new account other than a parent creating a child.
 *
 * `familyId` null  -> accepting creates a new family named `familyName`
 * `familyId` set   -> accepting adds a second parent to an existing family
 */
export const invitations = pgTable(
  "invitations",
  {
    id: serial("id").primaryKey(),
    tokenHash: text("token_hash").notNull(),
    familyName: text("family_name"),
    familyId: integer("family_id").references(() => families.id),
    note: text("note"),
    createdBy: integer("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedBy: integer("accepted_by").references(() => users.id),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("invitations_token_hash_key").on(t.tokenHash)],
);

/**
 * Presence, owned by the realtime service. `connections` is the number of live
 * WebSockets for that member (a kid with two tabs open counts twice).
 * The web tier reads this for the first server render; live updates arrive
 * over the socket.
 */
export const presence = pgTable("presence", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  connections: integer("connections").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
