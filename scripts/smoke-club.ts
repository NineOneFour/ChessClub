import "dotenv/config";
import { eq, inArray } from "drizzle-orm";
import { client, db } from "../lib/db";
import { chatMessages, families, invitations, users } from "../lib/db/schema";
import { CLUB_CHANNEL } from "../lib/db/schema";
import * as chatService from "../lib/services/chat";
import * as invitationsService from "../lib/services/invitations";
import * as presenceService from "../lib/services/presence";
import * as usersService from "../lib/services/users";
import { deleteSessionsForUser } from "../lib/auth/session-store";
import { isGrownUp } from "../lib/roles";
import { ValidationError } from "../lib/validation";

/**
 * End-to-end check of the phase 1 service layer, against the real database.
 *
 * Creates a throwaway administrator, invites a family, accepts the invitation,
 * adds two children, exercises the chat and parental controls, then deletes
 * everything it made. Run it after a migration to confirm the whole path still
 * works without clicking through the UI.
 */

const SUFFIX = process.env.SMOKE_SUFFIX ?? "smoke";
const created: {
  userIds: number[];
  familyIds: number[];
  invitationIds: number[];
} = { userIds: [], familyIds: [], invitationIds: [] };

function check(label: string, condition: boolean) {
  if (!condition) throw new Error(`FAILED: ${label}`);
  console.log(`  ok  ${label}`);
}

async function expectRejection(label: string, body: () => Promise<unknown>) {
  try {
    await body();
  } catch (err) {
    if (err instanceof ValidationError) {
      console.log(`  ok  ${label} (${err.message})`);
      return;
    }
    throw err;
  }
  throw new Error(`FAILED: ${label} — expected a rejection`);
}

async function main() {
  console.log("Accounts and invitations");

  const adminId = await usersService.create({
    username: `admin-${SUFFIX}`,
    displayName: "Smoke Admin",
    password: "smoke-password",
    role: "admin",
    familyId: null,
    actorId: null,
  });
  created.userIds.push(adminId);
  check("administrator created", Number.isInteger(adminId));

  await expectRejection("duplicate username refused", () =>
    usersService.create({
      username: `admin-${SUFFIX}`,
      displayName: "Impostor",
      password: "smoke-password",
      role: "admin",
      familyId: null,
      actorId: null,
    }),
  );

  await expectRejection("short password refused", () =>
    usersService.create({
      username: `short-${SUFFIX}`,
      displayName: "Too Short",
      password: "abc",
      role: "parent",
      familyId: null,
      actorId: null,
    }),
  );

  check(
    "login works",
    (await usersService.authenticate(`ADMIN-${SUFFIX}`, "smoke-password")) ===
      adminId,
  );
  check(
    "wrong password rejected",
    (await usersService.authenticate(`admin-${SUFFIX}`, "nope")) === null,
  );

  const invite = await invitationsService.create({
    familyName: `Smoke Family ${SUFFIX}`,
    note: "created by smoke:club",
    actorId: adminId,
  });
  created.invitationIds.push(invite.id);
  const token = invite.url.split("/join/")[1];
  check("invitation link minted", token.length > 20);
  check(
    "invitation is usable",
    (await invitationsService.findUsable(token)) !== null,
  );

  // A bad form must not burn the link.
  await expectRejection("bad signup rejected without consuming the link", () =>
    invitationsService.accept({
      token,
      username: `admin-${SUFFIX}`,
      displayName: "Clashing Parent",
      password: "smoke-password",
    }),
  );
  check(
    "invitation still usable after the failed attempt",
    (await invitationsService.findUsable(token)) !== null,
  );

  const parentId = await invitationsService.accept({
    token,
    username: `parent-${SUFFIX}`,
    displayName: "Smoke Parent",
    password: "smoke-password",
    email: "parent@example.test",
  });
  created.userIds.push(parentId);
  const parent = await usersService.getById(parentId);
  check("parent account created", parent?.role === "parent");
  check("family attached", parent?.familyId !== null);
  if (parent?.familyId) created.familyIds.push(parent.familyId);

  check(
    "invitation is single use",
    (await invitationsService.findUsable(token)) === null,
  );
  await expectRejection("re-accepting refused", () =>
    invitationsService.accept({
      token,
      username: `other-${SUFFIX}`,
      displayName: "Second Comer",
      password: "smoke-password",
    }),
  );

  console.log("Children");

  const familyId = parent!.familyId!;
  const kidIds: number[] = [];
  for (const name of ["Ellie", "Max"]) {
    const id = await usersService.create({
      username: `${name.toLowerCase()}-${SUFFIX}`,
      displayName: name,
      password: "smoke-password",
      role: "child",
      familyId,
      email: "should-be-ignored@example.test",
      actorId: parentId,
    });
    kidIds.push(id);
    created.userIds.push(id);
  }
  check("two children created", kidIds.length === 2);
  check(
    "children collect no email address",
    (await usersService.getById(kidIds[0]))?.email === null,
  );
  check(
    "family roster lists both",
    (await usersService.listChildrenOfFamily(familyId)).length === 2,
  );

  console.log("The roster");

  const clubRoster = await usersService.listClubMembers();
  check(
    "children are on the roster",
    kidIds.every((id) => clubRoster.some((m) => m.id === id)),
  );
  check(
    "the parent is on the roster too — grown-ups play",
    clubRoster.some((m) => m.id === parentId && m.role === "parent"),
  );
  check(
    "the administrator is on the roster",
    clubRoster.some((m) => m.id === adminId && m.role === "admin"),
  );
  check(
    "children sort ahead of grown-ups",
    clubRoster.findIndex((m) => m.role === "child") <
      clubRoster.findIndex((m) => m.role !== "child"),
  );
  check(
    "a suspended member drops off the roster",
    await (async () => {
      await usersService.setFlags(kidIds[1], { isActive: false }, parentId);
      const after = await usersService.listClubMembers();
      await usersService.setFlags(kidIds[1], { isActive: true }, parentId);
      return !after.some((m) => m.id === kidIds[1]);
    })(),
  );

  console.log("Presence");

  await presenceService.setConnections(kidIds[0], 1);
  let roster = await usersService.listClubMembers();
  check(
    "connected child shows as online",
    roster.find((m) => m.id === kidIds[0])?.isOnline === true,
  );
  check(
    "unconnected child shows as away",
    roster.find((m) => m.id === kidIds[1])?.isOnline === false,
  );

  await presenceService.heartbeat(kidIds);
  await presenceService.setConnections(kidIds[0], 0);
  roster = await usersService.listClubMembers();
  check(
    "disconnected child shows as away",
    roster.find((m) => m.id === kidIds[0])?.isOnline === false,
  );

  // A presence row left behind by a crashed realtime service must not read as
  // online forever.
  await db.execute(
    `update presence set connections = 1, updated_at = now() - interval '10 minutes' where user_id = ${kidIds[0]}`,
  );
  roster = await usersService.listClubMembers();
  check(
    "stale presence row is ignored",
    roster.find((m) => m.id === kidIds[0])?.isOnline === false,
  );
  await presenceService.resetAll();

  console.log("Chat");

  const message = await chatService.post({
    channel: CLUB_CHANNEL,
    userId: kidIds[0],
    body: "  anyone   up for a game?  ",
  });
  check("message posted", message.body === "anyone   up for a game?");
  check(
    "author details resolved",
    message.displayName === "Ellie" && message.userId === kidIds[0],
  );
  check("a child's message carries the child role", message.role === "child");

  const parentMessage = await chatService.post({
    channel: CLUB_CHANNEL,
    userId: parentId,
    body: "ten more minutes then bed",
  });
  check(
    "a parent's message is tagged as a grown-up",
    isGrownUp(parentMessage.role),
  );
  check("a child's message is not", !isGrownUp(message.role));

  await expectRejection("empty message refused", () =>
    chatService.post({ channel: CLUB_CHANNEL, userId: kidIds[0], body: "   " }),
  );
  await expectRejection("over-long message refused", () =>
    chatService.post({
      channel: CLUB_CHANNEL,
      userId: kidIds[0],
      body: "x".repeat(501),
    }),
  );

  check(
    "message visible in the clubhouse",
    (await chatService.listVisible(CLUB_CHANNEL)).some(
      (m) => m.id === message.id,
    ),
  );

  console.log("Parental controls and moderation");

  await usersService.setFlags(kidIds[0], { chatEnabled: false }, parentId);
  const muted = await usersService.getById(kidIds[0]);
  check("parent switched chat off", muted?.chatEnabled === false);
  check(
    "canSpeak refuses with the parent's reason",
    chatService.canSpeak({ chatEnabled: false, isMuted: false }).ok === false,
  );
  await usersService.setFlags(kidIds[0], { chatEnabled: true }, parentId);

  await usersService.setFlags(kidIds[1], { isMuted: true }, adminId);
  check(
    "admin mute blocks speaking",
    chatService.canSpeak({ chatEnabled: true, isMuted: true }).ok === false,
  );
  await usersService.setFlags(kidIds[1], { isMuted: false }, adminId);

  await chatService.softDelete(message.id, adminId);
  check(
    "deleted message hidden from the clubhouse",
    !(await chatService.listVisible(CLUB_CHANNEL)).some(
      (m) => m.id === message.id,
    ),
  );
  check(
    "deleted message still visible in review",
    (await chatService.listForReview({ channel: CLUB_CHANNEL })).some(
      (m) => m.id === message.id && m.deletedAt !== null,
    ),
  );
  await expectRejection("double delete refused", () =>
    chatService.softDelete(message.id, adminId),
  );

  console.log("The administrator's own family");

  check(
    "the administrator starts with no family",
    (await usersService.getById(adminId))?.familyId === null,
  );

  await usersService.setFamily(adminId, familyId, adminId);
  const adminInFamily = await usersService.getById(adminId);
  check("the administrator can join a family", adminInFamily?.familyId === familyId);
  check(
    "their card shows the family name",
    adminInFamily?.familyName === `Smoke Family ${SUFFIX}`,
  );
  check(
    "the family's children are now theirs to manage",
    (await usersService.listChildrenOfFamily(adminInFamily!.familyId!)).length === 2,
  );
  check(
    "the roster shows the administrator with their family",
    (await usersService.listClubMembers()).find((m) => m.id === adminId)
      ?.familyName === `Smoke Family ${SUFFIX}`,
  );

  await expectRejection("a family that doesn't exist is refused", () =>
    usersService.setFamily(adminId, 999_999, adminId),
  );

  await usersService.setFamily(adminId, null, adminId);
  check(
    "the administrator can leave a family again",
    (await usersService.getById(adminId))?.familyId === null,
  );

  console.log("Sessions");

  await usersService.setFlags(kidIds[0], { isActive: false }, parentId);
  check(
    "disabled child cannot log in",
    (await usersService.authenticate(
      `ellie-${SUFFIX}`,
      "smoke-password",
    )) === null,
  );
  await usersService.setFlags(kidIds[0], { isActive: true }, parentId);
  check(
    "re-enabled child can log in again",
    (await usersService.authenticate(`ellie-${SUFFIX}`, "smoke-password")) ===
      kidIds[0],
  );

  await usersService.setPassword(kidIds[0], "new-smoke-password", parentId);
  check(
    "old password no longer works",
    (await usersService.authenticate(`ellie-${SUFFIX}`, "smoke-password")) ===
      null,
  );
  check(
    "new password works",
    (await usersService.authenticate(
      `ellie-${SUFFIX}`,
      "new-smoke-password",
    )) === kidIds[0],
  );

  const secondAdminId = await usersService.create({
    username: `admin2-${SUFFIX}`,
    displayName: "Second Admin",
    password: "smoke-password",
    role: "admin",
    familyId: null,
    actorId: adminId,
  });
  created.userIds.push(secondAdminId);
  check(
    "self-lockout guard sees a second administrator",
    (await usersService.hasOtherAdmin(adminId)) === true,
  );
  await usersService.setFlags(secondAdminId, { isActive: false }, adminId);
  // The negative direction is only observable when the club has no other
  // active administrator — on a database that already has a real one, there
  // is nothing to see, so say so rather than asserting something untrue.
  const others = (await usersService.listAll()).filter(
    (member) =>
      member.role === "admin" &&
      member.isActive &&
      member.id !== adminId &&
      member.id !== secondAdminId,
  );
  if (others.length === 0) {
    check(
      "a disabled administrator doesn't count as cover",
      (await usersService.hasOtherAdmin(adminId)) === false,
    );
  } else {
    console.log(
      `  --  skipped the no-cover check: ${others.length} real administrator(s) in this database`,
    );
  }
}

async function cleanup() {
  for (const userId of created.userIds) await deleteSessionsForUser(userId);
  if (created.invitationIds.length) {
    await db
      .delete(invitations)
      .where(inArray(invitations.id, created.invitationIds));
  }
  if (created.userIds.length) {
    await db
      .delete(chatMessages)
      .where(inArray(chatMessages.userId, created.userIds));
    // audit_log.actor_id is ON DELETE SET NULL, so the trail survives the
    // accounts going away — which is the point of an audit trail.
    await db.delete(users).where(inArray(users.id, created.userIds));
  }
  for (const familyId of created.familyIds) {
    await db.delete(families).where(eq(families.id, familyId));
  }
  console.log("cleaned up");
}

main()
  .then(() => console.log("\nAll checks passed."))
  .catch((err) => {
    console.error(`\n${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch((err) => console.error("cleanup failed", err));
    await client.end();
  });
