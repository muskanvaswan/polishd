/**
 * Polishd — shared configuration.
 *
 * This object holds ONLY non-secret, client-safe settings: it is imported by
 * both the browser capture layer and the server. Secrets (database URLs,
 * Anthropic keys) never live here — they are read from `process.env` on the
 * server only. See `server/store.ts`.
 *
 * A root `polishd.config.ts` is a convenience for keeping your overrides in one
 * file — but nothing imports it for you. Whatever it exports has to be passed
 * to `initPolishd()`, `createPolishdRoute()` and your proxy explicitly. See
 * `definePolishdConfig` below.
 */

export interface PolishdConfig {
  /** Whether capture is active at all. Disable to fully no-op the client. */
  enabled: boolean;
  /** Route the client flushes batches to. Must match the api route handler. */
  apiRoute: string;
  /** Flush cadence in ms. The client also flushes on pagehide. */
  flushIntervalMs: number;
  /** Max events held before forcing an early flush (caps memory + payload). */
  maxBatchSize: number;
  /** Fraction of sessions to capture, 0–1. 1 = everyone. */
  sampleRate: number;
  /** Rage-click detection: N clicks on one element within `windowMs`. */
  rageClick: { count: number; windowMs: number };
  /** Local SQLite file used in dev. Ignored when POLISHD_DATABASE_URL is set. */
  databasePath: string;
  /** Name of the anonymous session cookie set by the middleware. */
  sessionCookie: string;
  /**
   * Route the dashboard itself is mounted at. Nothing that happens on this
   * route (or below it) is ever captured — the dashboard is a tool for reading
   * the story, not part of the story, and its own clicks would otherwise show
   * up as the site's most-used feature. Change this only if you mounted
   * `createPolishdPage()` somewhere other than `/polishd`.
   */
  dashboardRoute: string;
}

export const defaultPolishdConfig: PolishdConfig = {
  enabled: true,
  apiRoute: "/api/polishd",
  flushIntervalMs: 10_000,
  maxBatchSize: 50,
  sampleRate: 1,
  rageClick: { count: 3, windowMs: 500 },
  databasePath: ".polishd/analytics.db",
  sessionCookie: "polishd_session",
  dashboardRoute: "/polishd",
};

/**
 * Type-checked helper for the host app's root `polishd.config.ts`.
 *
 * Important: this file is **not** loaded automatically. It cannot be — the
 * three places that need config run in three different runtimes (the browser,
 * the Edge proxy, and the Node route handler), and the Edge one has no
 * filesystem to read it from. So the object it returns has to be threaded to
 * each of them by hand:
 *
 *   import polishd from "@/polishd.config";
 *   initPolishd(polishd);                        // instrumentation-client.ts
 *   export const POST = createPolishdRoute(polishd);  // api/polishd/route.ts
 *   const { proxy } = createPolishdProxy(polishd);    // proxy.ts
 *
 * Miss one and the layers disagree silently: a client posting to one route
 * while the handler reads another, or a proxy minting `a` while ingest looks
 * for `b`, which presents as the empty dashboard described in
 * {@link resolveSessionCookie}.
 *
 * For `sessionCookie` specifically, prefer `POLISHD_SESSION_COOKIE` — it is
 * the one channel all three runtimes can read, so it cannot go half-applied.
 */
export function definePolishdConfig(overrides: Partial<PolishdConfig>): PolishdConfig {
  return { ...defaultPolishdConfig, ...overrides };
}

/**
 * Resolve the session cookie name from the one source every runtime shares.
 *
 * The cookie name is the single setting that *must* agree across process
 * boundaries: the proxy mints it at the Edge and the ingest route reads it in
 * Node. If those two disagree, every beacon arrives without a recognised
 * session and is dropped — the same silent, 200-returning, empty-dashboard
 * failure as a proxy that never ran at all.
 *
 * An explicit argument still wins, for anyone threading a config object
 * deliberately. Absent that, `POLISHD_SESSION_COOKIE` is read directly, which
 * both runtimes can do, so a single env var keeps them in step with nothing to
 * remember.
 */
export function resolveSessionCookie(override?: string): string {
  if (override) return override;
  const fromEnv = process.env.POLISHD_SESSION_COOKIE;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return defaultPolishdConfig.sessionCookie;
}

/**
 * True when `path` is the dashboard route or a page beneath it. The single
 * definition of "this is the dashboard's own traffic", shared by the browser
 * capture layer and the ingest endpoint so the two can't drift.
 *
 * A blank route disables the exclusion rather than matching everything.
 */
export function isDashboardPath(path: string, route: string): boolean {
  const r = route.replace(/\/+$/, "");
  if (!r) return false;
  return path === r || path.startsWith(`${r}/`);
}
