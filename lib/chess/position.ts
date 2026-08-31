/**
 * The starting position, and nothing else.
 *
 * It lives here rather than in `rules.ts` because the board needs it —
 * stepping back before white's first move has no stored FEN to show — and
 * `rules.ts` imports chess.js. A Client Component importing it would pull a
 * chess engine into the browser bundle, which is the one thing the design
 * forbids: see design.md §10.
 */
export const STARTING_FEN =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
