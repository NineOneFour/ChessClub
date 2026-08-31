import Link from "next/link";
import { requireUser } from "@/lib/auth/guards";
import * as games from "@/lib/services/games";
import { Avatar } from "@/app/components/Avatar";
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

const REASON_SHORT: Record<string, string> = {
  checkmate: "mate",
  resignation: "resigned",
  stalemate: "stalemate",
  insufficient_material: "no mate possible",
  fifty_move: "fifty-move",
  threefold: "repetition",
  flag: "on time",
  agreement: "agreed",
};

function GameList({
  games: list,
  viewerId,
  empty,
}: {
  games: games.GameSummary[];
  viewerId: number;
  empty: string;
}) {
  if (list.length === 0) {
    return <p className="text-sm text-ink-soft">{empty}</p>;
  }

  return (
    <div className="sheet ruled">
      {list.map((game) => {
        const iWon = game.winnerId === viewerId;
        const iPlayed = game.white.id === viewerId || game.black.id === viewerId;
        const drawn = game.status === "finished" && game.winnerId === null;

        return (
          <Link
            key={game.id}
            href={`/game/${game.id}`}
            className="flex items-center gap-3 px-3 py-2 hover:bg-white"
          >
            <span className="gutter">{game.id}</span>

            <span className="flex min-w-0 flex-1 items-center gap-2">
              <Avatar avatar={game.white.avatar} role={game.white.role} size="sm" />
              <span className="truncate text-sm">{game.white.displayName}</span>
              <span className="font-mono text-xs text-ink-soft">v</span>
              <Avatar avatar={game.black.avatar} role={game.black.role} size="sm" />
              <span className="truncate text-sm">{game.black.displayName}</span>
            </span>

            <span className="whitespace-nowrap font-mono text-[0.65rem] text-ink-soft">
              {game.timeControl} · {Math.ceil(game.ply / 2)} moves
            </span>

            <span
              className={`w-28 whitespace-nowrap text-right font-mono text-[0.65rem] ${
                game.status === "active"
                  ? "text-live"
                  : iPlayed && iWon
                    ? "text-brass"
                    : "text-ink-soft"
              }`}
            >
              {game.status === "active"
                ? "in progress"
                : drawn
                  ? `draw · ${REASON_SHORT[game.resultReason ?? ""] ?? ""}`
                  : `${game.result} · ${REASON_SHORT[game.resultReason ?? ""] ?? ""}`}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
