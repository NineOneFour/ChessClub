"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  OnlineMember,
  ServerChatMessage,
  ServerFrame,
  WireChallenge,
  WireGameCard,
} from "@/realtime/protocol";
import { realtimeUrl } from "./useGameSocket";

export type ConnectionState = "connecting" | "open" | "closed";

/**
 * The browser half of the clubhouse link: presence, club chat, challenges and
 * the list of games in progress, all over the one socket.
 *
 * Reconnects with a backoff, because a kid's laptop closing and reopening is
 * the normal case, not the exceptional one. Server state always wins: presence
 * and challenges arrive as full lists rather than diffs, so a dropped
 * connection cannot leave something stale on screen.
 */
export function useClubSocket({
  initialOnline,
  initialMessages,
  initialIncoming,
  initialOutgoing,
  initialLiveGames,
  onGameStarted,
}: {
  initialOnline: OnlineMember[];
  initialMessages: ServerChatMessage[];
  initialIncoming: WireChallenge[];
  initialOutgoing: WireChallenge[];
  initialLiveGames: WireGameCard[];
  /** Called when a game you're in begins, so the page can go to the board. */
  onGameStarted?: (gameId: number) => void;
}) {
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [online, setOnline] = useState(initialOnline);
  const [messages, setMessages] = useState(initialMessages);
  const [notice, setNotice] = useState<string | null>(null);
  const [canChat, setCanChat] = useState(true);
  const [incoming, setIncoming] = useState(initialIncoming);
  const [outgoing, setOutgoing] = useState(initialOutgoing);
  const [liveGames, setLiveGames] = useState(initialLiveGames);

  const socketRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);
  const closedByUsRef = useRef(false);

  // Kept in a ref so that a changing callback doesn't tear down the socket.
  // Assigned in an effect rather than during render — React 19 forbids
  // touching a ref while rendering.
  const startedRef = useRef(onGameStarted);
  useEffect(() => {
    startedRef.current = onGameStarted;
  }, [onGameStarted]);

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
      });

      socket.addEventListener("message", (event) => {
        let frame: ServerFrame;
        try {
          frame = JSON.parse(event.data as string) as ServerFrame;
        } catch {
          return;
        }

        switch (frame.t) {
          case "ready":
            setCanChat(frame.canChat);
            setNotice(frame.chatBlockedReason ?? null);
            break;
          case "presence":
            setOnline(frame.online);
            break;
          case "chat":
            if (frame.message.channel !== "club") break;
            setMessages((current) =>
              current.some((m) => m.id === frame.message.id)
                ? current
                : [...current, frame.message],
            );
            break;
          case "challenges":
            setIncoming(frame.incoming);
            setOutgoing(frame.outgoing);
            break;
          case "lobby":
            setLiveGames(frame.games);
            break;
          case "gameStarted":
            startedRef.current?.(frame.gameId);
            break;
          case "notice":
            setNotice(frame.message);
            break;
          case "pong":
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
  }, []);

  const request = useCallback((frame: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setNotice("You're not connected to the clubhouse right now.");
      return false;
    }
    socket.send(JSON.stringify(frame));
    return true;
  }, []);

  const send = useCallback(
    (body: string) => request({ t: "chat", channel: "club", body }),
    [request],
  );

  const challenge = useCallback(
    (username: string, timeControl: string, color: string) =>
      request({ t: "challenge", username, timeControl, color }),
    [request],
  );

  const acceptChallenge = useCallback(
    (id: number) => request({ t: "challengeAccept", id }),
    [request],
  );
  const declineChallenge = useCallback(
    (id: number) => request({ t: "challengeDecline", id }),
    [request],
  );
  const cancelChallenge = useCallback(
    (id: number) => request({ t: "challengeCancel", id }),
    [request],
  );

  return {
    connection,
    online,
    messages,
    notice,
    setNotice,
    canChat,
    incoming,
    outgoing,
    liveGames,
    send,
    challenge,
    acceptChallenge,
    declineChallenge,
    cancelChallenge,
  };
}
