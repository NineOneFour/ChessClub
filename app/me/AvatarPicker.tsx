"use client";

import { useState } from "react";
import { AVATARS } from "@/lib/avatars";

/**
 * Twelve presets, no uploads. A radio group so it works with the keyboard and
 * submits with the surrounding form.
 */
export function AvatarPicker({ current }: { current: string }) {
  const [selected, setSelected] = useState(current);

  return (
    <fieldset>
      <legend className="eyebrow">Avatar</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {AVATARS.map((avatar) => (
          <label
            key={avatar.key}
            className={`grid h-11 w-11 cursor-pointer place-items-center rounded-sm border text-2xl leading-none ${
              selected === avatar.key
                ? "border-ink bg-white shadow-[inset_0_0_0_2px_var(--color-ink)]"
                : "border-rule bg-white"
            }`}
            title={avatar.label}
          >
            <input
              type="radio"
              name="avatar"
              value={avatar.key}
              checked={selected === avatar.key}
              onChange={() => setSelected(avatar.key)}
              className="sr-only"
            />
            <span aria-hidden>{avatar.glyph}</span>
            <span className="sr-only">{avatar.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
