"use client";

import { useActionState } from "react";
import { Field, FormError, SubmitButton } from "@/app/components/Form";
import { describeWindow, formatMinute } from "@/lib/play-window";
import {
  resetChildPassword,
  setChildActive,
  setChildCanCustomize,
  setChildChat,
  setChildGameChat,
  setChildPlayWindow,
} from "./actions";

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
    gameChatEnabled: boolean;
    canCustomize: boolean;
    isActive: boolean;
    isMuted: boolean;
    playFromMinute: number | null;
    playToMinute: number | null;
  };
  minPasswordLength: number;
}) {
  const [passwordState, resetAction] = useActionState(
    resetChildPassword.bind(null, child.id),
    undefined,
  );
  const [hoursState, hoursAction] = useActionState(
    setChildPlayWindow.bind(null, child.id),
    undefined,
  );

  const window = {
    fromMinute: child.playFromMinute,
    toMinute: child.playToMinute,
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <form action={setChildChat.bind(null, child.id, !child.chatEnabled)}>
          <SubmitButton
            label={child.chatEnabled ? "Turn chat off" : "Turn chat on"}
            variant="quiet"
          />
        </form>
        <form
          action={setChildGameChat.bind(null, child.id, !child.gameChatEnabled)}
        >
          <SubmitButton
            label={
              child.gameChatEnabled
                ? "Turn game chat off"
                : "Turn game chat on"
            }
            variant="quiet"
          />
        </form>
        <form
          action={setChildCanCustomize.bind(
            null,
            child.id,
            !child.canCustomize,
          )}
        >
          <SubmitButton
            label={
              child.canCustomize
                ? "Lock their name and avatar"
                : "Let them pick their name"
            }
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

      <form
        action={hoursAction}
        className="space-y-3 border-t border-rule pt-4"
      >
        <div className="flex flex-wrap items-end gap-3">
          <Field
            name="playFrom"
            label="Can play from"
            type="time"
            defaultValue={
              child.playFromMinute === null
                ? ""
                : formatMinute(child.playFromMinute)
            }
          />
          <Field
            name="playTo"
            label="until"
            type="time"
            defaultValue={
              child.playToMinute === null
                ? ""
                : formatMinute(child.playToMinute)
            }
          />
          <SubmitButton
            label="Set hours"
            pendingLabel="Setting"
            variant="quiet"
          />
        </div>
        <FormError state={hoursState} />
        <p className="text-xs text-ink-soft">
          Currently <strong>{describeWindow(window)}</strong>. Leave both blank
          for no limit. An end before the start means overnight — 20:00 to 07:00
          allows the evening and the morning. It only stops a game being{" "}
          <em>started</em>: a game already going is never interrupted.
        </p>
      </form>

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
