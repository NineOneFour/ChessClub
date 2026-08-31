/**
 * Boards and pieces.
 *
 * A preset list, like the avatars, for the same reason: a child picking from a
 * short menu gets a board that looks deliberate, and there is nothing to
 * upload, validate or host.
 *
 * Everything here is Unicode and CSS. No images, no licences, no assets to
 * ship, and it all scales with the board. The two Unicode chess families are
 * the whole range available — the solid glyphs (♚) and the hollow ones (♔) —
 * so a piece set is a choice of family plus how each colour is filled and
 * outlined. That is fewer sets than a site with sprite sheets, and every one of
 * them is legible at the size a phone will draw it.
 *
 * A leaf module: pure data, no imports. `Board.tsx` is a Client Component and
 * the settings page renders previews, so both sides need it.
 */

export type BoardStyle = {
  key: string;
  label: string;
  /** The two square colours, as CSS colours. */
  light: string;
  dark: string;
  /** Coordinates and move dots sit on the squares, so they follow them. */
  ink: string;
};

export const BOARD_STYLES: readonly BoardStyle[] = [
  {
    key: "scoresheet",
    label: "Score sheet",
    light: "#f1f2f7",
    dark: "#a8adc8",
    ink: "#191c34",
  },
  {
    key: "boxwood",
    label: "Boxwood",
    light: "#f0d9b5",
    dark: "#b58863",
    ink: "#3a2a17",
  },
  {
    key: "seaglass",
    label: "Sea glass",
    light: "#edeed1",
    dark: "#86a666",
    ink: "#22301a",
  },
  {
    key: "slate",
    label: "Slate",
    light: "#d8dbe2",
    dark: "#6c7386",
    ink: "#14161f",
  },
  {
    key: "rosewood",
    label: "Rosewood",
    light: "#f6e2e2",
    dark: "#b47b86",
    ink: "#3d1f25",
  },
] as const;

export type PieceSet = {
  key: string;
  label: string;
  /**
   * Which Unicode family draws each colour. "solid" is ♚, "hollow" is ♔.
   *
   * Using the solid family for both colours and filling white white is the
   * default because it reads better small than the hollow glyphs, whose thin
   * strokes disappear on a phone. The newsprint set uses the hollow family for
   * white on purpose: it is the newspaper diagram, and it looks like one.
   */
  whiteFamily: "solid" | "hollow";
  blackFamily: "solid" | "hollow";
  /** Fill and outline per colour, as CSS colours. */
  whiteFill: string;
  whiteStroke: string;
  blackFill: string;
  blackStroke: string;
  /** Outline width. Heavier reads better on a busy board. */
  strokeWidth: string;
};

export const PIECE_SETS: readonly PieceSet[] = [
  {
    key: "scoresheet",
    label: "Score sheet",
    whiteFamily: "solid",
    blackFamily: "solid",
    whiteFill: "#ffffff",
    whiteStroke: "#191c34",
    blackFill: "#191c34",
    blackStroke: "#191c34",
    strokeWidth: "1.4px",
  },
  {
    key: "newsprint",
    label: "Newsprint",
    whiteFamily: "hollow",
    blackFamily: "solid",
    whiteFill: "#ffffff",
    whiteStroke: "#191c34",
    blackFill: "#191c34",
    blackStroke: "#191c34",
    strokeWidth: "0.6px",
  },
  {
    key: "woodcut",
    label: "Woodcut",
    whiteFamily: "solid",
    blackFamily: "solid",
    whiteFill: "#f7ecd8",
    whiteStroke: "#3a2a17",
    blackFill: "#3a2a17",
    blackStroke: "#1d150b",
    strokeWidth: "2.2px",
  },
  {
    key: "brass",
    label: "Brass",
    whiteFamily: "solid",
    blackFamily: "solid",
    whiteFill: "#f4e4bd",
    whiteStroke: "#5c4310",
    blackFill: "#9d7420",
    blackStroke: "#4a3410",
    strokeWidth: "1.8px",
  },
] as const;

/** Solid glyphs (♚): one family, used for either colour. */
const SOLID: Record<string, string> = {
  k: "♚",
  q: "♛",
  r: "♜",
  b: "♝",
  n: "♞",
  p: "♟",
};

/** Hollow glyphs (♔), for a set that wants the newspaper look. */
const HOLLOW: Record<string, string> = {
  k: "♔",
  q: "♕",
  r: "♖",
  b: "♗",
  n: "♘",
  p: "♙",
};

export const DEFAULT_BOARD_STYLE = BOARD_STYLES[0].key;
export const DEFAULT_PIECE_SET = PIECE_SETS[0].key;

/** The stored key, or the default — a key from an older list must not blank the board. */
export function boardStyle(key: string | null | undefined): BoardStyle {
  return BOARD_STYLES.find((style) => style.key === key) ?? BOARD_STYLES[0];
}

export function pieceSet(key: string | null | undefined): PieceSet {
  return PIECE_SETS.find((set) => set.key === key) ?? PIECE_SETS[0];
}

export function isBoardStyleKey(key: string): boolean {
  return BOARD_STYLES.some((style) => style.key === key);
}

export function isPieceSetKey(key: string): boolean {
  return PIECE_SETS.some((set) => set.key === key);
}

/** The glyph for one piece in one set. */
export function glyph(
  set: PieceSet,
  role: string,
  color: "white" | "black",
): string {
  const family = color === "white" ? set.whiteFamily : set.blackFamily;
  return (family === "solid" ? SOLID : HOLLOW)[role] ?? "";
}

/**
 * The custom properties a board and a set come down to.
 *
 * Returned as a plain object for `style={...}`, because Tailwind cannot
 * generate a class for a colour chosen at runtime — the squares and the glyphs
 * read these variables instead. See globals.css.
 */
export function boardVars(
  style: BoardStyle,
  set: PieceSet,
): React.CSSProperties {
  return {
    "--sq-light": style.light,
    "--sq-dark": style.dark,
    "--sq-ink": style.ink,
    "--piece-white-fill": set.whiteFill,
    "--piece-white-stroke": set.whiteStroke,
    "--piece-black-fill": set.blackFill,
    "--piece-black-stroke": set.blackStroke,
    "--piece-stroke-width": set.strokeWidth,
  } as React.CSSProperties;
}
