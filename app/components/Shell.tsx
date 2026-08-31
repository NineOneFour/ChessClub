import Link from "next/link";
import type { SessionUser } from "@/lib/auth/session";
import { Avatar } from "./Avatar";
import { signOut } from "@/app/actions";

/**
 * The page frame: masthead, one rubber stamp, and the navigation a member is
 * actually allowed to use. Children never see parent or admin links.
 */
export function Shell({
  user,
  stamp,
  children,
}: {
  user: SessionUser;
  stamp: string;
  children: React.ReactNode;
}) {
  const links = [
    { href: "/", label: "Clubhouse" },
    { href: "/games", label: "Games" },
    { href: "/me", label: "My card" },
    ...(user.role === "parent" || user.role === "admin"
      ? [{ href: "/parent", label: "My family" }]
      : []),
    ...(user.role === "admin" ? [{ href: "/admin", label: "The club" }] : []),
  ];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 pb-16 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-ink pb-4 pt-8">
        <div className="flex items-end gap-4">
          <Link href="/" className="masthead text-3xl sm:text-4xl">
            The Chess Club
          </Link>
          <span className="stamp mb-1 hidden sm:inline-block">{stamp}</span>
        </div>

        <nav className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="eyebrow hover:text-ink"
            >
              {link.label}
            </Link>
          ))}
          <form action={signOut}>
            <button type="submit" className="eyebrow hover:text-stamp">
              Sign out
            </button>
          </form>
          <Link href="/me" className="flex items-center gap-2">
            <Avatar avatar={user.avatar} role={user.role} size="sm" />
            <span className="font-mono text-xs">{user.displayName}</span>
          </Link>
        </nav>
      </header>

      <main className="flex-1 pt-8">{children}</main>
    </div>
  );
}
