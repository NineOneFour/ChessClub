"use client";

import { useActionState, useState } from "react";
import { Field, FormError, SubmitButton } from "@/app/components/Form";
import {
  createInvitation,
  deleteMessage,
  revokeInvitation,
  setMyFamily,
  setUserActive,
  setUserMuted,
} from "./actions";

/**
 * Which family the administrator belongs to. Running the club and being a
 * parent in it are different things, so this is a choice rather than an
 * assumption — but it's the same choice most of the time.
 */
export function MyFamilyForm({
  families,
  currentFamilyId,
}: {
  families: { id: number; name: string }[];
  currentFamilyId: number | null;
}) {
  const [state, action] = useActionState(setMyFamily, undefined);
  const [choice, setChoice] = useState(
    currentFamilyId === null ? "" : String(currentFamilyId),
  );

  return (
    <form action={action} className="sheet space-y-4 p-5">
      <div>
        <label htmlFor="myFamilyId" className="eyebrow">
          I belong to
        </label>
        <select
          id="myFamilyId"
          name="familyId"
          value={choice}
          onChange={(event) => setChoice(event.target.value)}
          className="field mt-1"
        >
          <option value="">No family — I just run the club</option>
          {families.map((family) => (
            <option key={family.id} value={family.id}>
              {family.name}
            </option>
          ))}
          <option value="new">A new family I&apos;ll name…</option>
        </select>
        <p className="mt-1 text-xs text-ink-soft">
          Join a family to manage your own children under My family and play as
          one of its members.
        </p>
      </div>

      {choice === "new" && (
        <Field
          name="familyName"
          label="Family name"
          hint="How your family appears in the club."
          required
          maxLength={80}
        />
      )}

      <FormError state={state} />
      <SubmitButton label="Save" pendingLabel="Saving" variant="quiet" />
    </form>
  );
}

/**
 * The invitation form. The raw link exists exactly once, in the reply to this
 * submission — there is nowhere to go back and look it up, which is the point
 * of storing only the hash. So the reply is a copy field, not a toast.
 */
export function InviteForm({
  families,
}: {
  families: { id: number; name: string }[];
}) {
  const [state, action] = useActionState(createInvitation, undefined);
  const [existing, setExisting] = useState("");

  const link = state?.ok;

  return (
    <div className="space-y-4">
      <form action={action} className="sheet space-y-4 p-5">
        <div>
          <label htmlFor="familyId" className="eyebrow">
            Family
          </label>
          <select
            id="familyId"
            name="familyId"
            value={existing}
            onChange={(event) => setExisting(event.target.value)}
            className="field mt-1"
          >
            <option value="">A new family</option>
            {families.map((family) => (
              <option key={family.id} value={family.id}>
                {family.name} (second parent)
              </option>
            ))}
          </select>
        </div>

        {existing === "" && (
          <Field
            name="familyName"
            label="Family name"
            hint="How the family appears in the club, e.g. “The Okonkwos”."
            required
            maxLength={80}
          />
        )}

        <Field
          name="note"
          label="Note (optional)"
          hint="For you, not for them. Who this went to."
          maxLength={300}
        />

        {state?.error && <FormError state={state} />}
        <SubmitButton label="Create link" pendingLabel="Creating" />
      </form>

      {link && (
        <div className="sheet space-y-2 border-live p-5">
          <p className="eyebrow text-live">Copy this now</p>
          <p className="text-sm text-ink-soft">
            Single use, expires in two weeks, and it isn&apos;t recoverable
            after you leave this page. Send it however you normally message
            them.
          </p>
          <input
            readOnly
            value={link}
            onFocus={(event) => event.currentTarget.select()}
            className="field font-mono text-xs"
          />
        </div>
      )}
    </div>
  );
}

export function RevokeInviteButton({ invitationId }: { invitationId: number }) {
  const [state, action] = useActionState(
    revokeInvitation.bind(null, invitationId),
    undefined,
  );
  return (
    <form action={action}>
      <SubmitButton label="Revoke" variant="quiet" />
      <FormError state={state} />
    </form>
  );
}

export function UserControls({
  user,
}: {
  user: { id: number; isActive: boolean; isMuted: boolean; role: string };
}) {
  const [activeState, activeAction] = useActionState(
    setUserActive.bind(null, user.id, !user.isActive),
    undefined,
  );
  const [muteState, muteAction] = useActionState(
    setUserMuted.bind(null, user.id, !user.isMuted),
    undefined,
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <form action={activeAction}>
          <SubmitButton
            label={user.isActive ? "Disable" : "Enable"}
            variant="quiet"
          />
        </form>
        {user.role === "child" && (
          <form action={muteAction}>
            <SubmitButton
              label={user.isMuted ? "Unmute" : "Mute"}
              variant="quiet"
            />
          </form>
        )}
      </div>
      <FormError state={activeState} />
      <FormError state={muteState} />
    </div>
  );
}

export function DeleteMessageButton({ messageId }: { messageId: number }) {
  const [state, action] = useActionState(
    deleteMessage.bind(null, messageId),
    undefined,
  );
  return (
    <form action={action}>
      <SubmitButton label="Remove" variant="quiet" />
      <FormError state={state} />
    </form>
  );
}
