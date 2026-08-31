"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ServerChatMessage, WireGame } from "@/realtime/protocol";
import { formatClock } from "@/lib/chess/clock";
import { MAX_CHAT_LENGTH } from "@/lib/validation";
import { Avatar, GrownUpTag } from "./Avatar";
import { Board } from "./Board";
import { SectionHeading } from "./SectionHeading";
import { useGameSocket, useLiveClock } from "./useGameSocket";

/**
 * A game room. The same page whether you are playing, watching, or looking at a
 * game that finished last month — the board just stops accepting moves. That
 * keeps one set of code paths and means "review a game" needs no separate
 * screen.
 */
export function GameRoom({
  gameId,
  initialGame,
  initialMessages,
  viewerId,
  canChat,
  chatBlockedReason,
}: {
  gameId: number;
  initialGame: WireGame;
  initialMessages: ServerChatMessage[];
  viewerId: number;
  canChat: boolean;
  chatBlockedReason: string | null;
}) {
  const router = useRouter();

  const {
    connection,
    game,
    receivedAt,
    messages,
    notice,
    challenges,
    move,
    resign,
    offerDraw,
    cancelDraw,
    claimFlag,
    rematch,
    cancelChallenge,
    say,
  } = useGameSocket(gameId, initialGame, initialMessages, (newGameId) =>
    router.push(`/game/${newGameId}`),
  );

  const clocks = useLiveClock(game, receivedAt);

  const playingAs =
    viewerId === game.white.id
      ? "white"
      : viewerId === game.black.id
        ? "black"
        : null;

  const opponent =
    playingAs === "white"
      ? game.black
      : playingAs === "black"
        ? game.white
        : null;

  // A rematch travels as an ordinary challenge between the two players, so it
  // is simply the open challenge involving the person you just played.
  const myRematch = opponent
    ? (challenges.outgoing.find((c) => c.toId === opponent.id) ?? null)
    : null;
  const theirRematch = opponent
    ? (challenges.incoming.find((c) => c.fromId === opponent.id) ?? null)
    : null;

  // Spectators watch from white's side; players from their own.
  const [flipped, setFlipped] = useState(false);
  const orientation =
    (playingAs === "black") !== flipped ? "black" : ("white" as const);

  /**
   * When the clock on screen hits zero, ask the server to check. The server
   * has its own watchdog, so this is a belt-and-braces path for the case where
   * the browser notices first — and `claimFlag` does nothing if there is
   * actually time left.
   */
  const flagAskedRef = useRef(false);
  const outOfTime =
    game.status === "active" &&
    game.clock.running &&
    (game.turn === "white" ? clocks.whiteMs : clocks.blackMs) <= 0;

  useEffect(() => {
    if (!outOfTime || flagAskedRef.current) return;
    flagAskedRef.current = true;
    claimFlag();
  }, [outOfTime, claimFlag]);

  useEffect(() => {
    flagAskedRef.current = false;
  }, [game.ply, game.status]);

  const drawOfferedToMe =
    game.status === "active" &&
    game.drawOfferBy !== null &&
    playingAs !== null &&
    game.drawOfferBy !== viewerId;
  const drawOfferedByMe = game.drawOfferBy === viewerId;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section className="mx-auto w-full max-w-[36rem]">
        <PlayerBar
          player={orientation === "white" ? game.black : game.white}
          ms={orientation === "white" ? clocks.blackMs : clocks.whiteMs}
          showClock={game.initialMs > 0}
          toMove={
            game.status === "active" &&
            game.turn === (orientation === "white" ? "black" : "white")
          }
          isWinner={
            game.winnerId ===
            (orientation === "white" ? game.black.id : game.white.id)
          }
        />

        <div className="my-2">
          <Board
            fen={game.fen}
            orientation={orientation}
            dests={game.dests}
            promotions={game.promotions}
            lastMove={game.lastMove}
            inCheck={game.inCheck}
            turn={game.turn}
            playingAs={game.status === "active" ? playingAs : null}
            onMove={move}
          />
        </div>

        <PlayerBar
          player={orientation === "white" ? game.white : game.black}
          ms={orientation === "white" ? clocks.whiteMs : clocks.blackMs}
          showClock={game.initialMs > 0}
          toMove={game.status === "active" && game.turn === orientation}
          isWinner={
            game.winnerId ===
            (orientation === "white" ? game.white.id : game.black.id)
          }
        />

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => setFlipped((current) => !current)}
          >
            Flip board
          </button>

          {game.status === "active" && playingAs && (
            <>
              {drawOfferedToMe ? (
                <button type="button" className="btn" onClick={offerDraw}>
                  Accept draw
                </button>
              ) : drawOfferedByMe ? (
                <button
                  type="button"
                  className="btn btn-quiet"
                  onClick={cancelDraw}
                >
                  Take back draw offer
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-quiet"
                  onClick={offerDraw}
                >
                  Offer a draw
                </button>
              )}
              <ResignButton onResign={resign} />
            </>
          )}

          {game.status === "finished" && playingAs && (
            <>
              {myRematch ? (
                <button
                  type="button"
                  className="btn btn-quiet"
                  onClick={() => cancelChallenge(myRematch.id)}
                >
                  Take back {theirRematch ? "my offer" : "the offer"}
                </button>
              ) : (
                <button type="button" className="btn" onClick={rematch}>
                  Play again
                </button>
              )}
            </>
          )}

          {game.status === "finished" && (
            <a href={`/game/${game.id}/pgn`} className="btn btn-quiet">
              Download PGN
            </a>
          )}

          <span className="eyebrow ml-auto">
            {game.timeControl}
            {connection !== "open" && " · reconnecting"}
          </span>
        </div>

        {drawOfferedToMe && (
          <p className="mt-3 border-l-2 border-brass pl-3 text-sm">
            {
              (game.drawOfferBy === game.white.id ? game.white : game.black)
                .username
            }{" "}
            is offering a draw.
          </p>
        )}
        {theirRematch && !myRematch && (
          <p className="mt-3 border-l-2 border-brass pl-3 text-sm">
            {opponent?.username} wants another game —{" "}
            <strong>Play again</strong> starts it.
          </p>
        )}
        {myRematch && (
          <p className="mt-3 border-l-2 border-rule pl-3 text-sm text-ink-soft">
            Waiting for {opponent?.username} to play again.
          </p>
        )}
        {notice && (
          <p role="status" className="mt-3 text-sm text-stamp">
            {notice}
          </p>
        )}

        <Outcome game={game} viewerId={viewerId} playingAs={playingAs} />
      </section>

      <aside className="space-y-8">
        <div>
          <SectionHeading
            label="Score sheet"
            count={`${Math.ceil(game.ply / 2)} moves`}
          />
          <ScoreSheet moves={game.moves} />
        </div>

        <div>
          <SectionHeading label="Game chat" />
          <GameChat
            messages={messages}
            viewerId={viewerId}
            canChat={canChat}
            blockedReason={chatBlockedReason}
            connected={connection === "open"}
            onSay={say}
          />
        </div>
      </aside>
    </div>
  );
}

function PlayerBar({
  player,
  ms,
  showClock,
  toMove,
  isWinner,
}: {
  player: WireGame["white"];
  ms: number;
  showClock: boolean;
  toMove: boolean;
  isWinner: boolean;
}) {
  const low = showClock && ms < 20_000;

  return (
    <div
      className={`flex items-center gap-3 border-y px-3 py-2 ${
        toMove ? "border-ink bg-sheet" : "border-rule"
      }`}
    >
      <Avatar avatar={player.avatar} role={player.role} size="sm" />
      <Link
        href={`/profile/${player.username}`}
        className="flex min-w-0 items-center gap-1.5"
      >
        <span className="truncate font-semibold">{player.username}</span>
        <GrownUpTag role={player.role} />
      </Link>
      {isWinner && <span className="eyebrow text-brass">won</span>}

      {showClock && (
        <span
          className={`ml-auto font-mono text-2xl tabular-nums ${
            low ? "text-stamp" : toMove ? "text-ink" : "text-ink-soft"
          }`}
        >
          {formatClock(ms)}
        </span>
      )}
    </div>
  );
}

/**
 * Resigning takes two taps. A native confirm() would block the page, and a
 * misplaced tap losing a game the kid was winning is exactly the thing worth
 * spending a click on.
 */
function ResignButton({ onResign }: { onResign: () => void }) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);

  return armed ? (
    <button type="button" className="btn btn-warn" onClick={onResign}>
      Really resign?
    </button>
  ) : (
    <button
      type="button"
      className="btn btn-quiet"
      onClick={() => setArmed(true)}
    >
      Resign
    </button>
  );
}

const REASON_WORDS: Record<string, string> = {
  checkmate: "by checkmate",
  resignation: "by resignation",
  stalemate: "— stalemate",
  insufficient_material: "— not enough pieces left to mate",
  fifty_move: "— fifty moves without a capture or a pawn move",
  threefold: "— the same position three times",
  flag: "on time",
  agreement: "by agreement",
};

function Outcome({
  game,
  viewerId,
  playingAs,
}: {
  game: WireGame;
  viewerId: number;
  playingAs: "white" | "black" | null;
}) {
  if (game.status !== "finished") return null;

  const reason = game.resultReason
    ? (REASON_WORDS[game.resultReason] ?? "")
    : "";
  const drawn = game.winnerId === null;
  const winner =
    game.winnerId === game.white.id
      ? game.white
      : game.winnerId === game.black.id
        ? game.black
        : null;

  const headline = drawn
    ? `Drawn ${reason}`.trim()
    : `${winner?.username} won ${reason}`.trim();

  // A line for the players, and only for them.
  const personal =
    playingAs === null
      ? null
      : drawn
        ? "A draw. Nothing between you."
        : game.winnerId === viewerId
          ? "Good game."
          : "Hard luck — have another?";

  return (
    <div className="sheet mt-4 p-4">
      <p className="masthead text-xl">{headline}</p>
      {personal && <p className="mt-1 text-sm text-ink-soft">{personal}</p>}
      <p className="mt-2 font-mono text-xs text-ink-soft">
        {game.result} · {Math.ceil(game.ply / 2)} moves
      </p>
    </div>
  );
}

/**
 * The move list, set as an actual score sheet: numbered rows, white's move and
 * black's reply side by side. This is the shape the whole design borrows from,
 * so here it is literal.
 */
function ScoreSheet({ moves }: { moves: WireGame["moves"] }) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [moves.length]);

  if (moves.length === 0) {
    return (
      <p className="sheet p-4 text-sm text-ink-soft">
        No moves yet. White starts.
      </p>
    );
  }

  const pairs: { number: number; white?: string; black?: string }[] = [];
  for (const move of moves) {
    const index = Math.ceil(move.ply / 2);
    const pair = (pairs[index - 1] ??= { number: index });
    if (move.ply % 2 === 1) pair.white = move.san;
    else pair.black = move.san;
  }

  return (
    <div className="sheet ruled max-h-[22rem] overflow-y-auto">
      {pairs.map((pair) => (
        <div key={pair.number} className="flex gap-3 px-3 py-1">
          <span className="gutter">{pair.number}.</span>
          <span className="w-16 font-mono text-sm">{pair.white ?? ""}</span>
          <span className="w-16 font-mono text-sm">{pair.black ?? ""}</span>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}

function GameChat({
  messages,
  viewerId,
  canChat,
  blockedReason,
  connected,
  onSay,
}: {
  messages: ServerChatMessage[];
  viewerId: number;
  canChat: boolean;
  blockedReason: string | null;
  connected: boolean;
  onSay: (body: string) => boolean;
}) {
  const [value, setValue] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  return (
    <div>
      <div className="sheet max-h-[14rem] min-h-[6rem] overflow-y-auto p-3">
        {messages.length === 0 ? (
          <p className="text-sm text-ink-soft">
            Nothing said in this game yet.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {messages.map((message) => (
              <li key={message.id} className="text-sm leading-snug">
                <span
                  className={`font-semibold ${
                    message.userId === viewerId ? "text-brass" : ""
                  }`}
                >
                  {message.username}
                </span>{" "}
                <GrownUpTag role={message.role} />{" "}
                <span className="break-words">{message.body}</span>
              </li>
            ))}
          </ul>
        )}
        <div ref={endRef} />
      </div>

      {canChat ? (
        <form
          className="mt-2 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const body = value.trim();
            if (!body) return;
            if (onSay(body)) setValue("");
          }}
        >
          <label htmlFor="game-chat" className="sr-only">
            Say something in this game
          </label>
          <input
            id="game-chat"
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
      ) : (
        <p className="mt-2 border-l-2 border-rule pl-3 text-sm text-ink-soft">
          {blockedReason ?? "Chat is switched off for your account."}
        </p>
      )}
    </div>
  );
}
