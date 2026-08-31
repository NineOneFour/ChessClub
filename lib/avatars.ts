/**
 * Avatars are a fixed preset list, not uploads. That removes image storage,
 * resizing and the moderation question entirely, and a preset picker is
 * faster for a kid than finding a file anyway.
 */
export const AVATARS = [
  { key: "pawn", glyph: "♟", label: "Pawn" },
  { key: "knight", glyph: "♞", label: "Knight" },
  { key: "bishop", glyph: "♝", label: "Bishop" },
  { key: "rook", glyph: "♜", label: "Rook" },
  { key: "queen", glyph: "♛", label: "Queen" },
  { key: "king", glyph: "♚", label: "King" },
  { key: "fox", glyph: "🦊", label: "Fox" },
  { key: "cat", glyph: "🐱", label: "Cat" },
  { key: "dragon", glyph: "🐲", label: "Dragon" },
  { key: "robot", glyph: "🤖", label: "Robot" },
  { key: "rocket", glyph: "🚀", label: "Rocket" },
  { key: "ghost", glyph: "👻", label: "Ghost" },
] as const;

export type AvatarKey = (typeof AVATARS)[number]["key"];

const BY_KEY = new Map(AVATARS.map((a) => [a.key, a] as const));

export function isAvatarKey(value: string): value is AvatarKey {
  return BY_KEY.has(value as AvatarKey);
}

export function avatarGlyph(key: string): string {
  return BY_KEY.get(key as AvatarKey)?.glyph ?? "♟";
}
