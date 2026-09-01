"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ServerFrame, WireChallenge } from "@/realtime/protocol";
import { realtimeUrl } from "./useGameSocket";

export type ConnectionState = "connecting" | "open" | "closed";

/**
 * A second, lightweight socket, kept open for as long as the tab is on any
 * page that needs it — mounted once in the root layout, so a challenge
 * reaches you wherever you are in the club, not only while the clubhouse
 * page happens to be open.
 *
 * Deliberately a second connection rather than one socket shared with
 * `useClubSocket`/`useGameSocket` through a context provider: with a dozen
 * members, the cost of an extra idle connection per tab is nothing, and it's
 * the reversible direction — sharing one connection later is easy, untangling
 * one that several screens depend on is not. See context/decisions.md.
 *
 * Only ever surfaces *new* incoming challenges: the first "challenges" frame
 * after connecting seeds the seen set rather than toasting, so a page
 * navigation (which reconnects this socket) never re-announces something
 * already known about.
 */
export function useNotificationSocket({ enabled }: { enabled: boolean }) {
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [toasts, setToasts] = useState<WireChallenge[]>([]);
  const [gameStarted, setGameStarted] = useState<number | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);
  const closedByUsRef = useRef(false);
  const seenRef = useRef<Set<number> | null>(null);

  useEffect(() => {
    if (!enabled) return;

    closedByUsRef.current = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    function connect() {
      const socket = new WebSocket(realtimeUrl());
      socketRef.current = socket;
      setConnection("connecting");
      // A fresh connection means a fresh baseline: whatever is already
      // incoming is "known about", not new.
      seenRef.current = null;

      socket.addEventListener("open", () => {
        attemptRef.current = 0;
        setConnection("open");
      });

      socket.addEventListener("message", (event) => {
        let frame: ServerFrame;
        try {
          frame = JSON.parse(event.data as string) as ServerFrame;
        } catch {
          return;
        }

        switch (frame.t) {
          case "challenges": {
            const seen = seenRef.current;
            if (seen === null) {
              seenRef.current = new Set(frame.incoming.map((c) => c.id));
              break;
            }
            const fresh = frame.incoming.filter((c) => !seen.has(c.id));
            fresh.forEach((c) => seen.add(c.id));

            const stillIncoming = new Set(frame.incoming.map((c) => c.id));
            setToasts((current) => [
              ...current.filter((t) => stillIncoming.has(t.id)),
              ...fresh,
            ]);
            break;
          }
          case "gameStarted":
            setGameStarted(frame.gameId);
            break;
          default:
            break;
        }
      });

      socket.addEventListener("close", () => {
        setConnection("closed");
        if (closedByUsRef.current) return;
        const delay = Math.min(1000 * 2 ** attemptRef.current, 15_000);
        attemptRef.current += 1;
        reconnectTimer = setTimeout(connect, delay);
      });
    }

    connect();

    return () => {
      closedByUsRef.current = true;
      clearTimeout(reconnectTimer);
      socketRef.current?.close();
    };
  }, [enabled]);

  const request = useCallback((frame: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(frame));
    return true;
  }, []);

  const acceptChallenge = useCallback(
    (id: number) => {
      setToasts((current) => current.filter((t) => t.id !== id));
      request({ t: "challengeAccept", id });
    },
    [request],
  );
  const declineChallenge = useCallback(
    (id: number) => {
      setToasts((current) => current.filter((t) => t.id !== id));
      request({ t: "challengeDecline", id });
    },
    [request],
  );
  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const clearGameStarted = useCallback(() => setGameStarted(null), []);

  return {
    connection,
    toasts,
    acceptChallenge,
    declineChallenge,
    dismiss,
    gameStarted,
    clearGameStarted,
  };
}
