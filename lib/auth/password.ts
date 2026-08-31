import { hash, verify } from "@node-rs/argon2";

/**
 * Password rules are deliberately gentle. These are children on family
 * devices in a closed club, and a password a 7-year-old can't type is a
 * password a parent ends up typing for them every time.
 */
export const MIN_PASSWORD_LENGTH = 6;
export const MAX_PASSWORD_LENGTH = 200;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain);
}

export async function verifyPassword(
  storedHash: string,
  plain: string,
): Promise<boolean> {
  try {
    return await verify(storedHash, plain);
  } catch {
    return false;
  }
}
