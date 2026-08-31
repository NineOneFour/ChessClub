import { and, asc, eq, ne, sql } from "drizzle-orm";
import { db } from "../db";
import { families, presence, users } from "../db/schema";
import { hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from "../auth/password";
import { deleteSessionsForUser } from "../auth/session-store";
import { isAvatarKey } from "../avatars";
import { PRESENCE_STALE_SECONDS } from "../config";
import {
  fail,
  normalizeUsername,
  optionalEmail,
  requireText,
  ValidationError,
} from "../validation";
import * as audit from "./audit";
import type { Role } from "../db/schema";

export type Member = {
  id: number;
  username: string;
  displayName: string;
  role: string;
  familyId: number | null;
  familyName: string | null;
  avatar: string;
  isActive: boolean;
  chatEnabled: boolean;
  isMuted: boolean;
  email: string | null;
  createdAt: Date;
  lastSeenAt: Date | null;
};

const memberColumns = {
  id: users.id,
  username: users.username,
  displayName: users.displayName,
  role: users.role,
  familyId: users.familyId,
  familyName: families.name,
  avatar: users.avatar,
  isActive: users.isActive,
  chatEnabled: users.chatEnabled,
  isMuted: users.isMuted,
  email: users.email,
  createdAt: users.createdAt,
  lastSeenAt: users.lastSeenAt,
};

/** True while the realtime service is holding a live socket for this member. */
const isOnlineExpr = sql<boolean>`
  coalesce(${presence.connections}, 0) > 0
  and ${presence.updatedAt} > now() - (${PRESENCE_STALE_SECONDS} * interval '1 second')
`;

function validatePassword(raw: unknown): string {
  const value = String(raw ?? "");
  if (value.length < MIN_PASSWORD_LENGTH) {
    fail(`Passwords must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (value.length > 200) fail("That password is too long.");
  return value;
}

/**
 * Verify a login. Returns the user id on success, null on any failure —
 * wrong username, wrong password and disabled account are deliberately
 * indistinguishable to the caller.
 */
export async function authenticate(
  rawUsername: unknown,
  rawPassword: unknown,
): Promise<number | null> {
  let username: string;
  try {
    username = normalizeUsername(rawUsername);
  } catch (err) {
    if (err instanceof ValidationError) return null;
    throw err;
  }

  const rows = await db
    .select({
      id: users.id,
      passwordHash: users.passwordHash,
      isActive: users.isActive,
    })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (!(await verifyPassword(row.passwordHash, String(rawPassword ?? "")))) {
    return null;
  }
  if (!row.isActive) return null;
  return row.id;
}

export async function getById(id: number): Promise<Member | null> {
  const rows = await db
    .select(memberColumns)
    .from(users)
    .leftJoin(families, eq(families.id, users.familyId))
    .where(eq(users.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function getByUsername(username: string): Promise<Member | null> {
  const rows = await db
    .select(memberColumns)
    .from(users)
    .leftJoin(families, eq(families.id, users.familyId))
    .where(eq(users.username, username.toLowerCase()))
    .limit(1);
  return rows[0] ?? null;
}

/** Every account, for the admin roster. */
export function listAll(): Promise<Member[]> {
  return db
    .select(memberColumns)
    .from(users)
    .leftJoin(families, eq(families.id, users.familyId))
    .orderBy(asc(users.role), asc(users.displayName));
}

/** The children a given parent manages (everyone else in their family). */
export function listChildrenOfFamily(familyId: number): Promise<Member[]> {
  return db
    .select(memberColumns)
    .from(users)
    .leftJoin(families, eq(families.id, users.familyId))
    .where(and(eq(users.familyId, familyId), eq(users.role, "child")))
    .orderBy(asc(users.displayName));
}

export type ClubMember = {
  id: number;
  username: string;
  displayName: string;
  avatar: string;
  familyName: string | null;
  role: string;
  isOnline: boolean;
};

/**
 * Everyone in the club plays, grown-ups included, so the roster is every
 * active account rather than only the children. Children sort first — the
 * clubhouse is theirs, and alphabetical order would bury them among the
 * parents.
 *
 * With a dozen accounts this is one unpaginated query on purpose.
 */
export function listClubMembers(): Promise<ClubMember[]> {
  return db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      avatar: users.avatar,
      familyName: families.name,
      role: users.role,
      isOnline: isOnlineExpr,
    })
    .from(users)
    .leftJoin(families, eq(families.id, users.familyId))
    .leftJoin(presence, eq(presence.userId, users.id))
    .where(eq(users.isActive, true))
    .orderBy(sql`${users.role} = 'child' desc`, asc(users.displayName));
}

export async function createFamily(name: string): Promise<number> {
  const rows = await db
    .insert(families)
    .values({ name: requireText(name, "Family name", { max: 80 }) })
    .returning({ id: families.id });
  return rows[0].id;
}

/**
 * Move an account into a family, or out of one with null.
 *
 * The administrator starts with no family — they are the club's secretary, not
 * necessarily anybody's parent. But they usually *are* a parent, so this is
 * what lets one account be both: run the club and manage your own children,
 * without a second login.
 */
export async function setFamily(
  userId: number,
  familyId: number | null,
  actorId: number | null,
) {
  if (familyId !== null) {
    const exists = await db
      .select({ id: families.id })
      .from(families)
      .where(eq(families.id, familyId))
      .limit(1);
    if (!exists.length) fail("That family doesn't exist.");
  }

  await db.update(users).set({ familyId }).where(eq(users.id, userId));
  await audit.record({
    actorId,
    action: "user.set_family",
    targetType: "user",
    targetId: userId,
    detail: { familyId },
  });
}

export function listFamilies(): Promise<{ id: number; name: string }[]> {
  return db
    .select({ id: families.id, name: families.name })
    .from(families)
    .orderBy(asc(families.name));
}

/**
 * Pre-flight the fields `create` would validate, without writing anything.
 * Used by invitation acceptance so a bad form doesn't consume the link.
 */
export async function assertCanCreate(input: {
  username: unknown;
  displayName: unknown;
  password: unknown;
}) {
  const username = normalizeUsername(input.username);
  requireText(input.displayName, "Display name", { max: 40 });
  validatePassword(input.password);

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);
  if (existing.length) fail(`The username "${username}" is already taken.`);
}

/**
 * Create an account. The only callers are the admin seed script, invitation
 * acceptance (parents) and a parent adding a child — there is no other path,
 * and deliberately no public one.
 */
export async function create(input: {
  username: unknown;
  displayName: unknown;
  password: unknown;
  role: Role;
  familyId: number | null;
  email?: unknown;
  avatar?: unknown;
  actorId: number | null;
}): Promise<number> {
  const username = normalizeUsername(input.username);
  const displayName = requireText(input.displayName, "Display name", { max: 40 });
  const password = validatePassword(input.password);
  const email = input.role === "child" ? null : optionalEmail(input.email);
  const avatarRaw = String(input.avatar ?? "pawn");
  const avatar = isAvatarKey(avatarRaw) ? avatarRaw : "pawn";

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);
  if (existing.length) fail(`The username "${username}" is already taken.`);

  const rows = await db
    .insert(users)
    .values({
      username,
      displayName,
      passwordHash: await hashPassword(password),
      role: input.role,
      familyId: input.familyId,
      email,
      avatar,
    })
    .returning({ id: users.id });

  const id = rows[0].id;
  await audit.record({
    actorId: input.actorId,
    action: "user.create",
    targetType: "user",
    targetId: id,
    detail: { username, role: input.role, familyId: input.familyId },
  });
  return id;
}

/** Profile fields a member may change about themselves. */
export async function updateProfile(
  userId: number,
  input: { displayName: unknown; avatar: unknown },
) {
  const displayName = requireText(input.displayName, "Display name", { max: 40 });
  const avatarRaw = String(input.avatar ?? "");
  if (!isAvatarKey(avatarRaw)) fail("Pick one of the available avatars.");

  await db
    .update(users)
    .set({ displayName, avatar: avatarRaw })
    .where(eq(users.id, userId));
}

/**
 * Set a new password. `actorId` differs from `userId` when a parent resets a
 * child's password; in that case every existing session for the child is
 * dropped.
 */
export async function setPassword(
  userId: number,
  rawPassword: unknown,
  actorId: number | null,
) {
  const password = validatePassword(rawPassword);
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(password) })
    .where(eq(users.id, userId));
  await deleteSessionsForUser(userId);
  await audit.record({
    actorId,
    action: "user.password_set",
    targetType: "user",
    targetId: userId,
  });
}

/** Change your own password, checking the current one first. */
export async function changeOwnPassword(
  userId: number,
  currentPassword: unknown,
  newPassword: unknown,
) {
  const rows = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const row = rows[0];
  if (!row || !(await verifyPassword(row.passwordHash, String(currentPassword ?? "")))) {
    fail("That's not your current password.");
  }
  await setPassword(userId, newPassword, userId);
}

/**
 * Toggles owned by an admin (`isActive`, `isMuted`) or a parent
 * (`isActive`, `chatEnabled`). Authorization is the caller's job — see
 * lib/auth/guards.ts.
 */
export async function setFlags(
  userId: number,
  flags: { isActive?: boolean; chatEnabled?: boolean; isMuted?: boolean },
  actorId: number | null,
) {
  await db.update(users).set(flags).where(eq(users.id, userId));
  if (flags.isActive === false) {
    // Disabling an account should log it out immediately, not at cookie expiry.
    await deleteSessionsForUser(userId);
  }
  await audit.record({
    actorId,
    action: "user.set_flags",
    targetType: "user",
    targetId: userId,
    detail: flags,
  });
}

/** Is there any administrator other than this one? Guards self-lockout. */
export async function hasOtherAdmin(userId: number): Promise<boolean> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "admin"), ne(users.id, userId), eq(users.isActive, true)))
    .limit(1);
  return rows.length > 0;
}
