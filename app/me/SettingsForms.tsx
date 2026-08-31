"use client";

import { useActionState } from "react";
import { Field, FormError, SubmitButton } from "@/app/components/Form";
import { AvatarPicker } from "./AvatarPicker";
import { changeMyPassword, updateMyProfile } from "./actions";

export function ProfileForm({
  username,
  avatar,
}: {
  username: string;
  avatar: string;
}) {
  const [state, action] = useActionState(updateMyProfile, undefined);

  return (
    <form action={action} className="sheet space-y-4 p-5">
      <Field
        name="username"
        label="Your name in the club"
        hint="Letters, numbers, dashes and underscores. Everybody sees this one, so changing it changes what they see."
        defaultValue={username}
        required
        maxLength={24}
      />
      <AvatarPicker current={avatar} />
      <FormError state={state} />
      <SubmitButton label="Save" pendingLabel="Saving" />
    </form>
  );
}

export function PasswordForm({ minLength }: { minLength: number }) {
  const [state, action] = useActionState(changeMyPassword, undefined);

  return (
    <form action={action} className="sheet space-y-4 p-5">
      <Field
        name="currentPassword"
        label="Current password"
        type="password"
        required
        autoComplete="current-password"
      />
      <Field
        name="newPassword"
        label="New password"
        type="password"
        hint={`At least ${minLength} characters.`}
        required
        autoComplete="new-password"
      />
      <FormError state={state} />
      <SubmitButton
        label="Change password"
        pendingLabel="Changing"
        variant="quiet"
      />
    </form>
  );
}
