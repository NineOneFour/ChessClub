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
    stats.ts                    records and rivalries, derived on read
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

### Reviewing a finished game

The game room is the review screen — there is no separate one. A finished game
just stops accepting moves, and the score sheet becomes the way back through
it: tap a move, use the four controls under the sheet, or the arrow keys, which
is what anybody who has used a chess site will try first.

Stepping shows `game_moves.fen_after`, the FEN stored beside each half-move. So
the browser still holds no chess logic, which is the §10 rule and not
negotiable: even the check highlight is read off the `+` or `#` in the stored
notation rather than worked out. The starting position is the one FEN with no
row to come from, so it lives in `lib/chess/position.ts` — a leaf module,
because `rules.ts` imports chess.js and a Client Component importing *that*
would put an engine in the bundle.

Stepping is offered only once the game is over. A board that wandered off while
your opponent was thinking would be a way to miss a move.

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

- No abandoned-game resolution. `games.listStale()` finds them; nothing acts on
  them, because a kid called to dinner should be able to come back.
- No direct messages (the brief excludes them from the MVP).
- No chat pagination — the clubhouse loads the last 100 messages.
- No skill breakdown by opening/tactics/middlegame/endgame. The brief lists it
  as an eventual extension; it wants a phase-of-game boundary the stored
  analysis does not mark. See §18.
- No coach. Phase 4.
- No email delivery of any kind. Invitations are links the admin copies.
- No `docker-compose`.
- No test suite. The two smoke scripts run against the real database and are
  the current safety net.

## 13. Three pages about one member

A member is served by three pages, and the split is about audience rather than
convenience:

- **`/me` — settings.** Only the things a member changes about themselves:
  avatar, the name the club sees, password. It shows no statistics, because a
  page you visit to change something should not also be the page you visit to
  read something.
- **`/card` — your card.** How you are actually playing: your record, your
  recent games, your rivalries, and in time the coach. Private. This page
  changes nothing.
- **`/profile/[username]` — what the club sees.** Username, family, presence,
  record and recent games. No personal details, and no rivalries.

The record and the game list are the same components on the card and the public
profile (`RecordPanel`, `GameList`). If your own card and everyone else's view
of it disagreed about your record, one of them would be wrong.

**Getting to them.** The main navigation is where the *club* goes — clubhouse,
games, and the family and admin pages for those who have them. The two pages
about you are behind your own name in the header (`UserMenu`), which is where
anybody would look. Sign out stays outside the menu: a child who wants to stop
playing should not have to find it inside something.

**A username in chat is a link to that member's profile**, in the club chat and
in a game room. It is the shortest path from "who is this?" to the answer, and
it costs nothing: `chat.ts` joins `users.username` live, so a message always
carries the author's current name and the link stays good after a rename.

**Rivalries are private on purpose.** "Who keeps beating me" is a useful thing
to know about yourself and an unkind thing for eight children to know about each
other. `nemesis()` needs a losing record over at least `NEMESIS_MIN_GAMES`
games, so one bad afternoon does not name somebody.

## 14. Names, and what is private

Every member has two names. The **username** is the login handle and the
public identity: it is what the roster, chat, the game rooms, member cards,
challenges and the PGN all show. The **real name** is a private field.

**The username is the member's own to choose**, and they change it in `/me`. A
child who would rather be @chesspotato than @manoli may be @chesspotato, and
picking the name is most of the point of having one. Renaming is the only
self-service change that alters how somebody appears to everybody else, so
`updateProfile()` audits it as `user.rename` with the old name in the detail —
a parent can find out who @chesspotato used to be.

**The real name is not theirs to change.** It is how a parent knows which child
they are looking at on the family page; a child renaming themselves there would
take that away. It is set when the account is created and changed by a grown-up.

A real name is visible to exactly two audiences: the member themselves, and
grown-ups in the same family. The predicate is `canSeeRealName()` in
`lib/roles.ts`, kept in that leaf module for the same reason `isGrownUp()` is —
a Client Component importing `lib/services/users.ts` would drag Postgres and
argon2 into the browser bundle.

**The public member card shows no real name at all**, not even to the family
who may see it. A page that shows a private field to some viewers and not
others is a page that will eventually show it to the wrong one, and the family
page and the admin roster already exist for looking a child up by name.

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

## 15. Parental controls

The brief asks for controls that are "useful without turning the application
into enterprise identity management wearing a chess hat", so each one is a
column on `users` and a button on the family page. There is no policy engine,
no inheritance, and no per-child settings tree.

A parent has five switches over each of their own children, and the
administrator has the two account-level ones over everybody:

| Control | Column | What it stops |
| --- | --- | --- |
| Chat | `chat_enabled` | All chat, clubhouse and game rooms |
| Game chat | `game_chat_enabled` | Talking in game rooms only |
| Name and avatar | `can_customize` | Choosing their own username or avatar |
| Playing hours | `play_from_minute`, `play_to_minute` | *Starting* a game out of hours |
| Account | `is_active` | Signing in at all (also kills sessions) |

`chat.canSpeak(member, channel)` is the whole chat rule and both tiers run it.
The order it tests in is the order of authority: an admin mute silences a member
everywhere, chat-off is the master switch, and game-chat-off is the narrower one
that leaves the clubhouse alone. A parent happy with the clubhouse but not with
a running commentary during a game wants the third and not the second.

### Playing hours

Two integers, minutes from local midnight, both null for no window — which is
how every account starts. `lib/play-window.ts` is the only place that reads
them, and it is pure, so the settings UI renders the same window the services
enforce.

Three decisions that are the point of the feature:

- **A window that ends before it starts spans midnight.** 20:00 to 07:00 is one
  row, and "no chess after bedtime" is the obvious thing a parent will write.
- **It gates starting a game, never a game in progress.** Closing time arriving
  mid-game does not resign, flag or eject anybody. A child losing a game they
  were winning because the clock struck eight is a worse outcome than a late
  finish, and the brief's first principle is fun. `assertCanStartGame()` is
  called from `challenges.create`, `challenges.accept`, `offers.create` and
  `offers.accept` — the four ways a game begins — and nowhere else.
- **Both players are checked, and named.** A child whose evening is over should
  not be pulled into a game by a friend whose isn't, and the friend is told
  whose hours are the problem rather than left tapping a dead button.

Server local time, deliberately. A timezone column is a setting nobody would
ever set correctly; if the club ever spans timezones, this is the thing to
revisit.

### What a parent may not switch off

The board and the pieces. `can_customize` is about what the *club* is shown —
the name and the face beside it — and nobody but the member ever sees which
squares they like. A settings page that can be emptied entirely is a settings
page a child has no reason to visit.

## 16. Boards and pieces

Five boards and four piece sets, presets like the avatars and for the same
reasons: a short menu produces a board that looks deliberate, and there is
nothing to upload, validate, license or host.

Everything is Unicode and CSS. The two Unicode chess families are the whole
range available — the solid glyphs (♚) and the hollow ones (♔) — so a piece set
is a choice of family per colour plus fill, outline and outline width. That is
fewer sets than a site shipping sprite sheets, and every one of them is legible
at the size a phone draws it. The default uses the solid family for both
colours, filling white white, because the hollow glyphs' thin strokes disappear
small; Newsprint uses the hollow family for white on purpose, because it is the
newspaper diagram and looks like one.

The colours arrive as **custom properties set on the board element**, not as
classes: Tailwind cannot generate a class for a colour chosen at runtime. The
squares read `var(--sq-dark)`, and `.piece-white` / `.piece-black` in
`globals.css` read the fill and stroke properties with the default set as
fallbacks — so a glyph rendered outside a board, like the promotion picker's
buttons, still looks right without being handed a set.

`lib/board-styles.ts` is a pure leaf module holding all of it, because both
`Board.tsx` and the settings previews need it. **The preference is the viewer's
own**: the game page reads it for whoever is looking and passes it down, so two
players in the same game sit at different boards, and a spectator at a third.
Unknown keys fall back to the default rather than blanking the board, which is
what makes it safe to retire a style later.

## 17. Analysis: the third process

Phase 3, and the brief's own diagram: a finished game goes into a queue, a
Stockfish worker takes it out, and what comes back is structured analysis that
ratings and the coach are both built on.

### Why a third process

The brief asks that "the Stockfish worker should be isolated from the live game
server so heavy analysis cannot interfere with active games". A depth-16 search
pins a core for a second or two per position, and an eighty-move game is
eighty-one of them. Inside the socket process that is a stall in somebody's live
game; inside the web tier it is a request that never returns.

So `analysis/` is a third tier beside `app/` and `realtime/`, and the coupling
is one table. **Nothing waits for it.** If the worker is off for a week the club
plays chess exactly as before and the queue is a week long — which is the
brief's "finishing a game must never require waiting for Stockfish" taken
literally rather than as a nice intention.

It polls, every five seconds. At this size that is indistinguishable from
LISTEN/NOTIFY and there is nothing to get wrong.

### The engine is a separate executable

Stockfish is spawned and spoken to in UCI over a pipe: `STOCKFISH_PATH`, or
`stockfish` on the PATH. It is not an npm dependency and not compiled in. (It is
also not in the Arch/Manjaro repositories any more — the README says how to get
one.)

Two reasons. It is the arm's-length footing under Stockfish's GPL — the club
runs the distro's engine. And the WASM builds are markedly slower for no gain
here, because nobody is waiting for the answer.

`analysis/engine.ts` knows nothing about blunders. It reports what the engine
said; `lib/chess/evaluation.ts` decides what that means, and is pure so the
judgements can be argued with in one place.

### A finished game is a queued game

`analysis.enqueueIn(tx, gameId)` is called inside the same transaction that
marks a game finished — both paths, the mating move and the shared
`finish()` helper. There is no sweeper, and no window in which a game is over
but not queued.

### One search per position

The engine scores the position *before* each move and names its preferred move.
The score after the move actually played is the score of the *next* position,
flipped. So an eighty-move game is eighty-one searches rather than a hundred and
sixty, and every figure stored came from one consistent search.

Positions are given to the engine as `startpos moves …` rather than as a FEN,
for the same reason `positionAfter()` replays the move list: a bare FEN has
forgotten the repetition and fifty-move history.

### Two conventions worth not getting wrong

- **Every score is from the point of view of the player who moved.** Positive is
  good for them, whichever colour they are. An engine always scores the side to
  move, so the score after a move needs flipping, and `analyseMove()` does that
  flip so no call site has to remember.
- **Evaluations are clamped to ±10 pawns before anything is subtracted.**
  Without it, one bad move in an already-lost position produces a "loss" of
  thousands of centipawns and swamps a child's average — but the game was gone
  and the move barely mattered. Clamping is what makes average centipawn loss
  mean "what did your moves cost you" rather than "how badly did you lose".

Playing the engine's own move is graded `best` unconditionally, whatever the
arithmetic says: two searches at a fixed depth can disagree by a few
centipawns, and "your best move was an inaccuracy" is nonsense a child would
notice.

### Nothing is summarised

`game_move_analysis` holds one row per half-move and no aggregates. Average
centipawn loss, blunder counts and skill estimates are all derived on read,
because the brief wants stored analysis to let historical ratings be
recalculated as the algorithm improves — and an average stored in a column is
an average computed by whatever the algorithm was that day.

The engine and the depth are stored beside each analysis. The numbers are only
comparable within one yardstick, and a rating recalculated across a depth change
needs to know which rows are which.

### The evaluation stays hidden during a game

`analysis.forGame()` returns null for a game that is not finished — not as an
optimisation but as the mechanism. The brief forbids players and spectators
seeing Stockfish's view of a live game, and the cheapest way to keep that
promise is to make the read impossible rather than to remember a check at every
place that might render it.

## 18. Playing strength

The brief is blunt about what this must not be: "the primary displayed chess
rating should **not** simply be traditional opponent-based Elo", because
"repeatedly beating the same weaker friend should not cause someone's rating to
continually increase". With eight children and five families, opponent-based
Elo would mostly measure who has the weakest sibling.

So **nothing in the estimator looks at who won, or at who they were playing.**
It looks at the moves, through Stockfish's eyes. `lib/chess/rating.ts` is the
whole algorithm and is pure; `lib/services/ratings.ts` does the reading.

### Nothing is stored

There is no ratings table, no cached number and no rating column. A rating is a
query over `game_move_analysis`, so changing one constant in `rating.ts`
re-rates every member and redraws every historical rating at once, with no
migration and no stale column to notice later. That is the brief's "store the
underlying game analysis so historical ratings can be recalculated as the
algorithm improves", taken at its word — and at twenty games of forty moves it
is eight hundred rows, which is nothing.

**Rating history is a `map`, not a table.** The rating after game *n* is the
estimator run over the games up to *n*.

### Four signals, not one

The brief says "do not assume that average centipawn loss alone maps directly to
player rating", so four things vote, each mapped to a rating and then weighted:

| Signal | Weight | Why it is separate |
| --- | ---: | --- |
| Average centipawn loss | 0.40 | Uses every move |
| Blunders per 100 moves | 0.30 | A good average can still hide one piece given away a game |
| Imprecise moves per 100 | 0.15 | How often they are simply not finding the move |
| Share of engine's own move | 0.15 | Least trusted: most sensitive to search depth |

**The constants are a first pass fitted to nothing**, and the module says so in
its own header. There is no corpus of rated children's games to fit against. The
curves agree roughly with the published centipawn-loss folklore at the ends and
are smooth and monotonic in between. They are all named and in one file so that
when there are two hundred real games the argument is about numbers rather than
about code. A rating from this is "about right, to the nearest hundred", and the
UI says *provisional* until there are five rated games.

One bug worth remembering, because it is the shape of mistake this design
invites: the imprecision signal originally counted only inaccuracies and
mistakes, so a player whose bad moves were *all* catastrophic scored as though
they hardly ever slipped. The first real analysis rated **random legal moves at
548**. Blunders now count as imprecise too, and random play rates 301 — the
floor. Every signal should be checked against "what does this say about someone
playing at random?"

### Stability

The brief's list, in order:

- A rolling sample of the **20** most recent rated games.
- **Recency weighting**, decaying 0.93 per game back, so the newest game carries
  about 8% of a full sample.
- **Length weighting**: a game gets its full say at 25 moves and a proportionate
  say below.
- **Unusual games excluded**: a game needs **8** of the player's own moves to be
  rated at all. Very short games, opening traps, early resignations and
  disconnects are mostly this one condition.
- **The best and worst are trimmed** once the sample reaches six games. This is
  what actually delivers "one unusually strong game should not suddenly add
  hundreds of points" and "one terrible game should not destroy a player's
  rating" — a weighted mean cannot, because the newest game is also the
  heaviest. The smoke suite asserts both, with a hundred-point bound.

### Where it shows

- **`/card` and the public profile** show current estimated strength, with the
  best and worst single games in the sample for context. It is the brief's
  "current estimated chess strength" on a profile.
- **Your own card** shows what each recent game was worth, beside it in the
  list. The public card does not: a per-game level is yours.
- **The game room** says "you played this game at about 548 level", to the two
  players and only once the game is finished and analysed — the brief's own
  sentence, and its rule that Stockfish's view is not available during play.

Not built: the skill breakdown by opening/tactics/middlegame/endgame. The brief
lists it as an eventual extension rather than a phase 3 item, and it wants a
phase-of-game boundary that the stored analysis does not yet mark.

