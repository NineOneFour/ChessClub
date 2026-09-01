/**
 * Boards and pieces.
 *
 * A preset list, like the avatars, for the same reason: a child picking from a
 * short menu gets a board that looks deliberate, and there is nothing to
 * upload, validate or host.
 *
 * Most piece sets are Unicode and CSS — no images, no licences, no assets to
 * ship, and they scale with the board. The two Unicode chess families are the
 * whole range available — the solid glyphs (♚) and the hollow ones (♔) — so a
 * glyph set is a choice of family plus how each colour is filled and outlined.
 * A set may instead be `kind: "image"`, backed by files under
 * `public/pieces/<key>/`, for a look Unicode can't produce — see
 * `pieceVisual()`, the one place that knows how to draw either kind.
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

export type GlyphPieceSet = {
  kind: "glyph";
  key: string;
  label: string;
  /**
   * Which glyph family draws each colour. "solid" is ♚, "hollow" is ♔,
   * "letters" is 𝗞 — old-school algebraic notation letters, drawn from
   * Unicode's Mathematical Sans-Serif Bold block rather than plain ASCII so
   * they're bold and blocky in any font, the same trick as "bold" text
   * elsewhere on the web.
   *
   * Using the solid family for both colours and filling white white is the
   * default because it reads better small than the hollow glyphs, whose thin
   * strokes disappear on a phone. The newsprint set uses the hollow family for
   * white on purpose: it is the newspaper diagram, and it looks like one.
   */
  whiteFamily: "solid" | "hollow" | "letters";
  blackFamily: "solid" | "hollow" | "letters";
  /** Fill and outline per colour, as CSS colours. */
  whiteFill: string;
  whiteStroke: string;
  blackFill: string;
  blackStroke: string;
  /** Outline width. Heavier reads better on a busy board. */
  strokeWidth: string;
};

/**
 * A set drawn from image files rather than Unicode — for a look the two
 * built-in glyph families can't produce. Each piece carries its own colour
 * baked in, so there is nothing here for `boardVars()` to hand the CSS.
 */
export type ImagePieceSet = {
  kind: "image";
  key: string;
  label: string;
  /** `public/pieces/<key>/<color>-<role>.png` — role is one of k q r b n p. */
  path: (role: string, color: "white" | "black") => string;
};

export type PieceSet = GlyphPieceSet | ImagePieceSet;

function imageSet(key: string, label: string): ImagePieceSet {
  return {
    kind: "image",
    key,
    label,
    path: (role, color) => `/pieces/${key}/${color === "white" ? "w" : "b"}-${role}.png`,
  };
}

export const PIECE_SETS: readonly PieceSet[] = [
  {
    kind: "glyph",
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
    kind: "glyph",
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
    kind: "glyph",
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
    kind: "glyph",
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
  {
    kind: "glyph",
    key: "letters",
    label: "Letters",
    whiteFamily: "letters",
    blackFamily: "letters",
    whiteFill: "#ffffff",
    whiteStroke: "#191c34",
    blackFill: "#191c34",
    blackStroke: "#191c34",
    strokeWidth: "1.6px",
  },
  imageSet("illustrated", "Illustrated"),
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

/**
 * Old-school algebraic-notation letters (𝗞), one per role — no case
 * distinction between colours; that comes from fill/stroke like every other
 * glyph family. Mathematical Sans-Serif Bold, not plain ASCII, so they come
 * out bold and blocky without needing a font-weight of their own.
 */
const LETTERS: Record<string, string> = {
  k: "𝗞",
  q: "𝗤",
  r: "𝗥",
  b: "𝗕",
  n: "𝗡",
  p: "𝗣",
};

const GLYPH_FAMILIES: Record<"solid" | "hollow" | "letters", Record<string, string>> = {
  solid: SOLID,
  hollow: HOLLOW,
  letters: LETTERS,
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

/**
 * How to draw one piece — the one place that knows a set might be glyph or
 * image, so `Board.tsx`, `GameRoom.tsx`'s captured-pieces row and the
 * settings-page preview don't each need to branch on `set.kind` themselves.
 */
export type PieceVisual =
  | { kind: "glyph"; text: string }
  | { kind: "image"; src: string };

export function pieceVisual(
  set: PieceSet,
  role: string,
  color: "white" | "black",
): PieceVisual {
  if (set.kind === "image") {
    return { kind: "image", src: set.path(role, color) };
  }
  const family = color === "white" ? set.whiteFamily : set.blackFamily;
  return { kind: "glyph", text: GLYPH_FAMILIES[family][role] ?? "" };
}

/**
 * The custom properties a board and a set come down to.
 *
 * Returned as a plain object for `style={...}`, because Tailwind cannot
 * generate a class for a colour chosen at runtime — the squares and the glyphs
 * read these variables instead. See globals.css. An image set has no colours
 * of its own to hand over — each piece's colour is baked into its file.
 */
export function boardVars(
  style: BoardStyle,
  set: PieceSet,
): React.CSSProperties {
  const vars: Record<string, string> = {
    "--sq-light": style.light,
    "--sq-dark": style.dark,
    "--sq-ink": style.ink,
  };
  if (set.kind === "glyph") {
    vars["--piece-white-fill"] = set.whiteFill;
    vars["--piece-white-stroke"] = set.whiteStroke;
    vars["--piece-black-fill"] = set.blackFill;
    vars["--piece-black-stroke"] = set.blackStroke;
    vars["--piece-stroke-width"] = set.strokeWidth;
  }
  return vars as React.CSSProperties;
}
