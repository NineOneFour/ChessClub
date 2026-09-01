# Groq-backed post-game coaching summary

**Status:** Approved for planning
**Scope:** Phase 4 (AI Coach), first slice only — the post-game plain-language
summary. Strength/weakness identification, practice recommendations,
multi-game trends, and skill breakdowns are separate future slices built on
top of the same LLM plumbing, not part of this spec.

## Why

Phase 3 (Stockfish analysis, per-move grading, the opponent-blind rating
estimator) is complete, but its output — centipawn loss, blunder counts — is
not something a child learns from unassisted. Phase 4 turns that structured
data into coaching language a kid can act on. See
`.mex/context/analysis.md` and the "AI Chess Coach" section of
`Private Chess Club - Project.md`.

The brief requires the LLM integration be abstracted so a hosted API or a
locally hosted model can be swapped in later, and that the core application
never depend on the LLM being available. Groq is the first (and, for now,
only) provider.

## Flow

```
Completed Game
      |
      v
Analysis Queue (existing)
      |
      v
Stockfish Worker (existing) --- recordSuccess() ---> game_analysis: done
      |
      v
Coaching claim (new, same worker/process)
      |
      v
Groq (llama-3.3-70b-versatile) --- one call per player ---> game_coach_summary
```

Coaching runs in the *same* worker process as Stockfish analysis
(`analysis/worker.ts`), not a separate process or queue stage. This reuses
the existing isolation (heavy work off the web tier and the live game path)
without adding a fourth process. A finished game's Stockfish analysis and its
coaching summaries are independent failure domains within that one process:
a Groq outage never touches `game_analysis`'s status or attempt count, and a
Stockfish outage means coaching simply never gets a `done` game to work from.

If `GROQ_API_KEY` is unset, the coaching branch is skipped every poll cycle
(logged once at startup) — same posture as Stockfish being absent: the club
functions identically, just without that feature.

## Schema

New table in `lib/db/schema/analysis.ts`, alongside `game_analysis` /
`game_move_analysis`:

```ts
export const gameCoachSummary = pgTable(
  "game_coach_summary",
  {
    gameId: integer("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    /** Null while pending or after a failed attempt. */
    summary: text("summary"),
    /** Which Groq model produced `summary`. Null until a summary exists. */
    model: text("model"),
    /** The last failure, cleared on success. Mirrors game_analysis.error. */
    error: text("error"),
    generatedAt: timestamp("generated_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.gameId, t.userId] }),
    index("game_coach_summary_game_idx").on(t.gameId),
  ],
);
```

One row per `(game, player)` — coaching text is inherently personal ("You
played...", "You lost your rook..."), so white and black get independent
rows, independent retry, and independent failure state. A row exists once a
generation has been *attempted*; `summary IS NULL` (with `error` set) means
"tried and failed, retry later." There is no attempts cap and no permanent
"gave up" state — same reasoning as `game_analysis`'s general philosophy
applied without the extra bookkeeping: at 8 children and a handful of games a
day, a summary that fails forever is something a human notices in the logs,
not something worth backoff/exhaustion tracking for.

## Service: `lib/services/coach.ts`

Mirrors the shape of `lib/services/analysis.ts`:

- `claimNextForCoaching(): Promise<{ gameId: number; userId: number } | null>`
  — the oldest `game_analysis` row with `status = 'done'` that has a player
  (white or black) with no `game_coach_summary` row yet, or a row with
  `summary IS NULL`. Uses `for update skip locked` on the same pattern as
  `analysis.claimNext()`, even though this club only ever runs one worker —
  cheap insurance against the same class of bug the comment in
  `claimNext()` already calls out.
- `recordCoachSummary(gameId, userId, summary, model): Promise<void>` —
  upserts the row with `summary`, `model`, `generatedAt = now()`, `error =
  null`.
- `recordCoachFailure(gameId, userId, message): Promise<void>` — upserts the
  row with `error` set (truncated, same 500-char convention as
  `analysis.recordFailure`), `summary` left null.
- `summaryFor(gameId, userId): Promise<string | null>` — the read path for
  the UI. Returns null if no successful summary exists yet; the game review
  page shows Stockfish analysis with no coaching text in that case, same
  "enhancement, not a dependency" posture as the rest of Phase 4.

## Prompt building: `lib/llm/coach.ts`

Given `(gameId, userId)`:

1. Calls `performanceIn(gameId, userId)` (existing, `lib/services/ratings.ts`)
   for this player's `GamePerformance`: rating, ACPL, blunder/mistake/
   inaccuracy counts, best-move share, move count.
2. Reads the game's result (`games.result`, `resultReason`) and this player's
   colour.
3. Selects this player's worst 2-3 moves by `lossCp` from
   `game_move_analysis` (restricted to their own plies — odd if white, even
   if black), joined to `game_moves` for `san`. For each, includes the move
   number, SAN, centipawn loss, and the FEN before and after that move.
4. Builds a system prompt fixing:
   - **Audience: kids aged 8-13.** Short sentences, concrete and encouraging
     language, no jargon without explaining it (e.g. don't just say
     "inaccuracy" — say what it means in one clause). The brief's own
     example is the target voice:
     > "You played around the 950 level this game. You did a really good job
     > developing your pieces and keeping your king safe. Your biggest
     > problem was leaving pieces undefended..."
   - **Grounding, not invention.** The model must never contradict the given
     numbers (rating, counts, result) and must hedge any causal explanation
     it offers from the FEN ("it looks like...", "that move let your
     opponent...") rather than asserting it as settled fact — the FEN is
     there to let it describe *what changed on the board*, not to license
     confident tactical analysis a 70B model can get wrong.
   - **Output is user-facing prose only** — no move lists, no centipawn
     numbers verbatim, no markdown.
5. Returns the assembled user-message content; the system prompt is a fixed
   constant in this module.

## Groq client: `lib/llm/groq.ts`

Uses the `groq-sdk` npm package. One function:

```ts
export async function generateCoachSummary(
  systemPrompt: string,
  userPrompt: string,
): Promise<string>
```

Model: `GROQ_MODEL` env var, default `llama-3.3-70b-versatile`. No provider
registry or config-driven switching — a second provider later means a second
module with the same function signature, called from
`lib/services/coach.ts` in place of this one. That single call site is the
entire "abstraction" the brief asks for; it does not need to be more general
than that until a second provider actually exists.

## Worker changes: `analysis/worker.ts`

After the existing `claimNext()` branch finds no Stockfish work, add a
second check before sleeping:

```ts
const gameId = await analysis.claimNext();
if (gameId !== null) {
  // ...existing Stockfish flow...
  continue;
}

if (groqConfigured) {
  const claim = await coach.claimNextForCoaching();
  if (claim !== null) {
    try {
      const prompt = await buildCoachPrompt(claim.gameId, claim.userId);
      const summary = await generateCoachSummary(SYSTEM_PROMPT, prompt);
      await coach.recordCoachSummary(claim.gameId, claim.userId, summary, GROQ_MODEL);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await coach.recordCoachFailure(claim.gameId, claim.userId, message);
    }
    continue;
  }
}

await sleep(POLL_MS);
```

(`GROQ_MODEL` here is the resolved model name — the `GROQ_MODEL` env var if
set, else the `llama-3.3-70b-versatile` default — read once at startup,
same as `DEPTH`/`POLL_MS` above it in this file.)

Stockfish work is always drained first — coaching only runs when there is
none pending, so a backlog of unanalysed games is never slowed down by Groq
calls. `groqConfigured` is computed once at startup from `GROQ_API_KEY`
being present, logged once (`[analysis] coaching disabled: GROQ_API_KEY not
set`), not re-checked every loop.

## Config: `.env.example`

```
# --- Coaching (Groq) -------------------------------------------------------
# Post-game LLM summaries, generated by the analysis worker after Stockfish
# finishes. Leave empty to run without coaching summaries — Stockfish
# analysis, ratings, and everything else work identically either way.
GROQ_API_KEY=
# Defaults to llama-3.3-70b-versatile if unset.
GROQ_MODEL=
```

## Testing

`scripts/smoke-coach.ts` (`npm run smoke:coach`), following the shape of
`scripts/smoke-analysis.ts`: skips with a clear message if `GROQ_API_KEY` is
unset; otherwise runs a finished, Stockfish-analysed game through
`claimNextForCoaching` → `generateCoachSummary` → `recordCoachSummary` and
asserts a non-empty summary is stored for both players.

## Explicitly out of scope for this slice

- Strength/weakness identification, practice recommendations, multi-game
  trend analysis, skill breakdowns (later Phase 4 slices on the same
  plumbing).
- Any UI to display the summary (a follow-up once this produces real data to
  show).
- A second LLM provider or config-driven provider switching.
- Retry backoff / permanent-failure tracking for coaching generation.
- Content moderation beyond the system prompt's own instructions — this is a
  closed, trusted-social-group environment (see `context/decisions.md`,
  "Scale is fixed at ~8 children, 5 families"), not a public platform.
