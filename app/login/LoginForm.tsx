"use client";

import { useActionState } from "react";
import { signIn } from "./actions";
import { FormError, SubmitButton } from "@/app/components/Form";

export function LoginForm() {
  const [state, action] = useActionState(signIn, undefined);

  return (
    <form action={action} className="sheet space-y-4 p-5">
      <div>
        <label htmlFor="username" className="eyebrow">
          Username
        </label>
        <input
          id="username"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          className="field mt-1 font-mono"
        />
      </div>

      <div>
        <label htmlFor="password" className="eyebrow">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="field mt-1"
        />
      </div>

      <FormError state={state} />
      <SubmitButton label="Sign in" pendingLabel="Signing in" />
    </form>
  );
}
