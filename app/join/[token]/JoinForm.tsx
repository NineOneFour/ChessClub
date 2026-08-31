"use client";

import { useActionState } from "react";
import { acceptInvitation } from "./actions";
import { Field, FormError, SubmitButton } from "@/app/components/Form";

export function JoinForm({
  token,
  minPasswordLength,
}: {
  token: string;
  minPasswordLength: number;
}) {
  const [state, action] = useActionState(
    acceptInvitation.bind(null, token),
    undefined,
  );

  return (
    <form action={action} className="sheet mt-6 space-y-4 p-5">
      <Field
        name="displayName"
        label="Your name"
        hint="What the other families see."
        required
        maxLength={40}
        autoComplete="name"
      />
      <Field
        name="username"
        label="Username"
        hint="Lower case, no spaces. This is what you sign in with."
        required
        mono
        maxLength={24}
        autoComplete="username"
      />
      <Field
        name="password"
        label="Password"
        type="password"
        hint={`At least ${minPasswordLength} characters.`}
        required
        autoComplete="new-password"
      />
      <Field
        name="email"
        label="Email (optional)"
        type="email"
        hint="Only used if you need your password reset. We don't collect one for children."
        autoComplete="email"
      />

      <FormError state={state} />
      <SubmitButton label="Create account" pendingLabel="Creating" />
    </form>
  );
}
