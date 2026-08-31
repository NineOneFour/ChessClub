import { avatarGlyph } from "@/lib/avatars";
import { isGrownUp } from "@/lib/roles";

const SIZES = {
  sm: "h-8 w-8 text-lg",
  md: "h-11 w-11 text-2xl",
  lg: "h-20 w-20 text-5xl",
} as const;

/**
 * A member's piece. Grown-ups get a double ink border — the same device a
 * score sheet uses to mark the officials' column, and readable at 32px in a
 * way a colour change wouldn't be.
 */
export function Avatar({
  avatar,
  role,
  size = "md",
  online,
}: {
  avatar: string;
  role?: string;
  size?: keyof typeof SIZES;
  online?: boolean;
}) {
  const grownUp = role !== undefined && isGrownUp(role);

  return (
    <span className="relative inline-flex shrink-0">
      <span
        aria-hidden
        className={`${SIZES[size]} grid place-items-center rounded-sm bg-white leading-none ${
          grownUp
            ? "border-2 border-ink shadow-[inset_0_0_0_2px_var(--color-sheet)]"
            : "border border-rule"
        }`}
      >
        {avatarGlyph(avatar)}
      </span>
      {online !== undefined && (
        <span
          className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-sheet ${
            online ? "bg-live" : "bg-rule"
          }`}
          title={online ? "In the room" : "Not here right now"}
        />
      )}
    </span>
  );
}

/** The word next to a grown-up's name. Renders nothing for a child. */
export function GrownUpTag({ role }: { role: string }) {
  if (!isGrownUp(role)) return null;
  return (
    <span className="rounded-sm border border-ink px-1 pb-px font-mono text-[0.55rem] uppercase tracking-[0.12em] text-ink">
      parent
    </span>
  );
}
