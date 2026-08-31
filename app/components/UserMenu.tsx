"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { signOut } from "@/app/actions";
import { Avatar } from "./Avatar";

/**
 * Your own name in the header, and the two pages that are about you: your card
 * and your settings. They used to sit in the main navigation, where they were
 * two of six links competing with the clubhouse; behind your own name is where
 * anybody would look for them.
 *
 * Sign out is in here too, under a rule: it is the one item that isn't a page,
 * and it is last because it is the one nobody means to tap by accident.
 */
export function UserMenu({
  username,
  avatar,
  role,
}: {
  username: string;
  avatar: string;
  role: string;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  // Arriving somewhere new closes it, including when the click that navigated
  // was one of its own items. Adjusting during render rather than in an effect
  // — React's own recommendation, and the same shape as Board.tsx clearing a
  // selection when a new position arrives.
  const [renderedPath, setRenderedPath] = useState(pathname);
  if (pathname !== renderedPath) {
    setRenderedPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2"
        onClick={() => setOpen((current) => !current)}
      >
        <Avatar avatar={avatar} role={role} size="sm" />
        <span className="font-mono text-xs">{username}</span>
        <span aria-hidden className="text-[0.6rem] text-ink-soft">
          ▾
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="sheet absolute right-0 z-20 mt-2 w-40 py-1 shadow-[3px_3px_0_var(--color-rule)]"
        >
          <MenuLink href="/card">My card</MenuLink>
          <MenuLink href="/me">Settings</MenuLink>
          <form action={signOut} className="mt-1 border-t border-rule pt-1">
            <button
              role="menuitem"
              type="submit"
              className="block w-full px-3 py-1.5 text-left text-sm hover:bg-paper hover:text-stamp"
            >
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function MenuLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      role="menuitem"
      href={href}
      className="block px-3 py-1.5 text-sm hover:bg-paper"
    >
      {children}
    </Link>
  );
}
