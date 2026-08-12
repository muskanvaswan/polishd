/**
 * Polishd — shared configuration.
 *
 * This object holds ONLY non-secret, client-safe settings: it is imported by
 * both the browser capture layer and the server. Secrets (database URLs,
 * Anthropic keys) never live here — they are read from `process.env` on the
 * server only. See `server/store.ts`.
 *
 * The host app can override any of these by editing the root `polishd.config.ts`
 * re-export, which keeps the public surface in one obvious place.
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

/** Type-checked helper for the host app's root `polishd.config.ts`. */
export function definePolishdConfig(overrides: Partial<PolishdConfig>): PolishdConfig {
  return { ...defaultPolishdConfig, ...overrides };
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
