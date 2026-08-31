"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/guards";
import * as users from "@/lib/services/users";
import { withFormErrors, type FormState } from "@/lib/action-state";

export async function updateMyProfile(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return withFormErrors(async () => {
    const me = await requireUser();
    await users.updateProfile(me.id, {
      username: formData.get("username"),
      avatar: formData.get("avatar"),
    });
    // A rename changes how the member appears everywhere, not just here.
    revalidatePath("/me");
    revalidatePath("/card");
    revalidatePath("/games");
    revalidatePath("/");
    return { ok: "Saved." };
  });
}

export async function changeMyPassword(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return withFormErrors(async () => {
    const me = await requireUser();
    await users.changeOwnPassword(
      me.id,
      formData.get("currentPassword"),
      formData.get("newPassword"),
    );
    // Changing a password drops every session, this one included — the member
    // is sent back to the sign-in page by the next navigation.
    return { ok: "Password changed. Sign in again with the new one." };
  });
}
