/**
 * Polishd — shared event schema.
 *
 * This module is the single source of truth for the shape of every behavioral
 * signal Polishd captures. It is imported by the client capture layer, the
 * ingest route, and the dashboard queries, so it must stay dependency-free and
 * runtime-agnostic (no Node, no DOM types beyond primitives).
 *
 * Designed for clean extraction into `@polishd/next` — nothing here knows about
 * the host notes app.
 */

/** Every kind of signal we capture. Ordered roughly by synthesis value. */
export type PolishdEventType =
  | "page_view" // a route was viewed (initial load or soft navigation)
  | "click" // a normal click on an element
  | "rage_click" // 3+ rapid clicks on the same element (frustration)
  | "dead_click" // a click on a non-interactive element (confusion)
  | "scroll_depth" // max scroll reached on a page before leaving it
  | "viewport" // device/viewport size sampled once at session start
  | "js_error" // an uncaught error or unhandled rejection
  | "web_vital" // a Core Web Vital sample (LCP, CLS, INP)
  | "hover" // pointer dwell on an explicitly tracked component; value = ms
  | "component_view" // time a PolishdMonitor component spent in the viewport; value = ms
  | "mount" // a content-tracked PolishdMonitor component was rendered (mounted)
  | "session_end" // the session's last page was unloaded
  | "design_scan"; // one page's rendered design metrics (fonts, colors, radii, spacing)

/**
 * A single captured event. The client sends these without a session id; the
 * ingest layer attaches `session_id` server-side from the signed cookie, so a
 * client can never spoof another session.
 */
export interface PolishdEvent {
  type: PolishdEventType;
  /** Client clock, ms since epoch. Used for ordering and rage-click windows. */
  ts: number;
  /** Pathname the event occurred on, e.g. "/posts/my-note". No query string. */
  path: string;
  /** Best-effort CSS selector path to the target element. */
  selector?: string;
  /** `data-component` hint, walked up from the target. Key to synthesis. */
  component?: string;
  /** Short, truncated element text — labels only, never user-typed content. */
  text?: string;
  /**
   * Numeric payload whose meaning depends on `type`:
   * - scroll_depth: percent 0–100
   * - web_vital: the metric value (ms, or unitless for CLS)
   * - viewport: viewport width in CSS pixels
   */
  value?: number;
  /** Small, typed extras keyed by event type (e.g. vital name, error message). */
  meta?: Record<string, string | number | boolean | null>;
}

/** What the client POSTs to the ingest route. */
export interface PolishdIngestBody {
  events: PolishdEvent[];
  /** Page that produced this batch, for sanity/debugging. */
  page?: string;
}

/** A stored event row, as it comes back from the database. */
export interface PolishdEventRow extends PolishdEvent {
  id: number;
  session_id: string;
  /** Server receive time, ms since epoch — authoritative for retention. */
  received_at: number;
}

/** The set of event types the client is allowed to send. */
export const CLIENT_EVENT_TYPES: ReadonlySet<PolishdEventType> = new Set<PolishdEventType>([
  "page_view",
  "click",
  "rage_click",
  "dead_click",
  "scroll_depth",
  "viewport",
  "js_error",
  "web_vital",
  "hover",
  "component_view",
  "mount",
  "session_end",
  "design_scan",
]);

// ── Design scan payload ──────────────────────────────────────────────────────
// A `design_scan` event carries one page's rendered design metrics, sampled
// from computed styles after the page settles. The payload is a compact,
// tally-based JSON string stored in `meta.payload` (tuples, not objects, to
// keep one page under a few KB). Shared here so the client that writes it and
// the server that aggregates it can never drift.

/** [family, sizePx, weight, count, sampleText, tagList] */
export type DesignFontTuple = [string, number, number, number, string, string];
/** [hex, count] */
export type DesignColorTuple = [string, number];
/** [fgHex, bgHex, count, minSizePx, boldAtMinSize(0|1)] */
export type DesignPairTuple = [string, string, number, number, 0 | 1];
/** [radiusValue, count] — e.g. ["8px", 14] or ["9999px", 3] */
export type DesignRadiusTuple = [string, number];
/** [paddingPx, count] */
export type DesignPadTuple = [number, number];

export interface PolishdDesignScanPayload {
  /** Payload schema version. */
  v: 1;
  /** Elements sampled on the page. */
  el: number;
  /** Typography tallies: distinct family/size/weight combinations. */
  fonts: DesignFontTuple[];
  /** Text color tallies (elements with direct text). */
  text: DesignColorTuple[];
  /** Background color tallies (non-transparent own backgrounds). */
  bg: DesignColorTuple[];
  /** Border color tallies (visible borders only). */
  border: DesignColorTuple[];
  /** Text-on-background pairs, for contrast checking. */
  pairs: DesignPairTuple[];
  /** Border-radius tallies (elements whose radius is visible). */
  radii: DesignRadiusTuple[];
  /** Padding tallies (per side, boxy/interactive elements only). */
  pad: DesignPadTuple[];
}
