import { createHash, randomBytes } from "node:crypto";

/**
 * Opaque secrets (session tokens, invitation tokens) are generated here and
 * stored only as SHA-256 hashes. Lookups are by hash, so a leaked database
 * hands out no live sessions and no usable invitation links.
 */

export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
