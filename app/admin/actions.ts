"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/guards";
import * as chat from "@/lib/services/chat";
import * as invitations from "@/lib/services/invitations";
import * as users from "@/lib/services/users";
import { withFormErrors, type FormState } from "@/lib/action-state";
import { fail } from "@/lib/validation";

/**
 * Administrator actions. The administrator can act on anyone, so the only
 * guard needed is the role check — plus one rule protecting them from locking
 * themselves out.
 */

export async function createInvitation(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return withFormErrors(async () => {
    const admin = await requireAdmin();

    const rawFamilyId = String(formData.get("familyId") ?? "");
    const familyId = rawFamilyId === "" ? null : Number(rawFamilyId);
    if (familyId !== null && !Number.isInteger(familyId)) {
      fail("Pick a family, or leave it as a new one.");
    }

    const invite = await invitations.create({
      familyName: formData.get("familyName"),
      familyId,
      note: formData.get("note"),
      actorId: admin.id,
    });

    revalidatePath("/admin");
    // The raw link exists only here — surface it so it can be copied now.
    return { ok: invite.url };
  });
}

/**
 * Put the administrator into a family — an existing one, a new one they name,
 * or none at all. This is the only way an account acquires a family without
 * going through an invitation, and it exists because the person running the
 * club is usually also a parent in it.
 */
export async function setMyFamily(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return withFormErrors(async () => {
    const admin = await requireAdmin();

    const choice = String(formData.get("familyId") ?? "");
    let familyId: number | null;

    if (choice === "new") {
      familyId = await users.createFamily(String(formData.get("familyName") ?? ""));
    } else if (choice === "") {
      familyId = null;
    } else {
      familyId = Number(choice);
      if (!Number.isInteger(familyId)) fail("Pick a family from the list.");
    }

    await users.setFamily(admin.id, familyId, admin.id);
    revalidatePath("/admin");
    revalidatePath("/parent");
    revalidatePath("/");
    return {
      ok:
        familyId === null
          ? "You're no longer in a family."
          : "Family set. Your children are under My family.",
    };
  });
}

export async function revokeInvitation(invitationId: number): Promise<FormState> {
  return withFormErrors(async () => {
    const admin = await requireAdmin();
    await invitations.revoke(invitationId, admin.id);
    revalidatePath("/admin");
    return undefined;
  });
}

export async function setUserActive(
  userId: number,
  active: boolean,
): Promise<FormState> {
  return withFormErrors(async () => {
    const admin = await requireAdmin();
    const target = await users.getById(userId);
    if (!target) notFound();

    if (
      !active &&
      target.role === "admin" &&
      !(await users.hasOtherAdmin(userId))
    ) {
      // Refusing here is cheaper than a database recovery session later.
      fail("You'd lock yourself out — make another administrator first.");
    }

    await users.setFlags(userId, { isActive: active }, admin.id);
    revalidatePath("/admin");
    return undefined;
  });
}

export async function setUserMuted(
  userId: number,
  muted: boolean,
): Promise<FormState> {
  return withFormErrors(async () => {
    const admin = await requireAdmin();
    const target = await users.getById(userId);
    if (!target) notFound();
    await users.setFlags(userId, { isMuted: muted }, admin.id);
    revalidatePath("/admin");
    return undefined;
  });
}

export async function deleteMessage(messageId: number): Promise<FormState> {
  return withFormErrors(async () => {
    const admin = await requireAdmin();
    await chat.softDelete(messageId, admin.id);
    revalidatePath("/admin");
    revalidatePath("/");
    return undefined;
  });
}
