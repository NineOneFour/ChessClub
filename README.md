# The Chess Club

A private, invitation-only chess clubhouse, self-hosted for one family and
their real-world friends.

- `Private Chess Club - Project.md` — the brief
- `design.md` — decisions and reasoning
- `CLAUDE.md` — working notes, commands, and traps

Phase 1 (clubhouse: accounts, invitations, presence, chat) is built. So is
phase 2 (chess): live two-player games with server-side rules, clocks,
challenges, open offers, spectators, game chat and review. Phase 3 (analysis)
is under way — the queue, the Stockfish worker and per-move blunder detection
are in; ratings and the coach are not.

## Getting started

```bash
cp .env.example .env      # fill in DATABASE_URL and PUBLIC_ORIGIN
createdb chessclub
npm install
npm run db:migrate
ADMIN_USERNAME=you ADMIN_PASSWORD=... npm run seed:admin
npm run dev:all
```

## Analysis

Optional, and nothing waits for it: without an engine the club works exactly as
before and finished games queue up for later.

Stockfish is **not in the Arch/Manjaro repositories** — it is on the AUR
(`yay -S stockfish`), and building it from the official source works without
root:

```bash
git clone --depth 1 https://github.com/official-stockfish/Stockfish
cd Stockfish/src && make -j"$(nproc)" profile-build ARCH=x86-64-avx2
cp stockfish ~/.local/bin/
```

`ARCH=x86-64-avx512` if the CPU has it (`grep -o avx512f /proc/cpuinfo`). The
binary embeds its neural network, so it is one ~95MB file and nothing else.

Then `npm run analysis` works the queue, and `npm run analysis:queue` adds any
finished games that predate the worker.

Sign in as the administrator, then create an invitation link for each family.
There is no public sign-up route and there never will be.
