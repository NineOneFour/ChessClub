import { sql } from "drizzle-orm";
import {
  index,
  integer,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * Chess. The database is the authority on every game: the realtime service is
 * transport and a clock watchdog, not the source of truth. A move is a
 * transaction against these rows, so a crash of the socket service loses
 * nothing and a reconnecting player reads the same state everyone else sees.
 */

/** How a finished game ended. Drives the wording shown to the players. */
export const RESULT_REASONS = [
  "checkmate",
  "resignation",
  "stalemate",
  "insufficient_material",
  "fifty_move",
  "threefold",
  "flag",
  "agreement",
] as const;
export type ResultReason = (typeof RESULT_REASONS)[number];

/** Standard PGN result strings. */
export const RESULTS = ["1-0", "0-1", "1/2-1/2"] as const;
export type Result = (typeof RESULTS)[number];

export const games = pgTable(
  "games",
  {
    id: serial("id").primaryKey(),
    whiteId: integer("white_id")
      .notNull()
      .references(() => users.id),
    blackId: integer("black_id")
      .notNull()
      .references(() => users.id),

    /** Starting time per side in milliseconds. 0 means untimed. */
    initialMs: integer("initial_ms").notNull(),
    /** Added to a player's clock after each of their moves, in milliseconds. */
    incrementMs: integer("increment_ms").notNull(),

    status: text("status").notNull().default("active"),
    result: text("result"),
    resultReason: text("result_reason"),
    /** Null for a draw. */
    winnerId: integer("winner_id").references(() => users.id),

    /** Position after the last played move. */
    fen: text("fen").notNull(),
    /** Half-moves played. Even means white is to move. */
    ply: integer("ply").notNull().default(0),

    /**
     * Clocks as they stood *at* `clockStartedAt`. The player to move is
     * spending time since then; everyone derives the live figure rather than
     * storing a ticking value. See lib/chess/clock.ts.
     */
    whiteMs: integer("white_ms").notNull(),
    blackMs: integer("black_ms").notNull(),
    clockStartedAt: timestamp("clock_started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    /** Who has a draw offer outstanding, if anyone. */
    drawOfferBy: integer("draw_offer_by").references(() => users.id),

    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("games_status_idx").on(t.status, t.id),
    index("games_white_idx").on(t.whiteId),
    index("games_black_idx").on(t.blackId),
  ],
);

/**
 * The move list, one row per half-move. `fenAfter` is stored so reviewing a
 * finished game can jump to any position without replaying, and so the
 * transcript of a game is readable straight out of the database.
 */
export const gameMoves = pgTable(
  "game_moves",
  {
    gameId: integer("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    /** 1-based half-move number. */
    ply: integer("ply").notNull(),
    uci: text("uci").notNull(),
    san: text("san").notNull(),
    fenAfter: text("fen_after").notNull(),
    /** Clocks after this move, in milliseconds. */
    whiteMs: integer("white_ms").notNull(),
    blackMs: integer("black_ms").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.ply] })],
);

/**
 * A challenge from one member to another. There is no matchmaking and no
 * open-seek pool: you challenge someone you can see in the clubhouse, which is
 * how it works at a real club.
 */
export const challenges = pgTable(
  "challenges",
  {
    id: serial("id").primaryKey(),
    fromId: integer("from_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    toId: integer("to_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    initialMs: integer("initial_ms").notNull(),
    incrementMs: integer("increment_ms").notNull(),
    /** Colour the challenger asked for: "white", "black" or "random". */
    color: text("color").notNull().default("random"),
    status: text("status").notNull().default("open"),
    gameId: integer("game_id").references(() => games.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    index("challenges_to_status_idx").on(t.toId, t.status),
    /**
     * At most one open challenge between the same two members in the same
     * direction, so a kid mashing the button doesn't create a queue.
     */
    uniqueIndex("challenges_open_pair_key")
      .on(t.fromId, t.toId)
      .where(sql`status = 'open'`),
  ],
);
