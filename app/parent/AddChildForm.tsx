"use client";

import { useActionState } from "react";
import { Field, FormError, SubmitButton } from "@/app/components/Form";
import { addChild } from "./actions";

export function AddChildForm({ minPasswordLength }: { minPasswordLength: number }) {
  const [state, action] = useActionState(addChild, undefined);

  return (
    <form action={action} className="sheet space-y-4 p-5">
      <Field
        name="displayName"
        label="Their name"
        hint="What the other kids see in the clubhouse."
        required
        maxLength={40}
      />
      <Field
        name="username"
        label="Username"
        hint="Lower case, no spaces. This is what they sign in with."
        required
        mono
        maxLength={24}
      />
      <Field
        name="password"
        label="Password"
        type="password"
        hint={`At least ${minPasswordLength} characters. Pick something they can type.`}
        required
        autoComplete="new-password"
      />
      <FormError state={state} />
      <SubmitButton label="Add child" pendingLabel="Adding" />
    </form>
  );
}
