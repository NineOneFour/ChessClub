"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSession } from "@/lib/auth/session";
import * as invitations from "@/lib/services/invitations";
import { withFormErrors, type FormState } from "@/lib/action-state";

export async function acceptInvitation(
  token: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const state = await withFormErrors(async () => {
    const userId = await invitations.accept({
      token,
      username: formData.get("username"),
      realName: formData.get("realName"),
      password: formData.get("password"),
      email: formData.get("email"),
    });

    const userAgent = (await headers()).get("user-agent");
    await createSession(userId, userAgent);
    return undefined;
  });

  if (state?.error) return state;
  redirect("/parent");
}
