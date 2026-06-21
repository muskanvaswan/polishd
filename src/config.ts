/**
 * Buffd — shared configuration.
 *
 * This object holds ONLY non-secret, client-safe settings: it is imported by
 * both the browser capture layer and the server. Secrets (database URLs,
 * Anthropic keys) never live here — they are read from `process.env` on the
 * server only. See `server/store.ts`.
 *
 * The host app can override any of these by editing the root `buffd.config.ts`
 * re-export, which keeps the public surface in one obvious place.
 */

export interface BuffdConfig {
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
  /** Local SQLite file used in dev. Ignored when BUFFD_DATABASE_URL is set. */
  databasePath: string;
  /** Name of the anonymous session cookie set by the middleware. */
  sessionCookie: string;
}

export const defaultBuffdConfig: BuffdConfig = {
  enabled: true,
  apiRoute: "/api/buffd",
  flushIntervalMs: 10_000,
  maxBatchSize: 50,
  sampleRate: 1,
  rageClick: { count: 3, windowMs: 500 },
  databasePath: ".buffd/analytics.db",
  sessionCookie: "buffd_session",
};

/** Type-checked helper for the host app's root `buffd.config.ts`. */
export function defineBuffdConfig(overrides: Partial<BuffdConfig>): BuffdConfig {
  return { ...defaultBuffdConfig, ...overrides };
}
