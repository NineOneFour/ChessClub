"use client";

import { useActionState } from "react";
import { Field, FormError, SubmitButton } from "@/app/components/Form";
import { AvatarPicker } from "./AvatarPicker";
import { BoardPicker } from "./BoardPicker";
import {
  changeMyPassword,
  updateMyBoard,
  updateMyProfile,
} from "./actions";

export function ProfileForm({
  username,
  avatar,
  canCustomize,
}: {
  username: string;
  avatar: string;
  /** A parent may take this away — see design.md §15. */
  canCustomize: boolean;
}) {
  const [state, action] = useActionState(updateMyProfile, undefined);

  if (!canCustomize) {
    return (
      <div className="sheet space-y-2 p-5">
        <p className="text-sm">
          You&apos;re <span className="font-mono">@{username}</span> in the club.
        </p>
        <p className="text-sm text-ink-soft">
          The grown-ups in your family look after your name and your avatar. The
          board and the pieces below are still yours to pick.
        </p>
      </div>
    );
  }

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

export function BoardForm({
  boardStyle,
  pieceSet,
}: {
  boardStyle: string;
  pieceSet: string;
}) {
  const [state, action] = useActionState(updateMyBoard, undefined);

  return (
    <form action={action} className="sheet space-y-4 p-5">
      <BoardPicker currentStyle={boardStyle} currentSet={pieceSet} />
      <FormError state={state} />
      <SubmitButton label="Save board" pendingLabel="Saving" variant="quiet" />
    </form>
  );
}
