import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/guards";
import * as games from "@/lib/services/games";
import * as ratings from "@/lib/services/ratings";
import * as stats from "@/lib/services/stats";
import * as users from "@/lib/services/users";
import { canSeeRealName } from "@/lib/roles";
import { GameList } from "@/app/components/GameList";
import { MemberHeader } from "@/app/components/MemberHeader";
import { RecordPanel, RivalryPanel } from "@/app/components/Stats";
import { StrengthPanel } from "@/app/components/Strength";
import { SectionHeading } from "@/app/components/SectionHeading";
import { Shell } from "@/app/components/Shell";

export const dynamic = "force-dynamic";

export const metadata = { title: "My card" };

/** How many games the card shows. Everything is on the games page. */
const RECENT_GAMES = 10;

/**
 * Your own card: how you are actually playing. Everything the club can see
 * about your chess, plus the things only you should — your rivalries, and in
 * time the coach's reading of where you are struggling.
 *
 * The public version of this is `/profile/[username]`, which shows the record
 * and the games and stops there. "Who keeps beating me" is a useful thing to
 * know about yourself and an unkind thing for eight children to know about each
 * other.
 *
 * Settings live in `/me`. This page changes nothing.
 */
export default async function MyCardPage() {
  const me = await requireUser();

  const record = await users.getById(me.id);
  if (!record) notFound();

  const [online, results, rivalries, recent, strength, performances] =
    await Promise.all([
      users
        .listClubMembers()
        .then((list) => list.find((m) => m.id === me.id)?.isOnline ?? false),
      stats.recordFor(me.id),
      stats.rivalriesFor(me.id),
      games.listForUser(me.id, RECENT_GAMES),
      ratings.strengthFor(me.id),
      ratings.recentPerformances(me.id, RECENT_GAMES),
    ]);

  const levels = new Map(
    performances.map((entry) => [entry.gameId, entry.performance.rating]),
  );

  return (
    <Shell user={me} stamp="Your card">
      <div className="grid max-w-5xl gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">
          <MemberHeader
            username={record.username}
            realName={canSeeRealName(me, record) ? record.realName : null}
            familyName={record.familyName}
            avatar={record.avatar}
            role={record.role}
            online={online}
            lastSeenAt={record.lastSeenAt}
          />

          <div className="mt-8">
            <SectionHeading label="Playing strength" />
            <StrengthPanel
              strength={strength}
              empty="No analysed games long enough to judge yet. A rating needs a few real games — short ones don't count."
            />
          </div>

          <div className="mt-8">
            <SectionHeading label="Record" />
            <RecordPanel
              record={results}
              empty="You haven't finished a game yet. Games start in the clubhouse."
            />
          </div>

          <div className="mt-8">
            <SectionHeading label="Recent games" count={`${recent.length}`} />
            <GameList
              games={recent}
              viewerId={me.id}
              empty="Nothing played yet."
              levels={levels}
            />
          </div>
        </div>

        <aside>
          <SectionHeading label="Rivalries" />
          <RivalryPanel
            rivalries={rivalries}
            mostPlayed={stats.mostPlayed(rivalries)}
            nemesis={stats.nemesis(rivalries)}
          />
          <p className="mt-3 text-xs text-ink-soft">
            Only you see this part of your card.
          </p>
        </aside>
      </div>
    </Shell>
  );
}
