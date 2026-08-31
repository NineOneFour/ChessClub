@AGENTS.md

# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Read these first

- `Private Chess Club - Project.md` — the brief. What we're building and why.
  It is the authority on scope and on phase order.
- `design.md` — the decisions and their reasons. Read the relevant section
  before changing anything it covers; several choices look arbitrary until you
  know what they're protecting against.

## Status

**Phase 1 (Clubhouse) is complete.** Authentication, three roles, families,
invitations, profiles, presence and club chat all work end to end, verified by
`npm run smoke:club` and `npm run smoke:realtime`.

**Phase 2 (Chess) is complete.** Rules, clocks, challenges, open
offers, rematches, moves, draws, resignation, flag falls, completion, history
and PGN are verified by `npm run smoke:chess`; the board, the game rooms,
spectating, reconnection and game chat by `npm run smoke:play`.

Reviewing a finished game walks the score sheet: tap a move, use the four
controls, or the arrow keys. It shows `game_moves.fen_after` and holds no
chess logic — see the trap about `lib/chess/position.ts` below.

Parental controls are in: chat, game chat, playing hours, a lock on choosing
your own name, and account suspension — see `design.md` §15. A parent reviews
their children's games and chat on the family page.

Boards and pieces are choosable per member (`design.md` §16).

**Phase 3 (Analysis) is complete.** The queue, the Stockfish worker, per-move
analysis with blunder grading, per-game performance estimates, the
playing-strength estimator and rating history are all in and verified by
`npm run smoke:analysis`. Strength shows on the cards; a per-game level shows in
the game room to the players once the game is analysed.

Not built, and deliberately: the skill breakdown by opening/tactics/middlegame/
endgame. The brief lists it as an eventual extension rather than a phase 3 item.
Phase 4 (the LLM coach) has not started.

**The worker needs a Stockfish binary.** It is *not* in the Arch/Manjaro repos
— AUR (`yay -S stockfish`) or build from source; see the README. On this machine
it is built and installed at `~/.local/bin/stockfish` (Stockfish
dev-20260829-8bc5caa2, `x86-64-avx512`, PGO), which is on the PATH, so
`STOCKFISH_PATH` is unset and unnecessary. Without an engine the club works
exactly as before and the queue grows; `smoke:analysis` skips its engine
section and says so.

## Scale, and why it matters

Eight children across five families; three or four concurrent games at peak.

This is the single most useful fact about the codebase. It is the reason there
is no pagination, no caching layer, no presence fan-out, no message queue, and
no dependency that exists to handle volume. Check any "we should also…" against
it before building.

## Stack

Next.js 16 (App Router) + React 19 + Tailwind 4 + TypeScript, Postgres 18 via
Drizzle, and a standalone `ws` process for realtime. Matches `../deckbuilder`
deliberately.

**Chess rules are `chess.js` (BSD-2-Clause), server-side only.** chessops and
chessground were rejected because both are GPL-3.0-or-later — see `design.md`
§10. Do not reintroduce them, and keep the browser free of any chess library:
the server sends the position *and* the legal moves.

**Postgres only.** Do not suggest SQLite for anything, including tests.

**Next.js 16 is not the Next.js you remember** — see `AGENTS.md` and read
`node_modules/next/dist/docs/` before writing framework code. In particular:
`params` is a Promise, `cookies()` is async, `middleware.ts` is now `proxy.ts`
(unused here), and `PageProps<"/route">`/`LayoutProps<"/">` are generated —
**run a build after adding a route** or `tsc --noEmit` will fail on the new
route's types.

Cache Components is off, and every authenticated page is `force-dynamic`. Don't
enable `cacheComponents` without a reason; per-member request-scoped data has
nothing to gain.

## Architecture in one paragraph

Pages render and read. Server Actions validate input and call services.
Services in `lib/services/` own the database. Authorization is in
`lib/auth/guards.ts` and is called by every page and every action — never
inferred from the UI, because Server Actions are reachable by direct POST. The
realtime service in `realtime/` is a separate process that shares the session
lookup (`lib/auth/session-store.ts`, kept free of Next.js imports so it can)
and owns the `presence` table.

A page never writes SQL. A service never imports from `app/`.

## Things that will bite you

- **`lib/auth/session.ts` is `server-only`** (it uses `next/headers`). Anything
  the realtime service needs must live in `lib/auth/session-store.ts` instead.
- **Sessions are DB rows, not tokens.** Disabling an account or changing a
  password deletes them, which is the mechanism that makes those controls
  immediate. Don't replace this with a JWT.
- **Invitation tokens are stored hashed.** The raw link exists exactly once, in
  the response to the admin who created it. There is nowhere to look it up
  again, and that's deliberate.
- **The realtime service re-reads the member on every chat message**, so a mute
  or a parental chat switch takes effect immediately. Keep that property.
- **Presence needs both halves of its check** — `connections > 0` *and* a fresh
  `updated_at`. Dropping the freshness half means a crashed socket service
  leaves ghosts online.
- **`ValidationError` is the only exception the UI turns into a message.**
  Throw it (via `fail()`) for anything a member can fix; let everything else
  reach the error boundary rather than flattening it to "something went wrong".
- **`/me`, `/card` and `/profile/[username]` are three pages on purpose.**
  Settings, your own stats, and what the club sees. See `design.md` §13 before
  moving anything between them: rivalries are private, and the public card
  shows no real name to anybody.
- **`canSpeak(member, channel)` takes a channel now.** Club chat and game-room
  chat are separate switches (`chat_enabled`, `game_chat_enabled`), and the
  channel decides which apply. Calling it without a channel answers for the
  clubhouse. See `design.md` §15.
- **Playing hours gate *starting* a game and nothing else.** A game already
  running is never interrupted — no resignation, no flag, no ejection.
  `users.assertCanStartGame()` is called from exactly four places
  (`challenges.create`, `challenges.accept`, `offers.create`, `offers.accept`)
  and both players are checked. The maths is in `lib/play-window.ts`, which is
  pure so the UI and the services agree; a window whose end precedes its start
  spans midnight.
- **A parent can lock a child's name and avatar (`can_customize`) but never
  their board.** `updateProfile()` refuses when it is off;
  `setBoardPreferences()` does not care, because nobody else sees the board.
- **Board and piece styles are the viewer's own, and arrive as CSS custom
  properties.** `lib/board-styles.ts` is a pure leaf (both `Board.tsx` and the
  settings previews import it). Tailwind cannot generate a class for a runtime
  colour, so the squares read `var(--sq-dark)` and the glyphs read the piece
  properties — don't try to make these Tailwind classes. Unknown keys fall back
  to the default rather than blanking the board.
- **A username is not a stable identifier.** Members rename themselves in
  `/me`, so never cache one, key anything on one, or store one as a reference
  — `users.id` is the identity. A rename is audited as `user.rename`.
- **The real name is not self-editable.** `updateProfile()` takes a username
  and an avatar and nothing else. A child renaming themselves on the family
  page would take away the parent's way of telling their children apart.
- **Grown-ups play too, and are tagged.** Parents and the administrator are on
  the roster and in chat with a `PARENT` chip and a double-bordered avatar. The
  predicate is `isGrownUp()` in `lib/roles.ts` — keep it in that leaf module,
  not in `lib/services/users.ts`, or a Client Component importing it pulls
  Postgres and argon2 into the browser bundle. The author's `role` rides along
  on every chat message and presence frame for this reason.
- **The administrator may belong to a family** (*My family* on the admin page),
  which is what makes one account both club secretary and parent. It is also
  the only way a family is created without an invitation.
- **A rematch is a challenge, not a new mechanism.** **Play again** creates an
  ordinary row in `challenges` with the colours swapped, so the first tap
  offers and the second accepts, and the offer also shows in the clubhouse.
  This is why `useGameSocket` handles `challenges` and `gameStarted` frames.
- **An open offer is withdrawn when its owner disconnects**, and every offer is
  expired on realtime startup — a board left out by somebody who has gone home
  would start a game against an empty chair. See `design.md` §10. This is why
  `offers.expireFor()` is called from `unregister()`.
- **A finished game is a queued game.** `analysis.enqueueIn(tx, gameId)` runs
  inside the same transaction that finishes a game, in both completion paths.
  Don't add a sweeper; don't move it outside the transaction.
- **Nothing ever waits for Stockfish.** The worker is a third process
  (`analysis/`), it polls, and the club is unaffected when it is off. See
  `design.md` §17 before coupling anything to it.
- **Analysis scores are from the mover's point of view, and clamped to ±10
  pawns.** An engine scores the side to move, so a score after a move must be
  flipped — `analyseMove()` does it so no call site has to. The clamp is what
  keeps one bad move in a lost position from swamping a child's average. Both
  conventions are in `lib/chess/evaluation.ts`, which is pure.
- **`analysis.forGame()` returns null for an unfinished game.** That is the
  mechanism that keeps the engine's view hidden during a live game, not an
  optimisation — don't add a path that reads the rows directly.
- **No analysis figure is stored pre-aggregated.** One row per half-move, and
  averages derived on read, so ratings can be recalculated when the algorithm
  changes. The engine and depth are stored per game because the numbers are only
  comparable within one yardstick.
- **No rating is stored anywhere.** There is no ratings table and no rating
  column: a rating is a query over `game_move_analysis`, so changing a constant
  in `lib/chess/rating.ts` re-rates everybody and redraws every historical
  rating. Don't add a cache — see `design.md` §18.
- **The rating never looks at who won.** Not opponent Elo, on purpose: beating
  the same friend repeatedly must not move it. Four signals over the moves, and
  every one of them should be sanity-checked against "what does this say about
  someone playing at random?" — random legal moves must rate at the floor. A
  signal that counted only mistakes and inaccuracies once rated random play 548.
- **The database is the authority on every game.** Moves go through one locked
  transaction that replays the move list; the realtime service is transport and
  a clock watchdog, never the source of truth. Don't cache game state in the
  socket process.
- **The starting position lives in `lib/chess/position.ts`, not `rules.ts`.**
  The board needs it — stepping back before white's first move has no stored
  FEN to show — and `rules.ts` imports chess.js, so a Client Component
  importing it would pull a chess engine into the browser bundle. Same leaf
  discipline as `isGrownUp()`.
- **The review stepper computes nothing.** Each half-move's position comes from
  `game_moves.fen_after`, and the check highlight is read off the `+`/`#` in
  the stored notation rather than worked out. Keep it that way.
- **`positionAfter()` replays moves rather than loading the stored FEN.** That
  is what makes threefold repetition and the fifty-move count correct — a bare
  FEN silently loses them. The `fen` column is for display only.
- **Nothing about a clock ticks.** Remaining time is derived from
  `clock_started_at`; see `lib/chess/clock.ts`. Don't add a stored countdown.
- Red belongs to the stamp and to error text. Destructive buttons are quiet on
  purpose — see `design.md` §8.

## Commands

```bash
npm run dev              # web tier only (port 3000)
npm run dev:realtime     # socket service only, with reload
npm run dev:all          # all three tiers, labelled
npm run build            # production build (also regenerates route types)
npm run start            # serve the build
npm run realtime         # socket service, no reload
npm run analysis         # Stockfish worker (needs a stockfish binary)
npm run dev:analysis     # the worker, with reload
npm run analysis:queue   # queue every finished game that has no analysis
npm run typecheck        # tsc --noEmit
npm run lint

npm run db:generate      # migration from the schema diff
npm run db:migrate       # apply pending migrations
npm run db:push          # push schema without a migration file (dev only)
npm run db:studio        # drizzle-studio

npm run seed:admin       # create/reset the administrator (env-driven)
npm run smoke:club       # service layer, end to end, against the real DB
npm run smoke:realtime   # the socket, end to end (needs the service running)
npm run smoke:chess      # rules, clocks, challenges, offers, games, PGN
npm run smoke:play       # a whole game over the socket, with a spectator
npm run smoke:analysis   # evaluation maths, the queue, and the engine
npx tsx scripts/dev-fixture.ts   # two families, four kids, a conversation
```

Fresh clone:

1. `cp .env.example .env` and fill it in
2. `createdb chessclub`
3. `npm install`
4. `npm run db:migrate`
5. `ADMIN_USERNAME=… ADMIN_PASSWORD=… npm run seed:admin`
6. `npm run dev:all`

Then sign in as the administrator and create an invitation; there is no other
way to make an account, by design.

## This machine

- Local Postgres 18 (systemd `postgresql`), `terry` is a SUPERUSER, peer auth
  over the Unix socket works. DB name `chessclub`, `.env` uses
  `postgres://terry@localhost/chessclub`.
- After a glibc upgrade Postgres warns about collation versions. Fix with
  `psql -d <db> -c "ALTER DATABASE <db> REFRESH COLLATION VERSION;"` for
  `template1`, `postgres` and `chessclub`.
- `npm audit` reports a moderate advisory in `esbuild` via `drizzle-kit`. It is
  a dev-only transitive dependency; `audit fix --force` would downgrade
  `drizzle-kit` by thirteen minor versions. Leave it.
- Port 3000 is often taken by another project's dev server. **Do not kill
  processes you did not start** — run this app on another port instead
  (`npx next dev -p 3100`).

## Deployment

Proxmox, at **chess.vsakis.com**, with TLS and the domain handled upstream. The
reverse proxy must forward `/` to the app and `/ws` to the realtime service
with upgrade headers intact. Set `PUBLIC_ORIGIN=https://chess.vsakis.com` and
leave `NEXT_PUBLIC_REALTIME_URL` empty in production. See `design.md` §10.
