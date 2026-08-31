"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSession } from "@/lib/auth/session";
import { pruneExpiredSessions } from "@/lib/auth/session-store";
import * as users from "@/lib/services/users";
import { withFormErrors, type FormState } from "@/lib/action-state";

export async function signIn(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const state = await withFormErrors(async () => {
    const userId = await users.authenticate(
      formData.get("username"),
      formData.get("password"),
    );
    if (userId === null) {
      // One message for every failure mode. A wrong username and a disabled
      // account must not be distinguishable.
      return { error: "That username and password don't match." };
    }

    const userAgent = (await headers()).get("user-agent");
    await createSession(userId, userAgent);
    await pruneExpiredSessions();
    return undefined;
  });

  if (state?.error) return state;
  redirect("/");
}
