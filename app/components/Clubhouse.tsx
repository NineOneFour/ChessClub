"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type {
  OnlineMember,
  ServerChatMessage,
  WireChallenge,
  WireGameCard,
  WireOffer,
} from "@/realtime/protocol";
import { TIME_CONTROLS } from "@/lib/chess/time-controls";
import { MAX_CHAT_LENGTH } from "@/lib/validation";
import { Avatar, GrownUpTag } from "./Avatar";
import { SectionHeading } from "./SectionHeading";
import { useClubSocket } from "./useClubSocket";

export type RosterMember = {
  id: number;
  username: string;
  avatar: string;
  familyName: string | null;
  role: string;
  isOnline: boolean;
};

/**
 * The clubhouse. Walking in, a member should see who's here, what's being
 * played, who has challenged them, whose board is out, and the conversation —
 * with **play**, **watch** and **chat** as the obvious things to do.
 *
 * Everything on this screen comes down the one socket, so the roster, the
 * challenge list and the games in progress cannot drift apart.
 */
export function Clubhouse({
  me,
  roster,
  initialOnline,
  initialMessages,
  initialIncoming,
  initialOutgoing,
  initialLiveGames,
  initialOffers,
  myActiveGameId,
}: {
  me: { id: number; canChat: boolean; chatBlockedReason: string | null };
  roster: RosterMember[];
  initialOnline: OnlineMember[];
  initialMessages: ServerChatMessage[];
  initialIncoming: WireChallenge[];
  initialOutgoing: WireChallenge[];
  initialLiveGames: WireGameCard[];
  initialOffers: WireOffer[];
  myActiveGameId: number | null;
}) {
  const router = useRouter();

  const {
    connection,
    online,
    messages,
    notice,
    canChat,
    incoming,
    outgoing,
    liveGames,
    offers,
    send,
    challenge,
    offerGame,
    acceptOffer,
    cancelOffer,
    acceptChallenge,
    declineChallenge,
    cancelChallenge,
  } = useClubSocket({
    initialOnline,
    initialMessages,
    initialIncoming,
    initialOutgoing,
    initialLiveGames,
    initialOffers,
    onGameStarted: (gameId) => router.push(`/game/${gameId}`),
  });

  const onlineIds = new Set(online.map((member) => member.id));
  const others = roster.filter((member) => member.id !== me.id);
  const inTheRoom = others.filter((member) => onlineIds.has(member.id));
  const away = others.filter((member) => !onlineIds.has(member.id));

  const [challenging, setChallenging] = useState<RosterMember | null>(null);
  const [offering, setOffering] = useState(false);

  const myOffer = offers.find((offer) => offer.fromId === me.id) ?? null;
  const canPlay = myActiveGameId === null;

  return (
    <div className="space-y-8">
      {myActiveGameId !== null && (
        <Link
          href={`/game/${myActiveGameId}`}
          className="sheet flex items-center justify-between gap-4 border-ink p-4 hover:bg-white"
        >
          <span>
            <span className="eyebrow text-ink">Your game is waiting</span>
            <span className="masthead mt-1 block text-xl">
              Back to the board
            </span>
          </span>
          <span className="btn">Play</span>
        </Link>
      )}

      {incoming.length > 0 && (
        <section>
          <SectionHeading
            label="You've been challenged"
            count={`${incoming.length}`}
          />
          <div className="sheet ruled">
            {incoming.map((item) => (
              <div
                key={item.id}
                className="flex flex-wrap items-center gap-3 px-3 py-2"
              >
                <Avatar avatar={item.fromAvatar} size="sm" />
                <span className="text-sm font-semibold">
                  {item.fromUsername}
                </span>
                <span className="font-mono text-xs text-ink-soft">
                  {item.timeControl}
                  {item.color !== "random" && ` · wants ${item.color}`}
                </span>
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
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {canPlay && (
        <section>
          <SectionHeading
            label="Boards out"
            action={
              myOffer ? (
                <button
                  type="button"
                  className="eyebrow hover:text-stamp"
                  onClick={() => cancelOffer(myOffer.id)}
                >
                  Take mine back
                </button>
              ) : (
                <button
                  type="button"
                  className="btn"
                  onClick={() => setOffering(true)}
                >
                  Start a game
                </button>
              )
            }
          />
          {offers.length === 0 ? (
            <p className="text-sm text-ink-soft">
              Nobody is waiting for a game. Put a board out and the first person
              here can sit down.
            </p>
          ) : (
            <div className="sheet ruled">
              {offers.map((offer) => (
                <div
                  key={offer.id}
                  className="flex flex-wrap items-center gap-3 px-3 py-2"
                >
                  <Avatar
                    avatar={offer.fromAvatar}
                    role={offer.fromRole}
                    size="sm"
                  />
                  <span className="text-sm font-semibold">
                    {offer.fromId === me.id ? "You" : offer.fromUsername}
                  </span>
                  <GrownUpTag role={offer.fromRole} />
                  <span className="font-mono text-xs text-ink-soft">
                    {offer.timeControl}
                    {offer.color !== "random" && ` · wants ${offer.color}`}
                  </span>
                  {offer.fromId === me.id ? (
                    <span className="ml-auto text-xs text-ink-soft">
                      Waiting for someone to sit down
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="btn ml-auto"
                      onClick={() => acceptOffer(offer.id)}
                    >
                      Play
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <div className="grid gap-8 lg:grid-cols-[1fr_17rem]">
        <section>
          <SectionHeading
            label="Clubhouse chat"
            count={
              connection === "open"
                ? `${online.length} here`
                : connection === "connecting"
                  ? "connecting"
                  : "offline"
            }
          />
          <Transcript messages={messages} meId={me.id} />
          <Composer
            canChat={canChat && me.canChat}
            blockedReason={me.chatBlockedReason ?? notice}
            connected={connection === "open"}
            onSend={send}
          />
          {notice && canChat && (
            <p role="status" className="mt-2 text-sm text-stamp">
              {notice}
            </p>
          )}
        </section>

        <aside className="space-y-8">
          {liveGames.length > 0 && (
            <div>
              <SectionHeading
                label="Being played"
                count={`${liveGames.length}`}
              />
              <ul className="space-y-2">
                {liveGames.map((game) => (
                  <li key={game.id}>
                    <Link
                      href={`/game/${game.id}`}
                      className="sheet flex items-center gap-2 px-2 py-1.5 hover:bg-white"
                    >
                      <Avatar avatar={game.whiteAvatar} size="sm" />
                      <Avatar avatar={game.blackAvatar} size="sm" />
                      <span className="min-w-0 flex-1 truncate text-xs">
                        {game.whiteUsername} v {game.blackUsername}
                      </span>
                      <span className="eyebrow">Watch</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <SectionHeading label="In the room" count={`${inTheRoom.length}`} />
            {inTheRoom.length === 0 ? (
              <p className="text-sm text-ink-soft">
                Nobody else yet. Say hello and someone will turn up.
              </p>
            ) : (
              <ul className="space-y-2">
                {inTheRoom.map((member) => (
                  <MemberRow
                    key={member.id}
                    member={member}
                    online
                    onChallenge={
                      canPlay ? () => setChallenging(member) : undefined
                    }
                  />
                ))}
              </ul>
            )}
          </div>

          {outgoing.length > 0 && (
            <div>
              <SectionHeading label="Waiting on" count={`${outgoing.length}`} />
              <ul className="space-y-2">
                {outgoing.map((item) => (
                  <li key={item.id} className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">
                      {item.toUsername}
                      <span className="ml-1 font-mono text-[0.65rem] text-ink-soft">
                        {item.timeControl}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="eyebrow hover:text-stamp"
                      onClick={() => cancelChallenge(item.id)}
                    >
                      Cancel
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {away.length > 0 && (
            <div>
              <SectionHeading label="Not here today" count={`${away.length}`} />
              <ul className="space-y-2">
                {away.map((member) => (
                  <MemberRow key={member.id} member={member} online={false} />
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>

      {challenging && (
        <GameDialog
          eyebrow="Challenge"
          title={challenging.username}
          onClose={() => setChallenging(null)}
          onSend={(timeControl, color) => {
            challenge(challenging.username, timeControl, color);
            setChallenging(null);
          }}
        />
      )}

      {offering && (
        <GameDialog
          eyebrow="Start a game"
          title="Anyone who's here"
          onClose={() => setOffering(false)}
          onSend={(timeControl, color) => {
            offerGame(timeControl, color);
            setOffering(false);
          }}
        />
      )}
    </div>
  );
}

function MemberRow({
  member,
  online,
  onChallenge,
}: {
  member: RosterMember;
  online: boolean;
  onChallenge?: () => void;
}) {
  return (
    <li className="flex items-center gap-2">
      <Link
        href={`/profile/${member.username}`}
        className={`flex min-w-0 flex-1 items-center gap-3 ${
          online ? "" : "opacity-55"
        }`}
      >
        <Avatar
          avatar={member.avatar}
          role={member.role}
          size="sm"
          online={online}
        />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">
              {member.username}
            </span>
            <GrownUpTag role={member.role} />
          </span>
          {member.familyName && (
            <span className="block truncate font-mono text-[0.65rem] text-ink-soft">
              {member.familyName}
            </span>
          )}
        </span>
      </Link>

      {onChallenge && (
        <button
          type="button"
          className="eyebrow whitespace-nowrap hover:text-ink"
          onClick={onChallenge}
        >
          Challenge
        </button>
      )}
    </li>
  );
}

/**
 * Picking a game — for a challenge to one member, or a board put out for
 * whoever is here. Time control is the choice that matters, so each option is a
 * button that sends it — one tap, not a form to fill in. Colour sits above it
 * as a detail most kids will leave alone.
 */
function GameDialog({
  eyebrow,
  title,
  onClose,
  onSend,
}: {
  eyebrow: string;
  title: string;
  onClose: () => void;
  onSend: (timeControl: string, color: string) => void;
}) {
  const [color, setColor] = useState("random");

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-20 grid place-items-center bg-ink/45 p-4"
      onClick={onClose}
    >
      <div
        className="sheet w-full max-w-sm p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="eyebrow">{eyebrow}</p>
        <h2 className="masthead mt-1 text-2xl">{title}</h2>

        <fieldset className="mt-4">
          <legend className="eyebrow">I&apos;ll play</legend>
          <div className="mt-2 flex gap-2">
            {[
              { key: "random", label: "Either" },
              { key: "white", label: "White" },
              { key: "black", label: "Black" },
            ].map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setColor(option.key)}
                className={`btn ${color === option.key ? "" : "btn-quiet"}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>

        <p className="eyebrow mt-5">Time</p>
        <ul className="mt-2 space-y-2">
          {TIME_CONTROLS.map((control) => (
            <li key={control.key}>
              <button
                type="button"
                onClick={() => onSend(control.key, color)}
                className="flex w-full items-baseline gap-3 border border-rule bg-white px-3 py-2 text-left hover:border-ink"
              >
                <span className="font-mono text-sm">{control.label}</span>
                <span className="text-xs text-ink-soft">{control.blurb}</span>
              </button>
            </li>
          ))}
        </ul>

        <button type="button" className="btn btn-quiet mt-4" onClick={onClose}>
          Never mind
        </button>
      </div>
    </div>
  );
}

/**
 * The transcript is set as a score sheet: a numbered gutter, one ruled row per
 * message. Consecutive messages from the same person keep their own number
 * (every move gets a number) but drop the repeated name.
 */
function Transcript({
  messages,
  meId,
}: {
  messages: ServerChatMessage[];
  meId: number;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // Only auto-scroll when the reader is already at the bottom, so scrolling
    // back to read something doesn't yank you away.
    if (pinnedRef.current) {
      endRef.current?.scrollIntoView({ block: "end" });
    }
  }, [messages]);

  function onScroll() {
    const container = containerRef.current;
    if (!container) return;
    const distance =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    pinnedRef.current = distance < 60;
  }

  if (messages.length === 0) {
    return (
      <div className="sheet grid min-h-[14rem] place-items-center p-6 text-center">
        <p className="max-w-xs text-sm text-ink-soft">
          Nothing on the sheet yet. First message of the club goes here.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      className="sheet ruled max-h-[min(55vh,38rem)] min-h-[14rem] overflow-y-auto"
    >
      {messages.map((message, index) => {
        const previous = messages[index - 1];
        const sameAuthor = previous?.userId === message.userId;
        return (
          <article key={message.id} className="flex gap-3 px-3 py-1.5">
            <span className="gutter">{index + 1}</span>
            <div className="min-w-0 flex-1">
              {!sameAuthor && (
                <div className="flex items-baseline gap-2">
                  <Link
                    href={`/profile/${message.username}`}
                    className={`text-sm font-semibold hover:underline ${
                      message.userId === meId ? "text-brass" : ""
                    }`}
                  >
                    {message.username}
                  </Link>
                  <GrownUpTag role={message.role} />
                  <time
                    dateTime={message.createdAt}
                    className="font-mono text-[0.65rem] text-ink-soft"
                  >
                    {new Date(message.createdAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </div>
              )}
              <p className="whitespace-pre-wrap break-words text-[0.95rem] leading-snug">
                {message.body}
              </p>
            </div>
          </article>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}

function Composer({
  canChat,
  blockedReason,
  connected,
  onSend,
}: {
  canChat: boolean;
  blockedReason: string | null;
  connected: boolean;
  onSend: (body: string) => boolean;
}) {
  const [value, setValue] = useState("");

  if (!canChat) {
    return (
      <p className="mt-3 border-l-2 border-rule pl-3 text-sm text-ink-soft">
        {blockedReason ?? "Chat is switched off for your account."}
      </p>
    );
  }

  return (
    <form
      className="mt-3 flex gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const body = value.trim();
        if (!body) return;
        if (onSend(body)) setValue("");
      }}
    >
      <label htmlFor="chat-body" className="sr-only">
        Message the clubhouse
      </label>
      <input
        id="chat-body"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        maxLength={MAX_CHAT_LENGTH}
        autoComplete="off"
        placeholder={connected ? "Say something" : "Reconnecting…"}
        className="field"
      />
      <button
        type="submit"
        className="btn"
        disabled={!connected || !value.trim()}
      >
        Send
      </button>
    </form>
  );
}
