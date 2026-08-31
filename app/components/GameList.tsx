import Link from "next/link";
import * as games from "@/lib/services/games";
import { Avatar } from "./Avatar";

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

/**
 * A list of games as score-sheet rows, newest first: who played, how long it
 * took, and how it ended. Shared by the games page and the member cards, which
 * want exactly the same thing.
 *
 * `viewerId` only decides whose win gets the brass highlight.
 */
export function GameList({
  games: list,
  viewerId,
  empty,
  levels,
}: {
  games: games.GameSummary[];
  viewerId: number;
  empty: string;
  /**
   * Optional: what the viewer's play in each game was worth, by game id. Only
   * your own card passes it — a per-game level is yours, not the club's.
   */
  levels?: Map<number, number | null>;
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
              <span className="truncate text-sm">{game.white.username}</span>
              <span className="font-mono text-xs text-ink-soft">v</span>
              <Avatar avatar={game.black.avatar} role={game.black.role} size="sm" />
              <span className="truncate text-sm">{game.black.username}</span>
            </span>

            <span className="whitespace-nowrap font-mono text-[0.65rem] text-ink-soft">
              {game.timeControl} · {Math.ceil(game.ply / 2)} moves
            </span>

            {levels && (
              <span className="w-16 whitespace-nowrap text-right font-mono text-[0.65rem] text-brass">
                {levels.get(game.id) ? `≈${levels.get(game.id)}` : ""}
              </span>
            )}

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
