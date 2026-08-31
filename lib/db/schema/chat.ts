import {
  bigserial,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * Chat channels. Only the clubhouse channel exists in phase 1; game channels
 * (`game:<id>`) arrive with chess in phase 2, which is why `channel` is a
 * plain string rather than an enum.
 */
export const CLUB_CHANNEL = "club";

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    channel: text("channel").notNull(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /**
     * Soft delete. An admin removing a message hides it from the clubhouse but
     * leaves it readable in parent/admin review — the point of moderation here
     * is that a parent can see what was said, not that it vanishes.
     */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: integer("deleted_by").references(() => users.id),
  },
  (t) => [
    index("chat_messages_channel_id_idx").on(t.channel, t.id),
    index("chat_messages_user_id_idx").on(t.userId),
  ],
);

/**
 * Administrative audit trail: who did what to whom. Written by the service
 * layer, never by UI code directly.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actorId: integer("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    detail: jsonb("detail"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("audit_log_created_at_idx").on(t.createdAt)],
);
