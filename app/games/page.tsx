import { requireUser } from "@/lib/auth/guards";
import * as games from "@/lib/services/games";
import { GameList } from "@/app/components/GameList";
import { SectionHeading } from "@/app/components/SectionHeading";
import { Shell } from "@/app/components/Shell";

export const dynamic = "force-dynamic";

export const metadata = { title: "Games" };

/**
 * The club's games: yours first, then everybody's. Deliberately one flat list
 * per section rather than a filterable table — at a dozen members there is
 * nothing to filter.
 */
export default async function GamesPage() {
  const me = await requireUser();

  const [mine, active, finished] = await Promise.all([
    games.listForUser(me.id, 30),
    games.listActive(),
    games.listFinished(50),
  ]);

  const otherActive = active.filter(
    (game) => game.white.id !== me.id && game.black.id !== me.id,
  );

  return (
    <Shell user={me} stamp={`${finished.length} played`}>
      <div className="grid gap-10 lg:grid-cols-2">
        <section>
          <SectionHeading label="My games" count={`${mine.length}`} />
          <GameList games={mine} viewerId={me.id} empty="You haven't played yet." />
        </section>

        <section className="space-y-10">
          <div>
            <SectionHeading
              label="Being played now"
              count={`${otherActive.length}`}
            />
            <GameList
              games={otherActive}
              viewerId={me.id}
              empty="Nobody else is playing right now."
            />
          </div>

          <div>
            <SectionHeading label="The club's games" count={`${finished.length}`} />
            <GameList
              games={finished}
              viewerId={me.id}
              empty="No finished games yet."
            />
          </div>
        </section>
      </div>
    </Shell>
  );
}
