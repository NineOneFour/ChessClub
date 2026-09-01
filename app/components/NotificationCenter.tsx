"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Avatar } from "./Avatar";
import { useNotificationSocket } from "./useNotificationSocket";

/**
 * Routes with nobody signed in yet — a socket here would just be refused and
 * retried forever, so it never opens one.
 */
function isPublicPath(pathname: string): boolean {
  return pathname === "/login" || pathname.startsWith("/join/");
}

/**
 * Mounted once in the root layout, above every page: a challenge reaches you
 * no matter what you're looking at, not only while the clubhouse's own
 * challenge list happens to be on screen. See useNotificationSocket for why
 * this is its own connection.
 */
export function NotificationCenter() {
  const pathname = usePathname();
  const router = useRouter();

  const {
    toasts,
    acceptChallenge,
    declineChallenge,
    dismiss,
    gameStarted,
    clearGameStarted,
  } = useNotificationSocket({ enabled: !isPublicPath(pathname) });

  useEffect(() => {
    if (gameStarted === null) return;
    router.push(`/game/${gameStarted}`);
    clearGameStarted();
  }, [gameStarted, router, clearGameStarted]);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6">
      {toasts.map((item) => (
        <div
          key={item.id}
          className="sheet pointer-events-auto flex w-full max-w-sm flex-wrap items-center gap-3 p-3 shadow-[3px_3px_0_var(--color-rule)]"
        >
          <Avatar avatar={item.fromAvatar} size="sm" />
          <div className="min-w-0">
            <p className="text-sm">
              <span className="font-semibold">{item.fromUsername}</span>{" "}
              challenged you
            </p>
            <p className="font-mono text-xs text-ink-soft">
              {item.timeControl}
              {item.color !== "random" && ` · wants ${item.color}`}
            </p>
          </div>
          <span className="ml-auto flex gap-2">
            <button
              type="button"
              className="btn"
              onClick={() => acceptChallenge(item.id)}
            >
              Play
            </button>
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => declineChallenge(item.id)}
            >
              No thanks
            </button>
            <button
              type="button"
              aria-label="Dismiss"
              className="text-ink-soft hover:text-ink"
              onClick={() => dismiss(item.id)}
            >
              ×
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}
