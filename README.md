# The Chess Club

A private, invitation-only chess clubhouse, self-hosted for one family and
their real-world friends.

- `Private Chess Club - Project.md` — the brief
- `design.md` — decisions and reasoning
- `CLAUDE.md` — working notes, commands, and traps

Phase 1 (clubhouse: accounts, invitations, presence, chat) is built. So is
phase 2 (chess): live two-player games with server-side rules, clocks,
challenges, open offers, spectators and game chat. Phase 3 — Stockfish
analysis and coaching — has not started.

## Getting started

```bash
cp .env.example .env      # fill in DATABASE_URL and PUBLIC_ORIGIN
createdb chessclub
npm install
npm run db:migrate
ADMIN_USERNAME=you ADMIN_PASSWORD=... npm run seed:admin
npm run dev:all
```

Sign in as the administrator, then create an invitation link for each family.
There is no public sign-up route and there never will be.
