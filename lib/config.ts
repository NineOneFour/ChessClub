/**
 * Runtime configuration, read once from the environment.
 *
 * Everything the app needs to know about *where it lives* goes here so that
 * nothing else has to reach into `process.env` and guess.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

/** The URL members reach the club at, e.g. https://chess.vsakis.com */
export const PUBLIC_ORIGIN = (
  process.env.PUBLIC_ORIGIN ?? "http://localhost:3000"
).replace(/\/$/, "");

/**
 * Session cookies are marked Secure whenever the public origin is https,
 * even though the app itself is served over http behind the reverse proxy.
 */
export const COOKIE_SECURE = PUBLIC_ORIGIN.startsWith("https://");

export const DATABASE_URL = () => required("DATABASE_URL");

export const REALTIME_PORT = Number(process.env.REALTIME_PORT ?? 3001);

export const SESSION_COOKIE = "chessclub_session";

/** How long a login lasts. Long, deliberately: these are kids on family devices. */
export const SESSION_TTL_DAYS = 30;

/** How long an unused invitation link stays valid. */
export const INVITATION_TTL_DAYS = 14;

/**
 * A member counts as online while the realtime service holds at least one
 * connection for them AND that record was refreshed recently. The freshness
 * check means a crashed realtime service can't leave the clubhouse looking
 * busy forever.
 */
export const PRESENCE_STALE_SECONDS = 90;
