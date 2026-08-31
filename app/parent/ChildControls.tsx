"use client";

import { useActionState } from "react";
import { Field, FormError, SubmitButton } from "@/app/components/Form";
import { resetChildPassword, setChildActive, setChildChat } from "./actions";

/**
 * The switches a parent has over one child. Each is its own small form so the
 * action is a plain POST — no client-side state pretending to be the truth.
 */
export function ChildControls({
  child,
  minPasswordLength,
}: {
  child: {
    id: number;
    realName: string;
    chatEnabled: boolean;
    isActive: boolean;
    isMuted: boolean;
  };
  minPasswordLength: number;
}) {
  const [passwordState, resetAction] = useActionState(
    resetChildPassword.bind(null, child.id),
    undefined,
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <form action={setChildChat.bind(null, child.id, !child.chatEnabled)}>
          <SubmitButton
            label={child.chatEnabled ? "Turn chat off" : "Turn chat on"}
            variant="quiet"
          />
        </form>
        <form action={setChildActive.bind(null, child.id, !child.isActive)}>
          <SubmitButton
            label={child.isActive ? "Suspend account" : "Let them back in"}
            variant={child.isActive ? "warn" : "quiet"}
          />
        </form>
      </div>

      {child.isMuted && (
        <p className="border-l-2 border-stamp pl-3 text-sm text-stamp">
          The club administrator has muted {child.realName} in chat. Only
          they can lift that.
        </p>
      )}

      <form action={resetAction} className="space-y-3 border-t border-rule pt-4">
        <Field
          name="password"
          label="Set a new password"
          type="password"
          hint={`At least ${minPasswordLength} characters. Signs them out everywhere.`}
          required
          autoComplete="new-password"
        />
        <FormError state={passwordState} />
        <SubmitButton
          label="Set password"
          pendingLabel="Setting"
          variant="quiet"
        />
      </form>
    </div>
  );
}
