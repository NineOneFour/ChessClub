"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { assertManages, requireParent } from "@/lib/auth/guards";
import * as users from "@/lib/services/users";
import { withFormErrors, type FormState } from "@/lib/action-state";
import { fail } from "@/lib/validation";

/**
 * Parent-side account management. Every action re-checks that the caller is a
 * parent and that the child in question is in their own family — these are
 * plain POST endpoints, so the check can't live in the UI.
 */

/** Resolve a child the calling parent is actually allowed to manage. */
async function managedChild(rawChildId: unknown) {
  const parent = await requireParent();
  const childId = Number(rawChildId);
  if (!Number.isInteger(childId)) notFound();

  const child = await users.getById(childId);
  if (!child) notFound();
  assertManages(parent, child);
  return { parent, child };
}

export async function addChild(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return withFormErrors(async () => {
    const parent = await requireParent();
    if (parent.familyId === null) {
      fail("Only a parent account can add children.");
    }

    await users.create({
      username: formData.get("username"),
      realName: formData.get("realName"),
      password: formData.get("password"),
      role: "child",
      familyId: parent.familyId,
      actorId: parent.id,
    });

    revalidatePath("/parent");
    return { ok: "Child added. They can sign in now." };
  });
}

export async function setChildChat(childId: number, enabled: boolean) {
  const { parent, child } = await managedChild(childId);
  await users.setFlags(child.id, { chatEnabled: enabled }, parent.id);
  revalidatePath("/parent");
}

export async function setChildActive(childId: number, active: boolean) {
  const { parent, child } = await managedChild(childId);
  await users.setFlags(child.id, { isActive: active }, parent.id);
  revalidatePath("/parent");
}

export async function resetChildPassword(
  childId: number,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return withFormErrors(async () => {
    const { parent, child } = await managedChild(childId);
    await users.setPassword(child.id, formData.get("password"), parent.id);
    return {
      ok: `${child.realName} will need to sign in again with the new password.`,
    };
  });
}
