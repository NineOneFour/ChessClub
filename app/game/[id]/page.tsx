import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/guards";
import * as analysisService from "@/lib/services/analysis";
import * as chat from "@/lib/services/chat";
import * as coach from "@/lib/services/coach";
import * as games from "@/lib/services/games";
import * as ratings from "@/lib/services/ratings";
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

  const [state, messages, viewer, performance, analysis, coachSummary] =
    await Promise.all([
      games.get(gameId),
      chat.listVisible(gameChannel(gameId), 100),
      // For the board and the pieces: everybody sits at their own board.
      users.getById(me.id),
      // Null unless the viewer played in it and it has been analysed. Stockfish's
      // opinion is never available during a live game — see design.md §17.
      ratings.performanceIn(gameId, me.id),
      // Per-move quality (best/good/inaccuracy/mistake/blunder) for the score
      // sheet — unlike performanceIn, open to anyone reviewing a finished game,
      // not just the two players. Also null during a live game.
      analysisService.forGame(gameId),
      // The LLM coaching summary, same visibility as performance: only the
      // viewer's own text, only once Stockfish and Groq have both finished.
      // These last three are the state of the review *at this instant*; a game
      // that has only just ended has none of them yet, so the room asks again
      // itself rather than making anyone reload — see useGameReview.ts.
      coach.summaryFor(gameId, me.id),
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
        initialReview={{ performance, analysis, coachSummary }}
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
