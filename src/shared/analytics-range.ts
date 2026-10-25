/**
 * Polishd — the Analytics tab's range: how far back its figures reach.
 *
 * The tab's numbers were all-time totals, which say how much and never when.
 * The range scopes every section of the tab at once — the tiles and their
 * charts, top pages, elements, journeys, errors — to a window of days, or to
 * the events of one build. It travels in the URL (`?range=7d`), so a view is
 * a link, and it parses from an allowlist so nothing from the query string
 * reaches a query except a number of milliseconds or a sanitized build label.
 *
 * Pure: the dashboard resolves "this build" to a label and the loaders turn
 * the range into a filter (see server/queries.ts `EventFilter`).
 */
import { sanitizeBuild } from "./build";

/** A fixed window, measured back from now. */
export type AnalyticsWindow = "24h" | "7d" | "30d" | "90d";

/**
 * What the tab shows: a window, everything, the build currently receiving
 * events, or one named build (from the Builds table).
 */
export type AnalyticsRange = AnalyticsWindow | "all" | "build" | `build:${string}`;

const DAY_MS = 86_400_000;

export const ANALYTICS_WINDOWS: { id: AnalyticsWindow; label: string; ms: number }[] = [
  { id: "24h", label: "24h", ms: DAY_MS },
  { id: "7d", label: "7 days", ms: 7 * DAY_MS },
  { id: "30d", label: "30 days", ms: 30 * DAY_MS },
  { id: "90d", label: "90 days", ms: 90 * DAY_MS },
];

/** The range the tab opens on: all time, as it always has. */
export const DEFAULT_ANALYTICS_RANGE: AnalyticsRange = "all";

/**
 * A query-string value as a range, falling back to the default for anything
 * that isn't one. `build:<label>` keeps only a label that passes the same
 * check ingest applies, so it's inert in SQL and in a class name.
 */
export function parseAnalyticsRange(raw: unknown): AnalyticsRange {
  if (typeof raw !== "string") return DEFAULT_ANALYTICS_RANGE;
  if (raw === "all" || raw === "build") return raw;
  if (ANALYTICS_WINDOWS.some((w) => w.id === raw)) return raw as AnalyticsWindow;
  if (raw.startsWith("build:")) {
    const build = sanitizeBuild(raw.slice("build:".length));
    return build ? `build:${build}` : DEFAULT_ANALYTICS_RANGE;
  }
  return DEFAULT_ANALYTICS_RANGE;
}

/** The named build of a `build:<label>` range, else null. */
export function rangeBuild(range: AnalyticsRange): string | null {
  return range.startsWith("build:") ? range.slice("build:".length) : null;
}

/** When a windowed range starts, ms since epoch; null when it isn't a window. */
export function rangeSince(range: AnalyticsRange, now: number = Date.now()): number | null {
  const window = ANALYTICS_WINDOWS.find((w) => w.id === range);
  return window ? now - window.ms : null;
}

/**
 * The range in prose, to finish "Totals for …" or "The tile counts …":
 * "all time", "the last 7 days", "this build", "build f804613".
 */
export function rangeLabel(range: AnalyticsRange, buildLabel?: string | null): string {
  if (range === "all") return "all time";
  if (range === "24h") return "the last 24 hours";
  if (range === "build") return buildLabel ? `build ${buildLabel}` : "this build";
  const named = rangeBuild(range);
  if (named) return `build ${buildLabel ?? named}`;
  const window = ANALYTICS_WINDOWS.find((w) => w.id === range);
  return window ? `the last ${window.label}` : "all time";
}
