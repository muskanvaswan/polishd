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
import { sanitizeBuild } from "../shared/build";
import { foldNoSessionDrop, parseNoSessionRecord } from "../shared/capture-status";
import { normalizeLabel, reclassifiedClickType } from "../shared/text-signals";
import { CLIENT_EVENT_TYPES, type PolishdEvent } from "../shared/types";
import { resolveServerBuild } from "./build";
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
 * The window a client timestamp must fall in to be believed. Trends bucket on
 * the client's `ts`, so one event stamped in the year 5000 (or 1970) stretches
 * every "All time" axis to cover it. Backdated events are legitimate — seed
 * scripts and replays post history — so the floor is a fixed date, not "now";
 * the ceiling allows for a fast device clock. Anything outside takes the
 * server's receive time instead of being dropped.
 */
const MIN_EVENT_TS = Date.UTC(2020, 0, 1);
const MAX_EVENT_TS_AHEAD_MS = 24 * 60 * 60 * 1000;

/** The client's timestamp when it is plausible, the server's otherwise. */
export function plausibleTs(raw: unknown, now: number = Date.now()): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return now;
  return raw >= MIN_EVENT_TS && raw <= now + MAX_EVENT_TS_AHEAD_MS ? raw : now;
}

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

/**
 * `doctor --url` proves the write path end to end, and it is routinely pointed
 * at a production origin. Storing its test event there put a fake page and a
 * fake session into the owner's real numbers, so a probe is answered with a
 * write to `polishd_meta` instead: the same backend, nothing in `events`.
 *
 * Doctors before this sent a lone page view to {@link DOCTOR_PROBE_PATH}
 * rather than `probe: true`; that batch is recognised as a probe too, so an
 * older CLI pointed at a newer site no longer pollutes it either.
 */
export const DOCTOR_PROBE_META_KEY = "doctor_probe";
export const DOCTOR_PROBE_PATH = "/__polishd_doctor";

function isDoctorProbe(b: { events?: unknown; probe?: unknown } | null): boolean {
  if (b?.probe === true) return true;
  const events = b?.events;
  return (
    Array.isArray(events) &&
    events.length > 0 &&
    events.every((e) => (e as { path?: unknown } | null)?.path === DOCTOR_PROBE_PATH)
  );
}

/** Re-exported so callers keep importing the record shape from ingest. */
export type { NoSessionRecord } from "../shared/capture-status";

// A broken proxy means *every* beacon is rejected, so writing per rejection
// would answer a diagnostic with a write storm. Collapse them instead: count
// in memory, persist at most once a minute.
//
// The in-memory half of that only works while the module stays alive. On
// serverless every cold start resets it, so sparse traffic — scattered bot
// POSTs, exactly the noise the throttle exists to absorb — used to persist
// roughly 1:1. The stored `lastAt` is the half that survives, so it gates the
// write too: a fresh instance reads what the last one wrote and stays quiet
// if the minute isn't up. Its own tally is then lost with the instance, which
// is the right trade — this counter is a health signal, not an audit log, and
// under-reporting scattered noise is the behaviour that was intended all
// along. A genuinely broken proxy still writes every minute, and the
// dashboard's real evidence there is that nothing is being stored at all.
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
    const prev = parseNoSessionRecord(await getMeta(NO_SESSION_META_KEY));
    if (prev && now - prev.lastAt < RECORD_INTERVAL_MS) {
      // Another invocation (or this one) wrote inside the minute. Hand the
      // tally back so a warm instance folds it into the next write.
      unpersisted += batch;
      return;
    }
    await setMeta(NO_SESSION_META_KEY, JSON.stringify(foldNoSessionDrop(prev, now, batch)));
  } catch {
    // Diagnostics must never take ingest down with them. A store that can't
    // record the rejection still returns a clean result to the beacon.
  }
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
  const ts = plausibleTs(e.ts);
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

  // The current client never records a dead/rage click on text (reading, not
  // friction) — but a cached bundle can lag that rule by a full session, and a
  // telemetry emitter on an older package by whole releases. So the rule that
  // actually holds lives here too: retype stragglers to `text_click`, exactly
  // what the one-time sweep does to rows already stored.
  out.type = reclassifiedClickType(out.type, out.selector, out.text) as PolishdEvent["type"];

  // Same reasoning for click labels: current clients fold digit runs to `#`
  // so "Show 9 more" and "Show 12 more" count as one control, and an older
  // bundle — or an older install's telemetry — gets the same treatment here.
  // After the retype, whose length test mirrors the client's raw-text check.
  if (out.type === "click" || out.type === "rage_click" || out.type === "dead_click") {
    out.text = normalizeLabel(out.text);
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

  const b = body as { events?: unknown; build?: unknown; probe?: unknown } | null;
  if (isDoctorProbe(b)) {
    const written = await setMeta(DOCTOR_PROBE_META_KEY, String(Date.now()));
    return { ok: true, stored: 0, reason: written ? "probe" : "probe_unwritable" };
  }
  const rawEvents = b?.events;
  if (!Array.isArray(rawEvents)) return { ok: false, stored: 0, reason: "no_events" };

  // The client already drops the dashboard's own traffic; this is the copy of
  // that rule that actually holds, since the endpoint is a public POST and a
  // cached client bundle can lag a config change by a full session.
  const events = rawEvents
    .slice(0, MAX_EVENTS_PER_BATCH)
    .map(sanitize)
    .filter((e): e is PolishdEvent => e !== null && !isDashboardPath(e.path, dashboardRoute));

  // The build the page was served from, as the client reports it — it knows
  // which bundle it is, where the server can only say which one it deploys.
  // A batch without one takes the server's build, so events are still placed
  // in a build on hosts that never set a public variable for the client.
  const build = sanitizeBuild(b?.build) ?? (await resolveServerBuild());

  const stored = await insertEvents(sessionId, events, { build });
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

  const b = body as Partial<Record<"sessionId" | "events" | "build", unknown>> | null;
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
    .filter((e): e is PolishdEvent => e !== null);

  // A remote dashboard's "build" is the polishd version it runs (the emitter
  // sends its package version). The collecting server's own build means
  // nothing for someone else's install, so there is no server fallback here.
  const build = sanitizeBuild(b?.build);

  const stored = await insertEvents(sessionId, events, { installId, build });
  return { ok: true, stored };
}
