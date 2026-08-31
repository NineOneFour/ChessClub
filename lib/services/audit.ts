import { desc, eq } from "drizzle-orm";
import { db } from "../db";
import { auditLog, users } from "../db/schema";

/**
 * Every administrative or parental action that changes an account goes through
 * here. Cheap to write, and it answers "who disabled that account?" months
 * later without guesswork.
 */
export async function record(entry: {
  actorId: number | null;
  action: string;
  targetType?: string;
  targetId?: string | number;
  detail?: Record<string, unknown>;
}) {
  await db.insert(auditLog).values({
    actorId: entry.actorId,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId === undefined ? null : String(entry.targetId),
    detail: entry.detail ?? null,
  });
}

export type AuditEntry = {
  id: number;
  action: string;
  targetType: string | null;
  targetId: string | null;
  detail: unknown;
  createdAt: Date;
  actorName: string | null;
};

export function listRecent(limit = 200): Promise<AuditEntry[]> {
  return db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      targetType: auditLog.targetType,
      targetId: auditLog.targetId,
      detail: auditLog.detail,
      createdAt: auditLog.createdAt,
      actorName: users.displayName,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorId))
    .orderBy(desc(auditLog.id))
    .limit(limit);
}
