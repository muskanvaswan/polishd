/**
 * Polishd — ingest (server only).
 *
 * Validates and sanitizes an inbound batch, then hands clean events to the
 * store. The session id is taken from the request's cookie, never from the
 * body, so events are always attributed to the bearer of the cookie.
 */
import {
  defaultPolishdConfig,
  isDashboardPath,
  resolveDashboardRoute,
  type PolishdConfig,
} from "../config";
import { isIgnorableError } from "../shared/error-noise";
import { CLIENT_EVENT_TYPES, type PolishdEvent } from "../shared/types";
import { getMeta, insertEvents, setMeta } from "./store";

const MAX_EVENTS_PER_BATCH = 200;
const MAX_TEXT_LEN = 120;
const MAX_SELECTOR_LEN = 300;
/**
 * `design_scan` events carry a whole page's design tallies as one JSON string
 * in `meta.payload`, so that one key gets a wider (but still bounded) cap than
 * the 500 chars every other meta value is clamped to. The client serializes to
 * ≤28KB (see client/design-scan.ts); anything beyond this is not ours.
 */
const MAX_DESIGN_PAYLOAD_LEN = 32_000;

/**
 * Beacons dropped for want of a session cookie, recorded in `polishd_meta`.
 *
 * A missing cookie means the proxy isn't running — a misnamed proxy file, a
 * matcher that excludes the path, or a botched merge with an existing handler.
 * Left uncounted this is the worst failure mode in the package: ingest returns
 * `ok: true` with HTTP 200, the client cannot read the reason (`sendBeacon`
 * has no response), and the only symptom is an empty dashboard with nothing
 * anywhere pointing at the cause. Counting it is what lets the dashboard say
 * so out loud.
 */
export const NO_SESSION_META_KEY = "no_session_rejects";

/** Shape stored under {@link NO_SESSION_META_KEY}. */
export interface NoSessionRecord {
  count: number;
  lastAt: number;
}

// A broken proxy means *every* beacon is rejected, so writing per rejection
// would answer a diagnostic with a write storm. Collapse them instead: count
// in memory, persist at most once a minute.
const RECORD_INTERVAL_MS = 60_000;
let lastPersistedAt = 0;
let unpersisted = 0;

async function recordNoSession(): Promise<void> {
  unpersisted++;
  const now = Date.now();
  if (now - lastPersistedAt < RECORD_INTERVAL_MS) return;
  lastPersistedAt = now;
  const batch = unpersisted;
  unpersisted = 0;
  try {
    let count = 0;
    const raw = await getMeta(NO_SESSION_META_KEY);
    if (raw) {
      const prev = JSON.parse(raw) as Partial<NoSessionRecord>;
      if (typeof prev.count === "number" && Number.isFinite(prev.count)) count = prev.count;
    }
    const next: NoSessionRecord = { count: count + batch, lastAt: now };
    await setMeta(NO_SESSION_META_KEY, JSON.stringify(next));
  } catch {
    // Diagnostics must never take ingest down with them. A store that can't
    // record the rejection still returns a clean result to the beacon.
  }
}

/**
 * True for a `js_error` the client should already have dropped: an extension's
 * throw, not the site's. The client filters these at capture, but a cached
 * bundle can predate that filter by a full session — and the endpoint is a
 * public POST — so the rule that actually holds lives here too, the same way
 * the dashboard-path exclusion does.
 *
 * Only `message` and `source` survive into the event; the stack the client
 * inspects is not sent, so this catches less than the client does. That's the
 * intended split: the client is the precise filter, this is the backstop.
 */
function isNoisyError(e: PolishdEvent, ignore: readonly (string | RegExp)[]): boolean {
  if (e.type !== "js_error") return false;
  const message = typeof e.meta?.message === "string" ? e.meta.message : "";
  const source = typeof e.meta?.source === "string" ? e.meta.source : "";
  return isIgnorableError({ message, source, ignore });
}

export interface IngestResult {
  ok: boolean;
  stored: number;
  reason?: string;
}

/**
 * Pull the anonymous session id from the cookie. Returns null when absent —
 * the middleware normally guarantees one, but a client with cookies disabled
 * legitimately has none, in which case we skip rather than error.
 */
export function sessionIdFromCookie(cookieValue: string | undefined): string | null {
  return cookieValue && cookieValue.length <= 64 ? cookieValue : null;
}

/** Validate + clamp a single raw event. Returns null to drop it. */
function sanitize(raw: unknown): PolishdEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;

  const type = e.type;
  if (typeof type !== "string" || !CLIENT_EVENT_TYPES.has(type as PolishdEvent["type"])) {
    return null;
  }
  const ts = typeof e.ts === "number" && Number.isFinite(e.ts) ? e.ts : Date.now();
  const path = typeof e.path === "string" ? e.path.slice(0, 512) : "/";

  const out: PolishdEvent = { type: type as PolishdEvent["type"], ts, path };

  if (typeof e.selector === "string") out.selector = e.selector.slice(0, MAX_SELECTOR_LEN);
  if (typeof e.component === "string") out.component = e.component.slice(0, 80);
  if (typeof e.text === "string") out.text = e.text.trim().slice(0, MAX_TEXT_LEN);
  if (typeof e.value === "number" && Number.isFinite(e.value)) out.value = e.value;

  if (e.meta && typeof e.meta === "object") {
    const meta: NonNullable<PolishdEvent["meta"]> = {};
    for (const [k, v] of Object.entries(e.meta as Record<string, unknown>)) {
      if (k.length > 40) continue;
      const cap = out.type === "design_scan" && k === "payload" ? MAX_DESIGN_PAYLOAD_LEN : 500;
      if (typeof v === "string") meta[k] = v.slice(0, cap);
      else if (typeof v === "number" || typeof v === "boolean" || v === null) meta[k] = v;
    }
    out.meta = meta;
  }
  return out;
}

/**
 * Ingest a raw request body. `cookieValue` is the session cookie's value.
 *
 * `config` carries the host app's overrides (the route handler forwards what it
 * was built with) so `enabled` and `dashboardRoute` mean the same thing here as
 * they do in the browser. It falls back to the defaults when omitted.
 */
export async function ingest(
  body: unknown,
  cookieValue: string | undefined,
  config: Partial<PolishdConfig> = {},
): Promise<IngestResult> {
  const cfg = { ...defaultPolishdConfig, ...config };
  // The host's explicit route wins; otherwise consult the registered route /
  // POLISHD_DASHBOARD_ROUTE, so a dashboard moved off /polishd is still
  // excluded even when the route handler wasn't handed a config object.
  const dashboardRoute = resolveDashboardRoute(config.dashboardRoute);
  const sessionId = sessionIdFromCookie(cookieValue);
  if (!sessionId) {
    await recordNoSession();
    return { ok: true, stored: 0, reason: "no_session" };
  }
  if (!cfg.enabled) return { ok: true, stored: 0, reason: "disabled" };

  const rawEvents = (body as { events?: unknown })?.events;
  if (!Array.isArray(rawEvents)) return { ok: false, stored: 0, reason: "no_events" };

  // The client already drops the dashboard's own traffic; this is the copy of
  // that rule that actually holds, since the endpoint is a public POST and a
  // cached client bundle can lag a config change by a full session.
  const events = rawEvents
    .slice(0, MAX_EVENTS_PER_BATCH)
    .map(sanitize)
    .filter(
      (e): e is PolishdEvent =>
        e !== null && !isDashboardPath(e.path, dashboardRoute) && !isNoisyError(e, cfg.ignoreErrors),
    );

  const stored = await insertEvents(sessionId, events);
  return { ok: true, stored };
}

// ── Cross-install telemetry ingest ───────────────────────────────────────────

/**
 * The shape a client-minted session id must satisfy. Loose enough for a UUID
 * or a short hash, tight enough that the column can never hold markup,
 * whitespace, or anything long enough to be a payload.
 */
const TELEMETRY_ID_RE = /^[A-Za-z0-9._-]{6,64}$/;

/** A plausible hostname: label characters only, sane length, no ports/paths. */
const HOSTNAME_RE = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/i;

/**
 * Derive the reporting installation's identity — its hostname — from request
 * headers.
 *
 * The `Origin` header is the honest source: the browser sets it on every
 * cross-origin POST and page script cannot forge it, so it names the site the
 * dashboard actually runs on. A request without one (same-origin in some
 * browsers, server-to-server) falls back to `Host`. A *malformed* Origin gets
 * no fallback — a client that sends the header wrong is not one to guess for.
 * Returns null when no acceptable hostname can be derived; ports are dropped
 * so one install's dev server isn't split across restarts.
 */
export function telemetryInstallId(origin: string | null, host: string | null): string | null {
  if (origin && origin !== "null") {
    try {
      const hostname = new URL(origin).hostname;
      return HOSTNAME_RE.test(hostname) ? hostname.toLowerCase() : null;
    } catch {
      return null;
    }
  }
  if (host) {
    const hostname = host.split(":")[0];
    if (HOSTNAME_RE.test(hostname)) return hostname.toLowerCase();
  }
  return null;
}

/**
 * Ingest a telemetry batch from a *remote* polishd installation.
 *
 * This differs from first-party {@link ingest} in exactly three ways, each a
 * consequence of the request crossing origins:
 *
 *  1. Identity is split between body and headers. The session cookie is
 *     httpOnly and first-party, so it never arrives here; the emitter mints
 *     an anonymous session id itself, and the *installation* is identified by
 *     `installId` — the hostname the route derived from the Origin header via
 *     {@link telemetryInstallId}. It is validated by shape only; the worst a
 *     forger achieves is polluting telemetry, same as any public endpoint.
 *  2. Every stored row is tagged with the `installId`, so one shared database
 *     can tell installations apart — and name them by domain.
 *  3. Dashboard paths are NOT dropped. Recording how the dashboard itself is
 *     used is the entire point of this channel; the emitter is expected to
 *     namespace its paths so they can't collide with the receiving site's own
 *     first-party events.
 */
export async function ingestTelemetry(
  body: unknown,
  installId: string | null,
  config: Partial<PolishdConfig> = {},
): Promise<IngestResult> {
  const cfg = { ...defaultPolishdConfig, ...config };
  if (!cfg.enabled) return { ok: true, stored: 0, reason: "disabled" };
  if (!installId) return { ok: false, stored: 0, reason: "bad_identity" };

  const b = body as Partial<Record<"sessionId" | "events", unknown>> | null;
  const sessionId =
    typeof b?.sessionId === "string" && TELEMETRY_ID_RE.test(b.sessionId)
      ? b.sessionId
      : null;
  if (!sessionId) return { ok: false, stored: 0, reason: "bad_identity" };

  const rawEvents = b?.events;
  if (!Array.isArray(rawEvents)) return { ok: false, stored: 0, reason: "no_events" };

  const events = rawEvents
    .slice(0, MAX_EVENTS_PER_BATCH)
    .map(sanitize)
    .filter((e): e is PolishdEvent => e !== null && !isNoisyError(e, cfg.ignoreErrors));

  const stored = await insertEvents(sessionId, events, installId);
  return { ok: true, stored };
}
