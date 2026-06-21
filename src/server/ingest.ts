/**
 * Buffd — ingest (server only).
 *
 * Validates and sanitizes an inbound batch, then hands clean events to the
 * store. The session id is taken from the request's cookie, never from the
 * body, so events are always attributed to the bearer of the cookie.
 */
import { defaultBuffdConfig } from "../config";
import { CLIENT_EVENT_TYPES, type BuffdEvent } from "../shared/types";
import { insertEvents } from "./store";

const MAX_EVENTS_PER_BATCH = 200;
const MAX_TEXT_LEN = 120;
const MAX_SELECTOR_LEN = 300;

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
function sanitize(raw: unknown): BuffdEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;

  const type = e.type;
  if (typeof type !== "string" || !CLIENT_EVENT_TYPES.has(type as BuffdEvent["type"])) {
    return null;
  }
  const ts = typeof e.ts === "number" && Number.isFinite(e.ts) ? e.ts : Date.now();
  const path = typeof e.path === "string" ? e.path.slice(0, 512) : "/";

  const out: BuffdEvent = { type: type as BuffdEvent["type"], ts, path };

  if (typeof e.selector === "string") out.selector = e.selector.slice(0, MAX_SELECTOR_LEN);
  if (typeof e.component === "string") out.component = e.component.slice(0, 80);
  if (typeof e.text === "string") out.text = e.text.trim().slice(0, MAX_TEXT_LEN);
  if (typeof e.value === "number" && Number.isFinite(e.value)) out.value = e.value;

  if (e.meta && typeof e.meta === "object") {
    const meta: NonNullable<BuffdEvent["meta"]> = {};
    for (const [k, v] of Object.entries(e.meta as Record<string, unknown>)) {
      if (k.length > 40) continue;
      if (typeof v === "string") meta[k] = v.slice(0, 500);
      else if (typeof v === "number" || typeof v === "boolean" || v === null) meta[k] = v;
    }
    out.meta = meta;
  }
  return out;
}

/** Ingest a raw request body. `cookieValue` is the session cookie's value. */
export async function ingest(
  body: unknown,
  cookieValue: string | undefined,
): Promise<IngestResult> {
  const sessionId = sessionIdFromCookie(cookieValue);
  if (!sessionId) return { ok: true, stored: 0, reason: "no_session" };
  if (!defaultBuffdConfig.enabled) return { ok: true, stored: 0, reason: "disabled" };

  const rawEvents = (body as { events?: unknown })?.events;
  if (!Array.isArray(rawEvents)) return { ok: false, stored: 0, reason: "no_events" };

  const events = rawEvents
    .slice(0, MAX_EVENTS_PER_BATCH)
    .map(sanitize)
    .filter((e): e is BuffdEvent => e !== null);

  const stored = await insertEvents(sessionId, events);
  return { ok: true, stored };
}
