import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { families, invitations, users } from "../db/schema";
import { generateToken, hashToken } from "../auth/tokens";
import { INVITATION_TTL_DAYS, PUBLIC_ORIGIN } from "../config";
import { fail, optionalText, requireText } from "../validation";
import * as audit from "./audit";
import * as usersService from "./users";

/**
 * Invitations are the only way a family joins the club. Accepting one creates
 * a *parent* account; that parent then creates their children's logins. A
 * member never gains the ability to invite anyone — only the administrator
 * creates invitations.
 */

/**
 * `status` is derived in the service rather than in the page, because working
 * it out needs the current time and a component must stay pure.
 */
export type InvitationStatus = "open" | "accepted" | "revoked" | "expired";

export type Invitation = {
  id: number;
  familyName: string | null;
  familyId: number | null;
  existingFamilyName: string | null;
  note: string | null;
  createdAt: Date;
  expiresAt: Date;
  acceptedAt: Date | null;
  acceptedByName: string | null;
  revokedAt: Date | null;
  status: InvitationStatus;
};

/**
 * Mint an invitation. Returns the one-time link — this is the only moment the
 * raw token exists, so the caller must show it to the admin immediately.
 *
 * Pass `familyName` for a brand-new family, or `familyId` to add a second
 * parent to a family that already exists.
 */
export async function create(input: {
  familyName?: unknown;
  familyId?: number | null;
  note?: unknown;
  actorId: number;
}): Promise<{ id: number; url: string; expiresAt: Date }> {
  const familyId = input.familyId ?? null;
  const familyName =
    familyId === null
      ? requireText(input.familyName, "Family name", { max: 80 })
      : null;

  const token = generateToken();
  const expiresAt = new Date(
    Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000,
  );

  const rows = await db
    .insert(invitations)
    .values({
      tokenHash: hashToken(token),
      familyName,
      familyId,
      note: optionalText(input.note, "Note", 300),
      createdBy: input.actorId,
      expiresAt,
    })
    .returning({ id: invitations.id });

  const id = rows[0].id;
  await audit.record({
    actorId: input.actorId,
    action: "invitation.create",
    targetType: "invitation",
    targetId: id,
    detail: { familyName, familyId },
  });

  return { id, url: `${PUBLIC_ORIGIN}/join/${token}`, expiresAt };
}

export async function listAll(): Promise<Invitation[]> {
  const now = Date.now();
  const rows = await db
    .select({
      id: invitations.id,
      familyName: invitations.familyName,
      familyId: invitations.familyId,
      existingFamilyName: families.name,
      note: invitations.note,
      createdAt: invitations.createdAt,
      expiresAt: invitations.expiresAt,
      acceptedAt: invitations.acceptedAt,
      acceptedByName: users.displayName,
      revokedAt: invitations.revokedAt,
    })
    .from(invitations)
    .leftJoin(families, eq(families.id, invitations.familyId))
    .leftJoin(users, eq(users.id, invitations.acceptedBy))
    .orderBy(desc(invitations.id));

  return rows.map((row) => ({
    ...row,
    status: row.acceptedAt
      ? "accepted"
      : row.revokedAt
        ? "revoked"
        : row.expiresAt.getTime() < now
          ? "expired"
          : "open",
  }));
}

export async function revoke(id: number, actorId: number) {
  await db
    .update(invitations)
    .set({ revokedAt: new Date() })
    .where(and(eq(invitations.id, id), isNull(invitations.acceptedAt)));
  await audit.record({
    actorId,
    action: "invitation.revoke",
    targetType: "invitation",
    targetId: id,
  });
}

export type PendingInvitation = {
  id: number;
  familyName: string | null;
  familyId: number | null;
  existingFamilyName: string | null;
};

/**
 * Look up an invitation by its raw token. Returns null unless it is still
 * usable: not accepted, not revoked, not expired.
 */
export async function findUsable(
  token: string,
): Promise<PendingInvitation | null> {
  const rows = await db
    .select({
      id: invitations.id,
      familyName: invitations.familyName,
      familyId: invitations.familyId,
      existingFamilyName: families.name,
      expiresAt: invitations.expiresAt,
      acceptedAt: invitations.acceptedAt,
      revokedAt: invitations.revokedAt,
    })
    .from(invitations)
    .leftJoin(families, eq(families.id, invitations.familyId))
    .where(eq(invitations.tokenHash, hashToken(token)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (row.acceptedAt || row.revokedAt) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;

  return {
    id: row.id,
    familyName: row.familyName,
    familyId: row.familyId,
    existingFamilyName: row.existingFamilyName,
  };
}

/**
 * Redeem an invitation, creating the family (if new) and the parent account.
 * Single-use is enforced by re-checking the invitation inside the
 * transaction, so two people opening the same link can't both claim it.
 */
export async function accept(input: {
  token: string;
  username: unknown;
  displayName: unknown;
  password: unknown;
  email?: unknown;
}): Promise<number> {
  // Validate the form before claiming the link, so a typo'd username doesn't
  // burn a single-use invitation.
  await usersService.assertCanCreate({
    username: input.username,
    displayName: input.displayName,
    password: input.password,
  });

  const tokenHash = hashToken(input.token);

  const claimed = await db
    .update(invitations)
    .set({ acceptedAt: new Date() })
    .where(
      and(
        eq(invitations.tokenHash, tokenHash),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
      ),
    )
    .returning({
      id: invitations.id,
      familyName: invitations.familyName,
      familyId: invitations.familyId,
      expiresAt: invitations.expiresAt,
    });

  const invite = claimed[0];
  if (!invite) fail("That invitation link has already been used.");
  if (invite.expiresAt.getTime() < Date.now()) {
    fail("That invitation link has expired. Ask for a new one.");
  }

  const familyId =
    invite.familyId ?? (await usersService.createFamily(invite.familyName!));

  let userId: number;
  try {
    userId = await usersService.create({
      username: input.username,
      displayName: input.displayName,
      password: input.password,
      role: "parent",
      familyId,
      email: input.email,
      actorId: null,
    });
  } catch (err) {
    // Give the link back if account creation failed (e.g. username taken).
    await db
      .update(invitations)
      .set({ acceptedAt: null })
      .where(eq(invitations.id, invite.id));
    throw err;
  }

  await db
    .update(invitations)
    .set({ acceptedBy: userId })
    .where(eq(invitations.id, invite.id));

  await audit.record({
    actorId: userId,
    action: "invitation.accept",
    targetType: "invitation",
    targetId: invite.id,
    detail: { userId, familyId },
  });

  return userId;
}
