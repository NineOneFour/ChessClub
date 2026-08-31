# Private Chess Club — design

Companion to `Private Chess Club - Project.md`, which states the *goals*. This
file records the *decisions*: what was chosen, and why, so that a later phase
doesn't quietly undo the reasoning.

Phase 1 (Clubhouse) is built. Phase 2 (Chess) is under way — the server-side
engine is done and verified; the board, the realtime game rooms and the game
pages are not. Phases 3-5 are untouched.

---

## 1. Scale

Eight children across five families. Roughly a dozen accounts, three or four
concurrent games at peak.

This number is load-bearing. It is the reason there is no chat pagination, no
presence fan-out, no roster caching, no read replicas, and no queue between the
web tier and the database. Any proposal that adds machinery for scale should be
checked against it first.

## 2. Stack

| Layer | Choice | Note |
|---|---|---|
| Web | Next.js 16 (App Router) + React 19 | Matches `../deckbuilder` |
| Language | TypeScript | |
| Styling | Tailwind 4 (CSS-first `@theme`) | |
| Database | PostgreSQL 18 | Never SQLite, not even for tests |
| ORM | Drizzle + `postgres-js` | Migrations via `drizzle-kit` |
| Realtime | Standalone Node + `ws` process | See §5 |
| Passwords | argon2 (`@node-rs/argon2`) | Prebuilt binary, no node-gyp |
| Chess rules | `chess.js` (BSD-2-Clause) | See §10 |

There is no schema-validation library and no auth library. The app has about a
dozen forms and one session type; hand-rolled validation in `lib/validation.ts`
and sessions in `lib/auth/` are smaller than the dependencies would be. This is
a scale judgement, not a principle — revisit it if the form count triples.

`AGENTS.md` (auto-generated, re-added by `next dev`) warns that Next.js 16 has
breaking changes. Read `node_modules/next/dist/docs/` before writing framework
code. Notable in use here:

- `params` in pages is a **Promise** and must be awaited. `PageProps<"/route">`
  and `LayoutProps<"/">` are generated types — run a build after adding a route
  or `tsc` will not know about it.
- `cookies()` is async.
- `middleware.ts` is deprecated in favour of `proxy.ts`. Neither is used here;
  see §4.
- Cache Components (`cacheComponents`) is **off**. Every authenticated page is
  `export const dynamic = "force-dynamic"` — the data is per-request and
  per-member, so there is nothing to cache.

## 3. Roles and the family

Three roles on one `users` table, discriminated by `role`:

- **admin** — runs the club. `family_id` is null; belongs to no family.
- **parent** — manages the children in their own family.
- **child** — the primary user.

All three play chess. See below.

A **family** is the unit of parental authority. A parent may act on any child
whose `family_id` matches their own, which makes two parents per household work
without a separate relationship table. There is no `parent_id` on a child.

**Everyone plays, grown-ups included.** Parents and the administrator are on
the club roster, have member cards, and will play games — but they are *tagged*
wherever they appear beside the kids, so a child always knows whether they're
talking to Ada or to Ada's dad.

The tag says "parent" for both the `parent` and `admin` roles. It is a social
label, not a permission: an administrator is somebody's parent too, and
labelling them "admin" in the clubhouse would advertise a capability rather
than answer the question a kid is actually asking. The one predicate is
`isGrownUp()` in `lib/roles.ts` — a leaf module with no database imports,
because Client Components use it and `lib/services/users.ts` would drag
Postgres and argon2 into the browser bundle.

The visual treatment is a **double ink border** on the avatar plus a small mono
`PARENT` chip next to the name. A border rather than a colour, because it still
reads at 32px and doesn't spend the palette's one red.

This means the author's `role` travels with every chat message, through
`chat.ChatMessage` and the `ServerChatMessage` frame, so the transcript can tag
a line without a second lookup.

**The administrator can belong to a family.** They start with none — running
the club and being a parent in it are different jobs — but the *My family*
control on the admin page joins an existing family, creates a new one, or
leaves. Once in one, `/parent` shows that family's children with the usual
parental switches, the member card shows the family name, and the roster
groups them with it.

This is the only path by which a family is created outside an invitation, and
the only way an account changes family. `users.setFamily()` validates that the
family exists and writes an audit entry; it is general, but the admin page is
the only caller.

**Children have no email address.** `users.email` is nullable and is forced to
null for the child role in `lib/services/users.ts`. Nothing in the app sends
mail; a parent's optional email exists only as a recovery note for a human.

## 4. Authentication and authorization

- **Sessions are database-backed**, not stateless JWTs. The browser holds a
  random 32-byte token; the `sessions` table holds only its SHA-256 hash. This
  is what makes "disable this account" and "reset this password" take effect
  immediately rather than at token expiry — the row is deleted and the member
  is out. A stateless token cannot be recalled.
- **`getSessionUser()` returns null for a disabled account** even while its
  session row still exists, so revoking access never depends on cleanup having
  run.
- **Authorization lives in `lib/auth/guards.ts`**, called by every page, layout
  and Server Action that touches member data. It is deliberately *not* in
  `proxy.ts`: proxy runs before rendering and may be hoisted to a CDN, so it
  cannot be trusted with a database lookup. Server Actions are reachable by
  direct POST, so a check that lives in the UI is not a check.
- Authorization failures answer **404, not 403**. `forbidden()` is still
  experimental in Next 16, and for a private club a 404 is the better answer
  anyway: it doesn't confirm to a curious child that an admin route exists.
- **Invitation-only, with no exceptions.** There is no route that creates an
  account from an anonymous request. The paths in are: the `seed:admin` script
  (administrator), accepting an invitation (parent), and a parent adding a
  child. Members never gain the ability to invite.
- Invitation tokens are stored hashed, like sessions, so the raw link exists
  exactly once — in the response to the admin who created it. The admin UI
  therefore shows it as a copy field, not a toast.
- Accepting an invitation **validates the form before claiming the link**, so a
  taken username doesn't burn a single-use invitation. The claim itself is a
  conditional `UPDATE ... WHERE accepted_at IS NULL`, so two people opening the
  same link cannot both succeed.

## 5. Realtime: a separate process

The WebSocket server (`realtime/server.ts`) runs as its own Node process, not
inside Next.js. Three reasons, in order of weight:

1. **Restarting the web tier must not drop a live connection.** In phase 2 that
   means not killing a game the kids are in the middle of because a page was
   redeployed.
2. **The Stockfish worker (phase 3) belongs next to the game server**, not in
   the web tier. The project brief is explicit that heavy analysis must not
   interfere with active games.
3. It is the reversible direction. Collapsing two processes into one later is
   easy; splitting them apart once games depend on the socket is not.

It is *not* for load — at three or four games either shape would cope.

**Authentication reuses the web session cookie.** The browser opens the socket
to the same origin, the reverse proxy forwards the upgrade with the `Cookie`
header, and the service resolves it through the same query the pages use
(`lib/auth/session-store.ts`, which is deliberately free of any Next.js
import). No second token, and nothing secret in a URL.

**The server re-reads the member on every message.** A parent switching chat
off, or an admin issuing a mute, therefore bites on the next message rather
than the next login.

**Presence lives in the `presence` table, written only by the realtime
service.** The web tier reads it for the first server render; the socket then
replaces the roster with its own authoritative list. A member counts as online
while `connections > 0` *and* the row was refreshed within
`PRESENCE_STALE_SECONDS` — the freshness half means a crashed realtime service
cannot leave the clubhouse looking busy forever. The service also zeroes every
row on startup, because counts from a dead process are lies.

**The client always takes the full list, never a diff.** With a dozen members
there is nothing to save, and it means a dropped-and-restored connection cannot
leave a stale roster on screen.

Chat is socket-only. There is no Server Action fallback for posting a message:
one path is easier to reason about than two, and if the socket is down then
chat is down, which is honest.

## 6. Chat and moderation

- One channel in phase 1 (`club`). `chat_messages.channel` is a plain string
  rather than an enum precisely so `game:<id>` can join it in phase 2 without a
  migration.
- Messages are **soft-deleted**. An admin removing a message hides it from the
  clubhouse but leaves it in parent and admin review — the point of review is
  that a parent can see what was said, not that it disappears.
- Two independent switches: `chat_enabled` (a parent, over their own child) and
  `is_muted` (an admin, over anyone). `chat.canSpeak()` is the single place
  both are evaluated, and it returns the reason so the UI can say which it is.
- Rate limiting is in-memory in the realtime service, since that is the only
  way a message can arrive. The numbers live in `chat.RATE_LIMIT`.
- Bodies are stripped of control characters and capped at 500 characters.
  Output is rendered as text by React, so HTML escaping is not a separate
  concern.

Per the brief, there is deliberately no reporting flow, no automated filtering
and no appeals process. Everyone here knows each other.

## 7. Audit

`audit_log` records account and invitation changes, written by the service
layer via `services/audit.ts` — never by UI code. `actor_id` is
`ON DELETE SET NULL` so the trail survives an account being removed, which is
the point of a trail.

## 8. Visual direction

**The club score sheet.** A small chess club runs on paper: a ruled sheet with
numbered moves down a narrow gutter, a rubber stamp on the front, results
pinned to a board.

Every list in the app — the transcript, the roster, the review logs — is set as
ruled numbered rows. The numbering is earned rather than decorative: chess
genuinely is a numbered sequence, and the score sheet is where a club records
one.

- **Palette** (`app/globals.css` `@theme`): grey-lilac newsprint `#e8e9ee`,
  raised sheets `#f8f8fa`, ink navy `#191c34`, carbon-violet rules `#c6c9dc`,
  and one red `#c8202a` taken from the flag on a mechanical chess clock. Plus
  `--color-live` green for presence and `--color-brass` for your own name.
- **Type**: Bricolage Grotesque (display — wonky and warm, for kids without
  being childish), Instrument Sans (body), DM Mono (labels, timestamps, gutter
  numbers, and eventually notation).
- **The signature** is the rubber stamp: rotated, ragged, one per page, and the
  only place the red appears besides error text. Destructive buttons are
  deliberately *quiet* — seven red "Disable" buttons in a row read as an
  emergency rather than a roster.
- Light theme only. Board and piece themes are phase 5; a dark mode competing
  with a board theme is a decision better made once the board exists.
- Avatars are **twelve presets**, not uploads: no image storage, no resizing,
  no moderation question, and faster for a child than finding a file. A
  grown-up's avatar carries a double ink border — see §3.

## 9. Layout

```
app/
  layout.tsx                    root: fonts, ruled-paper background
  globals.css                   design tokens + component classes
  actions.ts                    signOut
  page.tsx                      the clubhouse
  login/                        page, form, signIn action
  join/[token]/                 invitation acceptance
  me/                           own card: name, avatar, password
  profile/[username]/           a child's member card
  parent/                       children, controls, what they've said
  admin/                        everyone, invitations, chat review, audit
  components/
    Shell.tsx                   masthead, stamp, role-aware nav
    Clubhouse.tsx               transcript + roster (client)
    useClubSocket.ts            the browser half of the socket
    Avatar.tsx  Form.tsx  SectionHeading.tsx
lib/
  config.ts                     everything read from the environment
  validation.ts                 hand-rolled validators + ValidationError
  action-state.ts               FormState + withFormErrors
  avatars.ts                    the twelve presets
  chess/
    rules.ts                    chess.js wrapper — the only rules knowledge
    clock.ts                    pure clock arithmetic, nothing ticks
    time-controls.ts            the five options on the menu
  db/
    index.ts                    postgres-js client + drizzle wrapper
    schema/{users,chat,games,index}.ts
  auth/
    password.ts                 argon2 + the length rules
    tokens.ts                   random tokens, SHA-256 hashing
    session-store.ts            session DB ops — no Next.js import
    session.ts                  the cookie layer ("server-only")
    guards.ts                   requireUser/requireAdmin/requireParent
  services/
    users.ts invitations.ts chat.ts presence.ts audit.ts
    games.ts                    transactional game state, history, PGN
    challenges.ts               challenge lifecycle, colour assignment
    offers.ts                   open offers: put a board out, take it up
realtime/
  server.ts                     the WebSocket service
  protocol.ts                    frame types, shared with the browser
scripts/
  seed-admin.ts                 the only way the first account exists
  smoke-club.ts                 service layer, end to end
  smoke-realtime.ts             the socket, end to end
  smoke-chess.ts                rules, clocks, challenges, games
  dev-fixture.ts                a plausible club, for looking at the app
drizzle/                        generated migrations
```

Rules of thumb: pages render, actions validate and call services, services own
the database. A page never writes SQL; a service never imports from `app/`.

## 10. Chess

### Why not chessops and chessground

The brief suggested both. Both are **GPL-3.0-or-later**, and chessground's own
README asserts that serving it to browsers makes the combined work GPL and
obliges you to release source to the site's users. That is a decision about
this codebase rather than a technical detail, so it was put to the owner, who
chose the permissive route:

- **`chess.js` (BSD-2-Clause)** for the rules, server-side only. It also brings
  threefold repetition, the fifty-move rule, insufficient material and PGN
  output, all of which the brief needs.
- **A hand-written board**, in the score-sheet design language rather than
  fighting chessground's opinionated CSS.
- **No chess library in the browser at all.** The server sends the position
  *and the legal moves* with every update, so the client cannot compute a move
  even in principle. That is the brief's "the client must never be trusted to
  determine legal moves" taken to its conclusion, and it means the board is a
  dumb renderer.

Legal moves are not secret — anyone can work them out — so they go to
spectators too. It is Stockfish's evaluation that must stay hidden during a
live game (phase 3).

### The database is the authority

Every state change is one transaction that locks the game row with
`SELECT … FOR UPDATE`, re-derives the position from the stored move list, and
writes the outcome. Consequences worth keeping:

- Two clients racing a move cannot both land one. The smoke suite fires two
  different first moves concurrently and asserts exactly one survives.
- A crash of the realtime service loses nothing. It is transport and a clock
  watchdog, never the source of truth.
- A reconnecting player reads the same rows as everyone else, so "reconnection"
  needs no special path — it is just a fresh read.

`positionAfter()` **replays the move list** rather than loading the stored FEN.
It costs microseconds at eighty moves, and it is the only way threefold
repetition and the fifty-move count can be right: chess.js can only see
repetition it has witnessed, so a bare FEN would silently lose it. The stored
`fen` column is for display and for jumping around a finished game.

### Clocks

Nothing ticks anywhere. A game stores each side's remaining time *as it stood*
at `clock_started_at`, and the player to move is spending wall-clock time since
then. Every reader derives the live figure (`lib/chess/clock.ts`), so there is
no ticking value to drift and a spectator joining mid-game sees exactly what
the players see.

Decisions inside that:

- **A move attempted after your own flag has fallen loses**; the move does not
  land. The order of checks in `playMove` is deliberate.
- **Flagging against a lone king, knight or bishop is a draw**, not a win. A
  kid should not be told they won a game they could never have won. King and
  two knights counts as sufficient, matching the usual online convention.
- **Increment is credited even on the move that reaches zero**, like a physical
  clock with delay.
- **Untimed is a first-class option**, stored as `initial_ms = 0`, and it is
  first on the menu. A clock is the thing most likely to put a seven-year-old
  off playing at all.

### Rules choices a club has to make

- **Threefold repetition and the fifty-move rule end the game automatically.**
  In tournament chess they are *claims*. Nobody wants to explain to a
  nine-year-old how to claim a draw.
- **A promotion with no piece named is refused**, never assumed to be a queen,
  so the player always chooses. The position payload carries a `promotions` map
  so the board knows when to ask — again, without the browser knowing a rule.
- **Any move refuses an outstanding draw offer**, the way pressing the clock
  does over the board.
- **One game at a time per member.** A challenge to someone already playing is
  refused, which keeps the clubhouse honest about who is available.

### Challenges

No matchmaking and no rating-based pairing: you challenge somebody you can see
in the clubhouse and they say yes or no. A partial unique index
(`challenges_open_pair_key`, `where status = 'open'`) means a kid mashing the
button cannot build a queue. Accepting claims the challenge with a conditional
`UPDATE`, so two taps cannot produce two games, and accepting expires every
other open challenge involving either player.

`random` colour is resolved in exactly one place: `challenges.accept()`.

### Play again

A finished game offers **Play again** to both players: same time control,
colours swapped, as over the board.

It is an ordinary challenge, not a new mechanism — which buys three things.
The first tap offers and the second accepts, so it is symmetrical and neither
player has to work out whose turn it is to ask. Nothing new has to be stored:
the offer is a row in `challenges`, so it survives a reload, and if a player
wanders back to the clubhouse it is waiting for them there. And the socket
already sends a member their challenge list on every change, so the offer
reaches the other player *on the finished-game page they are still sitting on*
— the game room listens for `challenges` and `gameStarted` for exactly this.

### Open offers

A challenge names an opponent. An **offer** doesn't: **Start a game** puts a
board out with a time control and a colour, and the first member to tap **Play**
gets the game. It exists because the person a kid wants to play is usually
"whoever is here", and making them guess who is free is worse than putting a
board out and waiting.

Same protections as a challenge, plus one more:

- One open offer per member (`game_offers_open_from_key`, `where status =
  'open'`), so the button cannot build a queue.
- Accepting claims the row with a conditional `UPDATE` that also excludes the
  offerer, so two members tapping at the same moment produce exactly one game
  and the loser is told the board has gone.
- Starting a game any way at all takes both players' boards in — accepting an
  offer and accepting a challenge each expire the other's open offers.
- **An offer is withdrawn when its owner's last socket closes**, and every open
  offer is expired when the realtime service starts. A board left out by
  somebody who has gone home would otherwise start a game against an empty
  chair. This is the one place an offer differs from a challenge, which
  survives a disconnection because it is addressed to a person who can answer
  later.

The offer list is public to the club, so it is the one thing the socket
broadcasts to everybody rather than sending to one member.

## 11. Self-hosting

Lives on a Proxmox server at **chess.vsakis.com**. TLS and the domain are
handled upstream, so the app is served over plain HTTP behind a reverse proxy
and must be told what its public origin is.

The proxy needs to do two things:

1. Forward `/` to the Next.js app (default port 3000).
2. Forward `/ws` to the realtime service (default port 3001) **with the upgrade
   headers intact**. `/healthz` on the same service answers a health check.

`PUBLIC_ORIGIN` drives both the invitation links and whether session cookies
are marked `Secure`; set it to `https://chess.vsakis.com` in production even
though the app itself speaks http.

`NEXT_PUBLIC_REALTIME_URL` should be **empty** in production — the browser then
derives `wss://<current-host>/ws`. Set it explicitly (`ws://localhost:3001`)
only in local development, where there is no proxy.

Containerisation is deferred until deployment. Postgres runs locally for now.

## 12. What is deliberately not there yet

Not oversights — scope:

- No board, no game pages, no spectating and no game chat yet — the phase 2
  engine exists and is tested, but nothing in the UI reaches it. The member
  card and the clubhouse still say there is nothing to play, which remains
  true.
- No rematch. The schema has no `rematch_of`; add it with the button.
- No abandoned-game resolution. `games.listStale()` finds them; nothing acts on
  them, because a kid called to dinner should be able to come back.
- No Play/Watch actions in the clubhouse, for the same reason.
- No direct messages (the brief excludes them from the MVP).
- No playing-hours schedule. The brief lists it under parental controls;
  suspending an account covers the urgent case, and a schedule wants a
  timezone conversation.
- No chat pagination — the clubhouse loads the last 100 messages.
- No email delivery of any kind. Invitations are links the admin copies.
- No `docker-compose`.
- No test suite. The two smoke scripts run against the real database and are
  the current safety net.

## 13. Names, and what is private

Every member has two names. The **username** is the login handle and the
public identity: it is what the roster, chat, the game rooms, member cards,
challenges and the PGN all show. The **real name** is a private field.

A real name is visible to exactly two audiences: the member themselves, and
grown-ups in the same family. The predicate is `canSeeRealName()` in
`lib/roles.ts`, kept in that leaf module for the same reason `isGrownUp()` is —
a Client Component importing `lib/services/users.ts` would drag Postgres and
argon2 into the browser bundle.

**The administrator is not an exception**, which is the part that looks wrong
until you know what it is protecting. Running the club means knowing which
*family* is using it and being able to reset a parent's password, suspend a
family or remove one. It does not mean managing other people's children, so
there is no reason for the club secretary to learn what they are called. The
administrator sees their own family's real names like any other parent, by
being in it — not by being the administrator.

Two consequences worth keeping:

- **The wire protocol carries no real names at all.** `realtime/protocol.ts`
  identifies members by username in every frame — presence, chat, players,
  challenges, game cards. A socket that cannot send a real name cannot leak
  one, which is cheaper to hold than a per-frame check.
- **Passing a whole `Member` to a Client Component leaks it**, even when the
  component never renders the field: React serialises the entire prop into the
  RSC payload, where anyone can read it in view-source. This is not something
  the typechecker will catch — the narrow prop type accepts the wide object
  quite happily. `app/admin/page.tsx` had exactly this bug. Pass the fields,
  not the record.
