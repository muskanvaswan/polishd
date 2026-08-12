/**
 * Polishd — built-in token auth (server only).
 *
 * For the most common deployment shape there is: an app with no authentication
 * of its own that still needs the dashboard protected, because the dashboard
 * can change the configured model and API base URL and therefore spend the
 * owner's key.
 *
 * Doing this correctly by hand requires knowing several things a typical user
 * has no reason to know: that server components can't set cookies but server
 * actions can, that the comparison must be constant-time, that a token in a
 * query string leaks through `Referer` and browser history, and that the
 * dashboard's server actions need guarding separately from the page. None of
 * that is app-specific, so it belongs here.
 *
 * The design deliberately avoids putting the secret in a URL at any point: the
 * token is presented through a form, exchanged for an httpOnly cookie by a
 * server action, and never appears in history, logs, or a `Referer` header.
 *
 * What the cookie holds is an HMAC of the token, not the token itself, so a
 * leaked cookie jar does not hand over the reusable secret. The grant is still
 * a bearer credential — that is inherent to cookie auth — but it is scoped to
 * the dashboard's path, carries its own issue time, and expires server-side
 * rather than trusting the browser to forget it.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";

import type { PolishdAuthContext, PolishdAuthenticate } from "../ai/guard";

/** Name of the grant cookie. Distinct from the anonymous analytics session. */
export const POLISHD_DASHBOARD_COOKIE = "polishd_dashboard";

/** Domain-separates this HMAC from any other use of the same secret. */
const GRANT_CONTEXT = "polishd-dashboard-grant-v1";

const DEFAULT_MAX_AGE_S = 60 * 60 * 24 * 7; // one week

export interface PolishdTokenAuthOptions {
  /**
   * Path the dashboard is mounted at. Scopes the grant cookie so it never
   * rides along on ordinary requests to the host app, and is where a
   * successful unlock redirects to.
   *
   * Defaults to what `polishd init` scaffolds. Set it if you moved the page.
   * @default "/polishd"
   */
  basePath?: string;
  /** How long a grant stays valid, in seconds. @default 604800 (one week) */
  maxAgeSeconds?: number;
}

interface ResolvedOptions {
  basePath: string;
  maxAgeSeconds: number;
}

// The unlock action is a standalone module-level export — Next needs a stable
// action identity — so it can't be handed options as arguments. The page
// factory records them here at module evaluation, the same way the auth policy
// itself is registered. See ai/guard.ts.
let options: ResolvedOptions = {
  basePath: "/polishd",
  maxAgeSeconds: DEFAULT_MAX_AGE_S,
};

export function registerPolishdTokenOptions(opts: PolishdTokenAuthOptions = {}): void {
  options = {
    basePath: opts.basePath ?? options.basePath,
    maxAgeSeconds: opts.maxAgeSeconds ?? options.maxAgeSeconds,
  };
}

export function polishdTokenOptions(): ResolvedOptions {
  return options;
}

/** The configured token, or null when the host hasn't set one. */
export function polishdDashboardToken(): string | null {
  const token = process.env.POLISHD_DASHBOARD_TOKEN;
  return token && token.length > 0 ? token : null;
}

/**
 * Compare without leaking, through the first differing byte or through length.
 *
 * `timingSafeEqual` throws on unequal lengths, which would itself be a length
 * oracle, so both sides are hashed to a fixed width first.
 */
export function tokensMatch(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}

/** Build the cookie value proving possession of `token` at `issuedAt`. */
function grantFor(token: string, issuedAt: number): string {
  const mac = createHmac("sha256", token)
    .update(`${GRANT_CONTEXT}.${issuedAt}`)
    .digest("base64url");
  return `${issuedAt}.${mac}`;
}

/** Mint a fresh grant for the current token. */
export function mintGrant(token: string): string {
  return grantFor(token, Date.now());
}

/**
 * Verify a grant cookie against the configured token.
 *
 * Expiry is enforced here rather than left to the cookie's `maxAge`: a client
 * decides how long to keep a cookie, so the server has to decide how long to
 * accept one.
 */
export function verifyGrant(
  value: string | undefined,
  token: string,
  maxAgeSeconds: number,
): boolean {
  if (!value) return false;
  const dot = value.indexOf(".");
  if (dot <= 0) return false;
  const issuedAt = Number(value.slice(0, dot));
  if (!Number.isFinite(issuedAt)) return false;
  const age = Date.now() - issuedAt;
  if (age < 0 || age > maxAgeSeconds * 1000) return false;
  return tokensMatch(value, grantFor(token, issuedAt));
}

/**
 * An `authenticate` callback backed by `POLISHD_DASHBOARD_TOKEN`.
 *
 *   export default createPolishdPage({ authenticate: polishdTokenAuth() });
 *
 * Used automatically when the env var is set and no other `authenticate` is
 * passed, so most hosts never name it explicitly.
 */
export function polishdTokenAuth(opts: PolishdTokenAuthOptions = {}): PolishdAuthenticate {
  registerPolishdTokenOptions(opts);
  // Reads the cookie off the context rather than calling `cookies()` itself,
  // which is what makes it exercisable outside a live request.
  return async function authenticate(ctx: PolishdAuthContext): Promise<boolean> {
    const token = polishdDashboardToken();
    // No token configured means no grant can ever be valid. Denying is the
    // only safe reading — an unset secret must not mean "let everyone in".
    if (!token) return false;
    return verifyGrant(
      ctx.cookies.get(POLISHD_DASHBOARD_COOKIE)?.value,
      token,
      options.maxAgeSeconds,
    );
  };
}

// ── Brute-force damping ──────────────────────────────────────────────────────
// Per-instance and in-memory: it survives neither a restart nor a second
// serverless instance, so it is a speed bump rather than a security boundary.
// The security boundary is the token's own entropy — the docs say to generate
// it with `openssl rand -hex 32`, not to pick one. What this does buy is that
// a single instance can't be walked through a large keyspace quickly.
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS_PER_WINDOW = 10;
const attempts = new Map<string, { count: number; resetAt: number }>();

function clientKey(h: Headers): string {
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return h.get("x-real-ip") ?? "unknown";
}

/** Returns false when the caller has spent its attempts for this window. */
export function takeAttempt(h: Headers): boolean {
  const key = clientKey(h);
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || now > rec.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    // Opportunistic sweep — this map must not grow without bound.
    if (attempts.size > 1024) {
      for (const [k, v] of attempts) if (now > v.resetAt) attempts.delete(k);
    }
    return true;
  }
  if (rec.count >= MAX_ATTEMPTS_PER_WINDOW) return false;
  rec.count++;
  return true;
}

/** Read the request headers for rate limiting. Separate for testability. */
export async function requestHeaders(): Promise<Headers> {
  return (await headers()) as unknown as Headers;
}
