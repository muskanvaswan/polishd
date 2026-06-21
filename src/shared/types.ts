/**
 * Buffd — shared event schema.
 *
 * This module is the single source of truth for the shape of every behavioral
 * signal Buffd captures. It is imported by the client capture layer, the
 * ingest route, and the dashboard queries, so it must stay dependency-free and
 * runtime-agnostic (no Node, no DOM types beyond primitives).
 *
 * Designed for clean extraction into `@buffd/next` — nothing here knows about
 * the host notes app.
 */

/** Every kind of signal we capture. Ordered roughly by synthesis value. */
export type BuffdEventType =
  | "page_view" // a route was viewed (initial load or soft navigation)
  | "click" // a normal click on an element
  | "rage_click" // 3+ rapid clicks on the same element (frustration)
  | "dead_click" // a click on a non-interactive element (confusion)
  | "scroll_depth" // max scroll reached on a page before leaving it
  | "viewport" // device/viewport size sampled once at session start
  | "js_error" // an uncaught error or unhandled rejection
  | "web_vital" // a Core Web Vital sample (LCP, CLS, INP)
  | "hover" // pointer dwell on an explicitly tracked component; value = ms
  | "component_view" // time a BuffdMonitor component spent in the viewport; value = ms
  | "mount" // a content-tracked BuffdMonitor component was rendered (mounted)
  | "session_end"; // the session's last page was unloaded

/**
 * A single captured event. The client sends these without a session id; the
 * ingest layer attaches `session_id` server-side from the signed cookie, so a
 * client can never spoof another session.
 */
export interface BuffdEvent {
  type: BuffdEventType;
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
export interface BuffdIngestBody {
  events: BuffdEvent[];
  /** Page that produced this batch, for sanity/debugging. */
  page?: string;
}

/** A stored event row, as it comes back from the database. */
export interface BuffdEventRow extends BuffdEvent {
  id: number;
  session_id: string;
  /** Server receive time, ms since epoch — authoritative for retention. */
  received_at: number;
}

/** The set of event types the client is allowed to send. */
export const CLIENT_EVENT_TYPES: ReadonlySet<BuffdEventType> = new Set<BuffdEventType>([
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
]);
