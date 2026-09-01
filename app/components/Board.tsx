"use client";

import { useRef, useState } from "react";
import {
  boardStyle,
  boardVars,
  pieceSet,
  pieceVisual,
  type PieceSet,
} from "@/lib/board-styles";

/**
 * The board.
 *
 * Hand-written, and it holds no chess knowledge at all: it is given a position,
 * a map of legal destinations and a map of which of those need a promotion
 * piece, all by the server. It cannot work out a move on its own, which is the
 * point — see design.md §10.
 *
 * Pieces are Unicode glyphs rather than images. There are no assets to license
 * or ship, it scales with the board, and the typographic treatment is of a
 * piece with the rest of the design. The default set uses the solid (black)
 * glyphs for both colours, filling white white and outlining it in ink, which
 * reads far better at small sizes than the hollow outline glyphs.
 *
 * The squares and the pieces come from the viewer's own chosen style — see
 * lib/board-styles.ts. They are custom properties set on the grid rather than
 * classes, because Tailwind cannot generate a class for a colour picked at
 * runtime.
 */

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
const RANKS = ["8", "7", "6", "5", "4", "3", "2", "1"] as const;

const PIECE_NAMES: Record<string, string> = {
  k: "king",
  q: "queen",
  r: "rook",
  b: "bishop",
  n: "knight",
  p: "pawn",
};

const PROMOTION_CHOICES = ["q", "r", "b", "n"] as const;

export type BoardPiece = { role: string; color: "white" | "black" };

/** Read the board half of a FEN into a square → piece map. */
export function piecesFromFen(fen: string): Record<string, BoardPiece> {
  const pieces: Record<string, BoardPiece> = {};
  const rows = fen.split(" ")[0].split("/");

  rows.forEach((row, rowIndex) => {
    let file = 0;
    for (const char of row) {
      if (/[1-8]/.test(char)) {
        file += Number(char);
        continue;
      }
      const square = `${FILES[file]}${RANKS[rowIndex]}`;
      pieces[square] = {
        role: char.toLowerCase(),
        color: char === char.toUpperCase() ? "white" : "black",
      };
      file += 1;
    }
  });

  return pieces;
}

/** The king's square, for highlighting check. */
function kingSquare(
  pieces: Record<string, BoardPiece>,
  color: "white" | "black",
): string | null {
  for (const [square, piece] of Object.entries(pieces)) {
    if (piece.role === "k" && piece.color === color) return square;
  }
  return null;
}

export function Board({
  fen,
  orientation,
  dests,
  promotions,
  lastMove,
  inCheck,
  turn,
  /** Null for a spectator or a finished game: the board becomes read-only. */
  playingAs,
  onMove,
  /** The viewer's own board and pieces. Unknown keys fall back to the default. */
  styleKey,
  pieceSetKey,
}: {
  fen: string;
  orientation: "white" | "black";
  dests: Record<string, string[]>;
  promotions: Record<string, string[]>;
  lastMove: { from: string; to: string } | null;
  inCheck: boolean;
  turn: "white" | "black";
  playingAs: "white" | "black" | null;
  onMove: (move: { from: string; to: string; promotion?: string }) => void;
  styleKey?: string | null;
  pieceSetKey?: string | null;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState<{ from: string; to: string } | null>(
    null,
  );
  const [dragging, setDragging] = useState<string | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  const pieces = piecesFromFen(fen);
  const myTurn = playingAs !== null && playingAs === turn;

  // A new position arrives: nothing should stay selected from the last one.
  // Adjusting during render rather than in an effect — React's own
  // recommendation, and it avoids a frame showing the stale selection.
  const [renderedFen, setRenderedFen] = useState(fen);
  if (fen !== renderedFen) {
    setRenderedFen(fen);
    setSelected(null);
    setDragging(null);
  }

  const squares =
    orientation === "white"
      ? RANKS.flatMap((rank) => FILES.map((file) => `${file}${rank}`))
      : [...RANKS]
          .reverse()
          .flatMap((rank) => [...FILES].reverse().map((file) => `${file}${rank}`));

  const legalFrom = selected ? (dests[selected] ?? []) : [];

  function canPickUp(square: string): boolean {
    if (!myTurn) return false;
    const piece = pieces[square];
    return Boolean(piece && piece.color === playingAs && dests[square]?.length);
  }

  function attempt(from: string, to: string) {
    if (!dests[from]?.includes(to)) {
      setSelected(null);
      return;
    }
    if (promotions[from]?.includes(to)) {
      // Ask which piece before sending anything.
      setPending({ from, to });
      setSelected(null);
      return;
    }
    onMove({ from, to });
    setSelected(null);
  }

  function onSquarePointerDown(square: string, event: React.PointerEvent) {
    if (pending) return;

    if (selected && selected !== square) {
      attempt(selected, square);
      return;
    }
    if (!canPickUp(square)) {
      setSelected(null);
      return;
    }

    setSelected(square);
    setDragging(square);
    // Capture the pointer so a drag that leaves the square still tracks.
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  }

  function onSquarePointerUp(square: string, event: React.PointerEvent) {
    if (!dragging) return;

    const dropped = squareAtPoint(event.clientX, event.clientY);
    setDragging(null);

    // A tap (released on the piece you picked up) selects rather than moves,
    // so click-to-move works as well as dragging.
    if (dropped === null || dropped === square) return;
    attempt(square, dropped);
  }

  /** Which square is under a screen point. */
  function squareAtPoint(x: number, y: number): string | null {
    const board = boardRef.current;
    if (!board) return null;
    const rect = board.getBoundingClientRect();
    const file = Math.floor(((x - rect.left) / rect.width) * 8);
    const rank = Math.floor(((y - rect.top) / rect.height) * 8);
    if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;

    return orientation === "white"
      ? `${FILES[file]}${RANKS[rank]}`
      : `${FILES[7 - file]}${RANKS[7 - rank]}`;
  }

  const checkedKing = inCheck ? kingSquare(pieces, turn) : null;

  const style = boardStyle(styleKey);
  const set = pieceSet(pieceSetKey);

  return (
    <div className="relative">
      <div
        ref={boardRef}
        style={boardVars(style, set)}
        className="grid aspect-square w-full touch-none select-none grid-cols-8 grid-rows-8 border-2 border-ink"
        role="grid"
        aria-label="Chess board"
      >
        {squares.map((square) => {
          const file = FILES.indexOf(square[0] as (typeof FILES)[number]);
          const rank = RANKS.indexOf(square[1] as (typeof RANKS)[number]);
          const dark = (file + rank) % 2 === 1;
          const piece = pieces[square];

          const isTarget = legalFrom.includes(square);
          const isCapture = isTarget && Boolean(piece);
          const showCoordFile =
            orientation === "white" ? square[1] === "1" : square[1] === "8";
          const showCoordRank =
            orientation === "white" ? square[0] === "a" : square[0] === "h";

          return (
            <div
              key={square}
              role="gridcell"
              aria-label={
                piece
                  ? `${square}, ${piece.color} ${PIECE_NAMES[piece.role]}`
                  : square
              }
              onPointerDown={(event) => onSquarePointerDown(square, event)}
              onPointerUp={(event) => onSquarePointerUp(square, event)}
              className={[
                "relative grid place-items-center",
                dark ? "bg-[var(--sq-dark)]" : "bg-[var(--sq-light)]",
                square === selected ? "outline outline-2 -outline-offset-2 outline-ink" : "",
                lastMove && (square === lastMove.from || square === lastMove.to)
                  ? "shadow-[inset_0_0_0_3px_rgba(157,116,32,0.55)]"
                  : "",
                square === checkedKing
                  ? "shadow-[inset_0_0_0_3px_var(--color-stamp)]"
                  : "",
                canPickUp(square) || isTarget ? "cursor-pointer" : "",
              ].join(" ")}
            >
              {showCoordRank && (
                <span className="pointer-events-none absolute left-0.5 top-0 font-mono text-[0.55rem] text-[var(--sq-ink)] opacity-55">
                  {square[1]}
                </span>
              )}
              {showCoordFile && (
                <span className="pointer-events-none absolute bottom-0 right-0.5 font-mono text-[0.55rem] text-[var(--sq-ink)] opacity-55">
                  {square[0]}
                </span>
              )}

              {/* A dot for an empty legal square, a ring for a capture. */}
              {isTarget && !isCapture && (
                <span className="pointer-events-none absolute h-[22%] w-[22%] rounded-full bg-[var(--sq-ink)] opacity-30" />
              )}
              {isCapture && (
                <span className="pointer-events-none absolute inset-[6%] rounded-full border-[3px] border-[var(--sq-ink)] opacity-35" />
              )}

              {piece &&
                (() => {
                  const visual = pieceVisual(set, piece.role, piece.color);
                  const faded = dragging === square ? "opacity-40" : "";
                  return visual.kind === "image" ? (
                    <img
                      src={visual.src}
                      alt=""
                      draggable={false}
                      className={`pointer-events-none relative h-[78%] w-[78%] object-contain ${faded}`}
                    />
                  ) : (
                    <span
                      aria-hidden
                      className={[
                        "piece-glyph pointer-events-none relative leading-none",
                        "text-[min(9vw,3.2rem)] sm:text-[min(6vw,3.4rem)]",
                        piece.color === "white" ? "piece-white" : "piece-black",
                        faded,
                      ].join(" ")}
                    >
                      {visual.text}
                    </span>
                  );
                })()}
            </div>
          );
        })}
      </div>

      {pending && (
        <PromotionPicker
          set={set}
          color={playingAs ?? "white"}
          onPick={(role) => {
            onMove({ from: pending.from, to: pending.to, promotion: role });
            setPending(null);
          }}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}

/**
 * Which piece a pawn becomes. An overlay rather than a browser dialog: a
 * native `confirm`/`prompt` blocks the page, and this needs to look like part
 * of the board.
 */
function PromotionPicker({
  set,
  color,
  onPick,
  onCancel,
}: {
  set: PieceSet;
  color: "white" | "black";
  onPick: (role: string) => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="absolute inset-0 grid place-items-center bg-ink/45"
      onClick={onCancel}
    >
      <div
        style={boardVars(boardStyle(null), set)}
        className="sheet flex gap-1 p-2"
        onClick={(event) => event.stopPropagation()}
      >
        {PROMOTION_CHOICES.map((role) => {
          const visual = pieceVisual(set, role, color);
          return (
            <button
              key={role}
              type="button"
              onClick={() => onPick(role)}
              aria-label={`Promote to ${PIECE_NAMES[role]}`}
              className={`grid h-14 w-14 place-items-center rounded-sm border border-rule bg-white text-4xl leading-none hover:border-ink ${
                color === "white" ? "piece-white" : "piece-black"
              }`}
            >
              {visual.kind === "image" ? (
                <img src={visual.src} alt="" className="h-10 w-10 object-contain" />
              ) : (
                <span aria-hidden className="piece-glyph">
                  {visual.text}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
