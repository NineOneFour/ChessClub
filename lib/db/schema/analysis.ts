import {
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { games } from "./games";

/**
 * Stockfish analysis of finished games. See design.md §17.
 *
 * Two tables, and the split is the whole design: `game_analysis` is the queue
 * *and* the record of what the engine was, and `game_move_analysis` is the
 * evidence — one row per half-move, kept forever. The brief asks that stored
 * analysis let historical ratings be recalculated as the algorithm improves, so
 * nothing here is a summary. Averages, blunder counts and skill estimates are
 * all derived on read from these rows.
 */

export const ANALYSIS_STATUSES = [
  "queued",
  "running",
  "done",
  "failed",
] as const;
export type AnalysisStatus = (typeof ANALYSIS_STATUSES)[number];

/**
 * How a played move compares with what the engine wanted. Thresholds live in
 * `lib/chess/evaluation.ts` — they are a judgement about children's chess, not
 * a fact about the game.
 */
export const MOVE_QUALITIES = [
  "best",
  "good",
  "inaccuracy",
  "mistake",
  "blunder",
] as const;
export type MoveQuality = (typeof MOVE_QUALITIES)[number];

/**
 * One row per game, created when the game finishes — inside the same
 * transaction, so a finished game is always a queued game and there is no
 * sweeper to write.
 */
export const gameAnalysis = pgTable(
  "game_analysis",
  {
    gameId: integer("game_id")
      .primaryKey()
      .references(() => games.id, { onDelete: "cascade" }),

    status: text("status").notNull().default("queued"),

    /**
     * What produced this analysis. Stored because the numbers are only
     * comparable within an engine and a depth: "Stockfish 17.1" at depth 16 is
     * not the same yardstick as depth 12, and a rating recalculated across both
     * needs to know which rows are which.
     */
    engine: text("engine"),
    depth: integer("depth"),

    /** Bumped on each attempt, so a game that always fails stops being retried. */
    attempts: integer("attempts").notNull().default(0),
    /** The last failure, for the admin page. Cleared on success. */
    error: text("error"),

    queuedAt: timestamp("queued_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    /** The worker's one query: the oldest queued game. */
    index("game_analysis_status_idx").on(t.status, t.queuedAt),
  ],
);

/**
 * One row per half-move.
 *
 * Every centipawn figure is **from the point of view of the player who moved**,
 * so a positive number is good for them whichever colour they are. That is the
 * only convention that makes `lossCp` mean one thing, and getting it wrong is
 * the classic way an analysis pipeline produces confident nonsense.
 */
export const gameMoveAnalysis = pgTable(
  "game_move_analysis",
  {
    gameId: integer("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    /** 1-based half-move, matching game_moves.ply. Odd is white. */
    ply: integer("ply").notNull(),

    /**
     * The position before the move, played perfectly: what the mover could have
     * had. Clamped — see EVAL_CLAMP_CP.
     */
    evalBeforeCp: integer("eval_before_cp").notNull(),
    /** The position after the move they actually played, same point of view. */
    evalAfterCp: integer("eval_after_cp").notNull(),
    /** `evalBeforeCp - evalAfterCp`, floored at zero. The cost of the move. */
    lossCp: integer("loss_cp").notNull(),

    /** What the engine would have played, in UCI. */
    bestUci: text("best_uci"),
    /** One of MOVE_QUALITIES. */
    quality: text("quality").notNull(),

    /**
     * Signed distance to mate when the engine reported one rather than a
     * centipawn score, mover's point of view: 3 is "I mate in 3", -2 is "I am
     * mated in 2". Null when the score was an ordinary evaluation.
     *
     * Kept beside the clamped centipawns because a rating module wants to know
     * the difference between a won game and a mate that was actually there.
     */
    mateBefore: integer("mate_before"),
    mateAfter: integer("mate_after"),
  },
  (t) => [
    primaryKey({ columns: [t.gameId, t.ply] }),
    index("game_move_analysis_game_idx").on(t.gameId, t.ply),
  ],
);
