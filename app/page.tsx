import { requireUser } from "@/lib/auth/guards";
import { CLUB_CHANNEL } from "@/lib/db/schema";
import * as challenges from "@/lib/services/challenges";
import * as chat from "@/lib/services/chat";
import * as games from "@/lib/services/games";
import * as offers from "@/lib/services/offers";
import * as users from "@/lib/services/users";
import { Clubhouse } from "./components/Clubhouse";
import { Shell } from "./components/Shell";

export const dynamic = "force-dynamic";

/**
 * The clubhouse. Everything here is rendered from the database first, then the
 * socket takes over and keeps it live — so a member sees the room, the games,
 * their challenges and the conversation on the very first paint rather than
 * watching them appear one by one.
 */
export default async function ClubhousePage() {
  const me = await requireUser();

  const [
    roster,
    messages,
    myActiveGameId,
    incoming,
    outgoing,
    liveGames,
    openOffers,
  ] = await Promise.all([
    users.listClubMembers(),
    chat.listVisible(CLUB_CHANNEL),
    games.activeGameFor(me.id),
    challenges.listIncoming(me.id),
    challenges.listOutgoing(me.id),
    games.listActive(),
    offers.listOpen(),
  ]);

  const speak = chat.canSpeak(me);

  return (
    <Shell user={me} stamp={`${roster.length} members`}>
      <Clubhouse
        me={{
          id: me.id,
          canChat: speak.ok,
          chatBlockedReason: speak.ok ? null : speak.reason,
        }}
        roster={roster}
        myActiveGameId={myActiveGameId}
        initialOnline={roster
          .filter((member) => member.isOnline)
          .map(({ id, username, avatar, role }) => ({
            id,
            username,
            avatar,
            role,
          }))}
        initialMessages={messages.map((message) => ({
          ...message,
          createdAt: message.createdAt.toISOString(),
        }))}
        initialIncoming={incoming}
        initialOutgoing={outgoing}
        initialLiveGames={liveGames.map((game) => ({
          id: game.id,
          whiteUsername: game.white.username,
          whiteAvatar: game.white.avatar,
          blackUsername: game.black.username,
          blackAvatar: game.black.avatar,
          timeControl: game.timeControl,
          ply: game.ply,
        }))}
        initialOffers={openOffers.map(
          ({
            id,
            fromId,
            fromUsername,
            fromAvatar,
            fromRole,
            color,
            timeControl,
          }) => ({
            id,
            fromId,
            fromUsername,
            fromAvatar,
            fromRole,
            color,
            timeControl,
          }),
        )}
      />
    </Shell>
  );
}
