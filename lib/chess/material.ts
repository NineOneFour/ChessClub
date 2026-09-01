import { STARTING_FEN } from "./position";

/** Standard piece values, pawn to queen. Kings are never captured. */
export const PIECE_VALUE: Record<string, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
};

export type Captured = {
  /** Black pieces (lower-case letters) captured by White, in the order taken. */
  byWhite: string[];
  /** White pieces (upper-case letters) captured by Black, in the order taken. */
  byBlack: string[];
};

/** Tally of each piece letter on a board — FEN case marks colour. */
function pieceCounts(fen: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const char of fen.split(" ")[0]) {
    if (/[a-zA-Z]/.test(char)) counts[char] = (counts[char] ?? 0) + 1;
  }
  return counts;
}

/**
 * Captured material, read off the FEN already stored after each move rather
 * than simulated — the browser holds no chess logic of its own (see
 * `Board.tsx`), and every move already carries `fenAfter`.
 *
 * Diffing raw piece counts move-to-move would misread a capturing promotion
 * (`exd8=Q`) as the mover losing a pawn: promotion always changes the
 * *mover's own* letters, never the opponent's. So only the opponent's letters
 * are ever checked for a drop in count — `ply` (odd for White, even for
 * Black) says who moved and therefore whose letters are the opponent's.
 */
export function capturedPieces(
  moves: { ply: number; fenAfter: string }[],
): Captured {
  const byWhite: string[] = [];
  const byBlack: string[] = [];
  let prev = pieceCounts(STARTING_FEN);

  for (const move of moves) {
    const counts = pieceCounts(move.fenAfter);
    const whiteMoved = move.ply % 2 === 1;
    const opponentLetters = whiteMoved ? "pnbrq" : "PNBRQ";

    for (const letter of opponentLetters) {
      const lost = (prev[letter] ?? 0) - (counts[letter] ?? 0);
      for (let i = 0; i < lost; i++) {
        (whiteMoved ? byWhite : byBlack).push(letter);
      }
    }
    prev = counts;
  }

  return { byWhite, byBlack };
}

/** Total value of a list of captured pieces, for a "+N" material lead. */
export function materialValue(captured: string[]): number {
  return captured.reduce(
    (total, letter) => total + (PIECE_VALUE[letter.toLowerCase()] ?? 0),
    0,
  );
}

/** Heaviest first — how a captured-pieces row is conventionally scanned. */
export function sortByValue(captured: string[]): string[] {
  return [...captured].sort(
    (a, b) =>
      (PIECE_VALUE[b.toLowerCase()] ?? 0) - (PIECE_VALUE[a.toLowerCase()] ?? 0),
  );
}
