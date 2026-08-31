"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { assertManages, requireParent } from "@/lib/auth/guards";
import * as users from "@/lib/services/users";
import { withFormErrors, type FormState } from "@/lib/action-state";
import { fail } from "@/lib/validation";
import { describeWindow, parseMinute } from "@/lib/play-window";

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

export async function setChildGameChat(childId: number, enabled: boolean) {
  const { parent, child } = await managedChild(childId);
  await users.setFlags(child.id, { gameChatEnabled: enabled }, parent.id);
  revalidatePath("/parent");
}

export async function setChildCanCustomize(childId: number, allowed: boolean) {
  const { parent, child } = await managedChild(childId);
  await users.setFlags(child.id, { canCustomize: allowed }, parent.id);
  revalidatePath("/parent");
}

/**
 * Playing hours. Blank in both fields clears them, which is how a parent stops
 * having playing hours at all — see lib/play-window.ts.
 */
export async function setChildPlayWindow(
  childId: number,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return withFormErrors(async () => {
    const { parent, child } = await managedChild(childId);

    const from = formData.get("playFrom");
    const to = formData.get("playTo");
    const fromMinute = parseMinute(from);
    const toMinute = parseMinute(to);

    // parseMinute returns null for both "cleared" and "not a time", so the
    // difference has to be spotted here rather than swallowed.
    if (String(from ?? "").trim() !== "" && fromMinute === null) {
      fail("Start of playing hours should look like 16:00.");
    }
    if (String(to ?? "").trim() !== "" && toMinute === null) {
      fail("End of playing hours should look like 20:00.");
    }

    await users.setPlayWindow(child.id, { fromMinute, toMinute }, parent.id);
    revalidatePath("/parent");

    return {
      ok:
        fromMinute === null
          ? `${child.realName} can play at any time.`
          : `${child.realName} can start games ${describeWindow({ fromMinute, toMinute })}.`,
    };
  });
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
