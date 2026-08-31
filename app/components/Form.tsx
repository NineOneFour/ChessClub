"use client";

import { useFormStatus } from "react-dom";
import type { FormState } from "@/lib/action-state";

/**
 * Shared form furniture. Errors say what went wrong and what to do about it;
 * they don't apologise and they don't say "something went wrong".
 */
export function FormError({ state }: { state: FormState }) {
  if (!state?.error && !state?.ok) return null;
  return (
    <p
      role="status"
      className={`border-l-2 py-1 pl-3 text-sm ${
        state.error
          ? "border-stamp text-stamp"
          : "border-live text-live"
      }`}
    >
      {state.error ?? state.ok}
    </p>
  );
}

export function SubmitButton({
  label,
  pendingLabel,
  variant = "solid",
}: {
  label: string;
  pendingLabel?: string;
  variant?: "solid" | "quiet" | "warn";
}) {
  const { pending } = useFormStatus();
  const className = {
    solid: "btn",
    quiet: "btn btn-quiet",
    warn: "btn btn-warn",
  }[variant];

  return (
    <button type="submit" disabled={pending} className={className}>
      {pending ? (pendingLabel ?? label) : label}
    </button>
  );
}

export function Field({
  name,
  label,
  hint,
  type = "text",
  defaultValue,
  required,
  autoComplete,
  mono,
  maxLength,
}: {
  name: string;
  label: string;
  hint?: string;
  type?: string;
  defaultValue?: string;
  required?: boolean;
  autoComplete?: string;
  mono?: boolean;
  maxLength?: number;
}) {
  return (
    <div>
      <label htmlFor={name} className="eyebrow">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        defaultValue={defaultValue}
        required={required}
        autoComplete={autoComplete}
        autoCapitalize={mono ? "none" : undefined}
        spellCheck={mono ? false : undefined}
        maxLength={maxLength}
        className={`field mt-1 ${mono ? "font-mono" : ""}`}
      />
      {hint && <p className="mt-1 text-xs text-ink-soft">{hint}</p>}
    </div>
  );
}
