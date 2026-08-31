"use client";

import { useState } from "react";
import {
  BOARD_STYLES,
  boardVars,
  glyph,
  PIECE_SETS,
  boardStyle as resolveStyle,
  pieceSet as resolveSet,
} from "@/lib/board-styles";

/**
 * The board and the pieces, chosen by looking at them.
 *
 * Each option is a real four-square board with real pieces on it, drawn by the
 * same glyphs and the same custom properties the game uses, so what a child
 * picks is what they get. A list of names would make somebody guess what
 * "Newsprint" looks like, and then find out in the middle of a game.
 *
 * Two radio groups so the whole thing submits with the surrounding form and
 * works from the keyboard.
 */
export function BoardPicker({
  currentStyle,
  currentSet,
}: {
  currentStyle: string;
  currentSet: string;
}) {
  const [styleKey, setStyleKey] = useState(currentStyle);
  const [setKey, setSetKey] = useState(currentSet);

  const style = resolveStyle(styleKey);
  const set = resolveSet(setKey);

  return (
    <div className="space-y-5">
      <fieldset>
        <legend className="eyebrow">Board</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {BOARD_STYLES.map((option) => (
            <label
              key={option.key}
              title={option.label}
              className={`cursor-pointer rounded-sm border p-1 ${
                styleKey === option.key ? "border-ink" : "border-rule"
              }`}
            >
              <input
                type="radio"
                name="boardStyle"
                value={option.key}
                checked={styleKey === option.key}
                onChange={() => setStyleKey(option.key)}
                className="sr-only"
              />
              <Swatch style={option} set={set} />
              <span className="sr-only">{option.label}</span>
            </label>
          ))}
        </div>
        <p className="mt-2 font-mono text-[0.65rem] text-ink-soft">
          {style.label}
        </p>
      </fieldset>

      <fieldset>
        <legend className="eyebrow">Pieces</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {PIECE_SETS.map((option) => (
            <label
              key={option.key}
              title={option.label}
              className={`cursor-pointer rounded-sm border p-1 ${
                setKey === option.key ? "border-ink" : "border-rule"
              }`}
            >
              <input
                type="radio"
                name="pieceSet"
                value={option.key}
                checked={setKey === option.key}
                onChange={() => setSetKey(option.key)}
                className="sr-only"
              />
              <Swatch style={style} set={option} />
              <span className="sr-only">{option.label}</span>
            </label>
          ))}
        </div>
        <p className="mt-2 font-mono text-[0.65rem] text-ink-soft">
          {set.label}
        </p>
      </fieldset>
    </div>
  );
}

/** Four squares, a white king and a black knight: enough to judge a board by. */
function Swatch({
  style,
  set,
}: {
  style: (typeof BOARD_STYLES)[number];
  set: (typeof PIECE_SETS)[number];
}) {
  const squares: { dark: boolean; piece?: { role: string; color: "white" | "black" } }[] = [
    { dark: false, piece: { role: "n", color: "black" } },
    { dark: true },
    { dark: true },
    { dark: false, piece: { role: "k", color: "white" } },
  ];

  return (
    <span
      aria-hidden
      style={boardVars(style, set)}
      className="grid h-14 w-14 grid-cols-2 grid-rows-2"
    >
      {squares.map((square, index) => (
        <span
          key={index}
          className={`grid place-items-center ${
            square.dark ? "bg-[var(--sq-dark)]" : "bg-[var(--sq-light)]"
          }`}
        >
          {square.piece && (
            <span
              className={`piece-glyph text-[1.35rem] leading-none ${
                square.piece.color === "white" ? "piece-white" : "piece-black"
              }`}
            >
              {glyph(set, square.piece.role, square.piece.color)}
            </span>
          )}
        </span>
      ))}
    </span>
  );
}
