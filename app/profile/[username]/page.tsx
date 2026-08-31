import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/guards";
import * as games from "@/lib/services/games";
import * as ratings from "@/lib/services/ratings";
import * as stats from "@/lib/services/stats";
import * as users from "@/lib/services/users";
import { GameList } from "@/app/components/GameList";
import { MemberHeader } from "@/app/components/MemberHeader";
import { RecordPanel } from "@/app/components/Stats";
import { StrengthPanel } from "@/app/components/Strength";
import { SectionHeading } from "@/app/components/SectionHeading";
import { Shell } from "@/app/components/Shell";

export const dynamic = "force-dynamic";

/** How many games a card shows. Everything is on the games page. */
const RECENT_GAMES = 10;

/**
 * What the club sees when it clicks somebody's name. Everyone here plays, so
 * parents and the administrator have one too — tagged, so a kid can see who
 * they're looking at.
 *
 * No personal details: the username, the family, and how their chess is going.
 * The real name is deliberately not here even for their own family, because a
 * page that shows it to some viewers and not others is a page that will one day
 * show it to the wrong one. It belongs on the family page and the admin roster,
 * which exist for exactly that.
 *
 * Rivalries are not here either. They are on the member's own card, `/card`.
 */
export default async function ProfilePage({
  params,
}: PageProps<"/profile/[username]">) {
  const me = await requireUser();
  const { username } = await params;

  const member = await users.getByUsername(username);
  if (!member || !member.isActive) notFound();

  const [online, record, recent, strength] = await Promise.all([
    users
      .listClubMembers()
      .then((list) => list.find((m) => m.id === member.id)?.isOnline ?? false),
    stats.recordFor(member.id),
    games.listForUser(member.id, RECENT_GAMES),
    ratings.strengthFor(member.id),
  ]);

  const mine = member.id === me.id;

  return (
    <Shell user={me} stamp="Member card">
      <div className="max-w-xl">
        <MemberHeader
          username={member.username}
          familyName={member.familyName}
          avatar={member.avatar}
          role={member.role}
          online={online}
          lastSeenAt={member.lastSeenAt}
        />

        <div className="mt-8">
          <SectionHeading label="Playing strength" />
          <StrengthPanel
            strength={strength}
            empty={
              mine
                ? "No analysed games long enough to judge yet."
                : `Not enough of ${member.username}'s games have been analysed yet.`
            }
          />
        </div>

        <div className="mt-8">
          <SectionHeading label="Record" />
          <RecordPanel
            record={record}
            empty={
              mine
                ? "You haven't finished a game yet."
                : `${member.username} hasn't finished a game yet.`
            }
          />
        </div>

        <div className="mt-8">
          <SectionHeading label="Recent games" count={`${recent.length}`} />
          <GameList
            games={recent}
            viewerId={me.id}
            empty="Nothing played yet."
          />
        </div>
      </div>
    </Shell>
  );
}
