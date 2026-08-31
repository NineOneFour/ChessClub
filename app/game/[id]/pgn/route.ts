import { getSessionUser } from "@/lib/auth/session";
import * as games from "@/lib/services/games";

/**
 * The game as a PGN file. Members only — this is a private club, and a game
 * record names two children.
 */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/game/[id]/pgn">,
) {
  if (!(await getSessionUser())) {
    return new Response("Sign in first.", { status: 401 });
  }

  const { id } = await params;
  const gameId = Number(id);
  if (!Number.isInteger(gameId)) {
    return new Response("Not found", { status: 404 });
  }

  const [pgn, summary] = await Promise.all([
    games.toPgn(gameId),
    games.get(gameId),
  ]);
  if (!pgn || !summary) return new Response("Not found", { status: 404 });

  const slug = `${summary.white.username}-vs-${summary.black.username}-${gameId}`;

  return new Response(pgn, {
    headers: {
      "content-type": "application/x-chess-pgn; charset=utf-8",
      "content-disposition": `attachment; filename="${slug}.pgn"`,
    },
  });
}
