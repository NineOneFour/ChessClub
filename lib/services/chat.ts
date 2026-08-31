import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { chatMessages, users, CLUB_CHANNEL } from "../db/schema";
import { cleanChatBody, fail } from "../validation";
import * as audit from "./audit";

export type ChatMessage = {
  id: number;
  channel: string;
  userId: number;
  username: string;
  avatar: string;
  /** Carried so the transcript can tag grown-ups. See lib/roles.ts. */
  role: string;
  body: string;
  createdAt: Date;
};

const publicColumns = {
  id: chatMessages.id,
  channel: chatMessages.channel,
  userId: chatMessages.userId,
  username: users.username,
  avatar: users.avatar,
  role: users.role,
  body: chatMessages.body,
  createdAt: chatMessages.createdAt,
};

/**
 * Post a message. Callers must already know the author is allowed to speak —
 * `canSpeak` below is the check, and both the web tier and the realtime
 * service run it.
 */
export async function post(input: {
  channel: string;
  userId: number;
  body: unknown;
}): Promise<ChatMessage> {
  const body = cleanChatBody(input.body);
  const inserted = await db
    .insert(chatMessages)
    .values({ channel: input.channel, userId: input.userId, body })
    .returning({ id: chatMessages.id, createdAt: chatMessages.createdAt });

  const author = await db
    .select({
      username: users.username,
      avatar: users.avatar,
      role: users.role,
    })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);

  return {
    id: inserted[0].id,
    channel: input.channel,
    userId: input.userId,
    username: author[0]?.username ?? "someone",
    avatar: author[0]?.avatar ?? "pawn",
    role: author[0]?.role ?? "child",
    body,
    createdAt: inserted[0].createdAt,
  };
}

/**
 * May this member speak in this channel?
 *
 * Three switches, and the order they are tested in is the order of authority:
 *
 * - An **admin mute** silences a member everywhere. Only an admin lifts it.
 * - **Chat off** is the parent's master switch: no clubhouse, no game rooms.
 * - **Game chat off** is the narrower one, and closes the game rooms while
 *   leaving the clubhouse alone. A parent who is happy with the clubhouse but
 *   not with a running commentary during somebody's game wants this and not the
 *   master switch.
 *
 * Returns the reason so the UI can say which it is, in words a child can act
 * on. Both the web tier and the realtime service call this — it is the check,
 * not a hint for the UI.
 */
export function canSpeak(
  member: {
    chatEnabled: boolean;
    gameChatEnabled: boolean;
    isMuted: boolean;
  },
  channel: string = CLUB_CHANNEL,
): { ok: true } | { ok: false; reason: string } {
  if (member.isMuted) {
    return { ok: false, reason: "You're muted in chat right now." };
  }
  if (!member.chatEnabled) {
    return { ok: false, reason: "Chat is switched off for your account." };
  }
  if (channel !== CLUB_CHANNEL && !member.gameChatEnabled) {
    return {
      ok: false,
      reason: "Chatting during games is switched off for your account.",
    };
  }
  return { ok: true };
}

/**
 * The visible transcript, oldest-first. Deleted messages are omitted here and
 * only shown in parent/admin review.
 */
export async function listVisible(
  channel = CLUB_CHANNEL,
  limit = 100,
): Promise<ChatMessage[]> {
  const rows = await db
    .select(publicColumns)
    .from(chatMessages)
    .innerJoin(users, eq(users.id, chatMessages.userId))
    .where(and(eq(chatMessages.channel, channel), isNull(chatMessages.deletedAt)))
    .orderBy(desc(chatMessages.id))
    .limit(limit);
  return rows.reverse();
}

export type ReviewMessage = ChatMessage & {
  deletedAt: Date | null;
};

/**
 * Review transcript for parents and admins. Includes deleted messages —
 * the point of review is seeing what was said, not what survived.
 */
export function listForReview(options: {
  channel?: string;
  userId?: number;
  limit?: number;
}): Promise<ReviewMessage[]> {
  const filters = [];
  if (options.channel) filters.push(eq(chatMessages.channel, options.channel));
  if (options.userId) filters.push(eq(chatMessages.userId, options.userId));

  return db
    .select({ ...publicColumns, deletedAt: chatMessages.deletedAt })
    .from(chatMessages)
    .innerJoin(users, eq(users.id, chatMessages.userId))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(chatMessages.id))
    .limit(options.limit ?? 200);
}

export async function softDelete(
  messageId: number,
  actorId: number,
): Promise<void> {
  const updated = await db
    .update(chatMessages)
    .set({ deletedAt: new Date(), deletedBy: actorId })
    .where(and(eq(chatMessages.id, messageId), isNull(chatMessages.deletedAt)))
    .returning({ id: chatMessages.id });
  if (!updated.length) fail("That message is already gone.");
  await audit.record({
    actorId,
    action: "chat.delete",
    targetType: "chat_message",
    targetId: messageId,
  });
}

/**
 * Chat rate limit, enforced in memory by the realtime service (the only path
 * a message can arrive by). Lives here so the number sits next to the rest of
 * the chat rules.
 */
export const RATE_LIMIT = { messages: 8, windowSeconds: 10 };
