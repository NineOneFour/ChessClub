import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/guards";
import * as chat from "@/lib/services/chat";
import * as games from "@/lib/services/games";
import * as users from "@/lib/services/users";
import { gameChannel } from "@/realtime/protocol";
import { GameRoom } from "@/app/components/GameRoom";
import { Shell } from "@/app/components/Shell";

export const dynamic = "force-dynamic";

/**
 * One page for playing, watching and reviewing. The board simply stops
 * accepting moves when you aren't a player or the game is over, so there is no
 * second screen to keep in step.
 *
 * The first render comes from the database; the socket takes over from there.
 */
export default async function GamePage({ params }: PageProps<"/game/[id]">) {
  const me = await requireUser();
  const { id } = await params;

  const gameId = Number(id);
  if (!Number.isInteger(gameId)) notFound();

  const [state, messages, viewer] = await Promise.all([
    games.get(gameId),
    chat.listVisible(gameChannel(gameId), 100),
    // For the board and the pieces: everybody sits at their own board.
    users.getById(me.id),
  ]);
  if (!state) notFound();

  const speak = chat.canSpeak(me, gameChannel(gameId));
  const playing = me.id === state.white.id || me.id === state.black.id;

  return (
    <Shell
      user={me}
      stamp={
        state.status === "active"
          ? playing
            ? "Your game"
            : "Watching"
          : "Finished"
      }
    >
      <GameRoom
        gameId={gameId}
        viewerId={me.id}
        canChat={speak.ok}
        boardStyle={viewer?.boardStyle ?? null}
        pieceSet={viewer?.pieceSet ?? null}
        chatBlockedReason={speak.ok ? null : speak.reason}
        initialGame={{
          ...state,
          startedAt: state.startedAt.toISOString(),
          finishedAt: state.finishedAt?.toISOString() ?? null,
        }}
        initialMessages={messages.map((message) => ({
          ...message,
          createdAt: message.createdAt.toISOString(),
        }))}
      />
    </Shell>
  );
}
