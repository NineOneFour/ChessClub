"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ServerChatMessage,
  ServerFrame,
  WireGame,
} from "@/realtime/protocol";

export type ConnectionState = "connecting" | "open" | "closed";

/** Where the browser should open the socket. */
export function realtimeUrl(): string {
  const configured = process.env.NEXT_PUBLIC_REALTIME_URL;
  if (configured) return configured;
  // In production the reverse proxy routes /ws to the realtime service.
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${window.location.host}/ws`;
}

/**
 * The browser half of one game's link.
 *
 * Reconnects with a backoff, and on every reconnect simply asks to watch the
 * game again — the server answers with the whole state, so a dropped
 * connection cannot leave a stale board on screen. There is no replay, no
 * catch-up protocol, and no client-side move queue: server state always wins.
 */
export function useGameSocket(
  gameId: number,
  initialGame: WireGame,
  initialMessages: ServerChatMessage[],
) {
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  /**
   * The game, plus when this browser received it. Clocks count down from that
   * local instant, so a browser whose clock is wrong still shows the right
   * elapsed time.
   */
  const [snapshot, setSnapshot] = useState(() => ({
    game: initialGame,
    receivedAt: Date.now(),
  }));
  const [messages, setMessages] = useState(initialMessages);
  const [notice, setNotice] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);
  const closedByUsRef = useRef(false);

  useEffect(() => {
    closedByUsRef.current = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    function connect() {
      const socket = new WebSocket(realtimeUrl());
      socketRef.current = socket;
      setConnection("connecting");

      socket.addEventListener("open", () => {
        attemptRef.current = 0;
        setConnection("open");
        socket.send(JSON.stringify({ t: "watch", gameId }));
      });

      socket.addEventListener("message", (event) => {
        let frame: ServerFrame;
        try {
          frame = JSON.parse(event.data as string) as ServerFrame;
        } catch {
          return;
        }

        switch (frame.t) {
          case "game":
            if (frame.game.id === gameId) {
              setSnapshot({ game: frame.game, receivedAt: Date.now() });
            }
            break;
          case "chat":
            if (frame.message.channel !== `game:${gameId}`) break;
            setMessages((current) =>
              current.some((m) => m.id === frame.message.id)
                ? current
                : [...current, frame.message],
            );
            break;
          case "notice":
            setNotice(frame.message);
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
  }, [gameId]);

  const request = useCallback(
    (frame: Record<string, unknown>) => {
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        setNotice("You're not connected. Trying to reconnect…");
        return false;
      }
      socket.send(JSON.stringify({ ...frame, gameId }));
      return true;
    },
    [gameId],
  );

  const move = useCallback(
    (m: { from: string; to: string; promotion?: string }) =>
      request({ t: "move", ...m }),
    [request],
  );
  const resign = useCallback(() => request({ t: "resign" }), [request]);
  const offerDraw = useCallback(() => request({ t: "draw" }), [request]);
  const cancelDraw = useCallback(() => request({ t: "drawCancel" }), [request]);
  const claimFlag = useCallback(() => request({ t: "flag" }), [request]);

  const say = useCallback(
    (body: string) => {
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) return false;
      socket.send(
        JSON.stringify({ t: "chat", channel: `game:${gameId}`, body }),
      );
      return true;
    },
    [gameId],
  );

  return {
    connection,
    game: snapshot.game,
    receivedAt: snapshot.receivedAt,
    messages,
    notice,
    setNotice,
    move,
    resign,
    offerDraw,
    cancelDraw,
    claimFlag,
    say,
  };
}

/**
 * A clock the browser counts down itself, from the one timestamp the server
 * sent. The server remains the authority — this is only so the digits move
 * between updates instead of jumping on each move.
 */
export function useLiveClock(
  game: WireGame,
  receivedAt: number,
): { whiteMs: number; blackMs: number } {
  const [now, setNow] = useState(() => Date.now());
  const ticking = game.status === "active" && game.clock.running;

  useEffect(() => {
    if (!ticking) return;
    // Ten times a second: enough for the tenths shown under ten seconds.
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, [ticking, receivedAt]);

  if (!ticking) {
    return { whiteMs: game.clock.whiteMs, blackMs: game.clock.blackMs };
  }

  // Elapsed since *this browser* received the frame. The server's figures were
  // already live when it sent them, so only the time since then is deducted.
  const spent = Math.max(0, now - receivedAt);
  return game.turn === "white"
    ? {
        whiteMs: Math.max(0, game.clock.whiteMs - spent),
        blackMs: game.clock.blackMs,
      }
    : {
        whiteMs: game.clock.whiteMs,
        blackMs: Math.max(0, game.clock.blackMs - spent),
      };
}
