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
    /** Lower-cased login handle. Unique across the club. */
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

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("users_username_key").on(t.username)],
);

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
