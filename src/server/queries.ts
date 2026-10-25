/**
 * Polishd — dashboard aggregations (server only).
 *
 * Read-side queries over the events table. These power the `/polishd` dashboard
 * and, later, feed the Stage-2 synthesis prompt. Everything degrades to empty
 * results when the store is in no-op mode, so the dashboard always renders.
 *
 * SQL here is written in a portable subset that runs on both backends: `?`
 * placeholders (the store rewrites them per dialect) and boolean aggregates
 * spelled `SUM(CASE WHEN … THEN 1 ELSE 0 END)` rather than SQLite's `SUM(x = y)`.
 */
import { getMeta, parseMeta, query, storeReady } from "./store";
import { ensureReclassifiedHistory } from "./reclassify";
import {
  CAPTURE_WINDOW_MS,
  noSessionCountSince,
  parseNoSessionRecord,
  type CaptureHealth,
} from "../shared/capture-status";
import { NO_SESSION_META_KEY } from "./ingest";
import { resolveAnalyticsSource } from "./telemetry";
import { resolveDashboardRoute } from "../config";
import { isIgnorableError } from "../shared/error-noise";
import {
  EMPTY_FRICTION,
  foldFriction,
  withRageHandles,
  type FrictionIndex,
  type FrictionKind,
  type FrictionRow,
} from "./friction";
import { trendWindow } from "../shared/metric-buckets";
import type { PolishdEventType } from "../shared/types";

/**
 * How far the dashboard's figures reach. Everything the Analytics tab shows
 * is scoped by one of these at once, so its sections agree with each other.
 */
export interface EventFilter {
  /** Only events received at or after this time (ms since epoch). */
  since?: number | null;
  /** Only events captured on this build (see `PolishdEventRow.build`). */
  build?: string | null;
}

/** A string as a SQL literal. The values inlined here are never user-typed. */
function literal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * The events table with the dashboard's own route filtered out, aliased back to
 * `events` so every query below reads from it unchanged.
 *
 * Capture already skips the dashboard on both the client and the ingest
 * endpoint, so this is what hides rows recorded *before* that landed — an
 * existing install shouldn't have to wipe its database to stop seeing its own
 * dashboard ranked as the site's busiest page.
 *
 * The route is inlined rather than bound as a parameter because these queries
 * mix positional `?` params in query-specific orders, and a shared leading
 * param would have to be threaded through every call site. It's a
 * developer-set config value rather than user input, and the comparison is
 * `substr`-based so there are no LIKE wildcards to escape. The optional
 * `filter` is inlined the same way: `since` is a number the dashboard
 * computed, and `build` is a label that passed `sanitizeBuild` — at ingest,
 * where every stored one came from, and again when it's parsed out of the
 * URL — so it holds nothing a literal can't carry; it is quoted regardless.
 *
 * `since` compares `received_at`, the server's clock: "the last 7 days" means
 * what arrived in them, whatever a visitor's clock said. The trend charts
 * still bucket by the visitor's `ts`, as they always have.
 *
 * Resolved per call, not at module load: these queries are public API called
 * with no arguments, so the route arrives out of band — registered by
 * `createPolishdPage({ config })` when the page module evaluates, or set via
 * `POLISHD_DASHBOARD_ROUTE` — and module evaluation order means neither is
 * guaranteed to have happened by the time this file is imported.
 */
export function polishdEventsSource(filter: EventFilter = {}): string {
  const conditions: string[] = [];

  // POLISHD_ANALYTICS_SOURCE=telemetry points the whole dashboard at the
  // cross-install telemetry it collects instead of the site's own traffic —
  // every feature reads through here, so the collector gets the full
  // experience (analytics, journeys, design, AI summary) over dashboard
  // usage. Telemetry paths are namespaced /~polishd/… by the emitter, so the
  // dashboard-route exclusion below has nothing to exclude in this mode.
  if (resolveAnalyticsSource() === "telemetry") {
    conditions.push("install_id IS NOT NULL");
  } else {
    // Telemetry rows (dashboard usage reported by *other* polishd installs,
    // tagged with their hostname) live in the same table but are a different
    // dataset: they must never count as this site's sessions, pages, or
    // interactions, feed its AI digest, or rank among its features. They are
    // read only by the installs queries below.
    conditions.push("install_id IS NULL");
    const route = resolveDashboardRoute().replace(/\/+$/, "");
    // A blank route means "exclude no path" — without this guard the prefix test
    // below would match every path, and the dashboard would render permanently empty.
    if (route) {
      conditions.push(`path <> ${literal(route)}`);
      conditions.push(`substr(path, 1, ${route.length + 1}) <> ${literal(`${route}/`)}`);
    }
  }

  if (typeof filter.since === "number" && Number.isFinite(filter.since)) {
    conditions.push(`received_at >= ${Math.floor(filter.since)}`);
  }
  if (filter.build) {
    conditions.push(`build = ${literal(filter.build)}`);
  }

  return `(SELECT * FROM events
     WHERE ${conditions.join("\n       AND ")}) AS events`;
}

export interface OverviewStats {
  ready: boolean;
  totalEvents: number;
  sessions: number;
  pageViews: number;
  rageClicks: number;
  deadClicks: number;
  jsErrors: number;
}

export interface PageStat {
  path: string;
  sessions: number;
  pageViews: number;
  rageClicks: number;
  deadClicks: number;
  jsErrors: number;
  avgScrollDepth: number | null;
  /** Composite score; higher = worse. */
  score: number;
}

/**
 * One distinct error, with every recorded throw of it folded in. Identity is
 * the message, component and origin — not the page, so a bug that fires on
 * every product page is one entry rather than one per URL.
 */
export interface RecentError {
  /** The page it was most recently seen on. */
  path: string;
  message: string;
  component?: string;
  /** When it was most recently seen. */
  ts: number;
  /** How many times it was recorded, across all pages. */
  count: number;
  /** Every page it was seen on, most recent first. */
  paths: string[];
  /**
   * Who the client attributed the throw to. Absent means the site's own code —
   * the common case, left unlabeled. `foreign` is a script this page never
   * loaded (injected from somewhere), `unknown` is an error with nothing
   * attributable at all. Confident extension errors never make it this far.
   */
  origin?: "foreign" | "unknown";
  /**
   * Context from the most recent occurrence, each absent when that throw
   * didn't carry it (older clients carry none): Next's error digest, the top
   * stack frame, the click shortly before it (`after`, `afterMs` before,
   * `afterSelector`), and a path to find the element in the source.
   */
  digest?: string;
  frame?: string;
  after?: string;
  afterMs?: number;
  afterSelector?: string;
  handle?: string;
}

export interface ElementStat {
  /** The DOM selector this element was interacted with as. */
  label: string;
  /** A representative DOM selector for this element. */
  selector: string | null;
  /**
   * A sample of the element's visible text (label), if any. For an element
   * whose dead clicks carry no text of their own but missed a control beside
   * them, `beside “<control>”`.
   */
  sampleText: string | null;
  /** The control this element's dead clicks narrowly missed, if they did. */
  near?: string;
  /**
   * True when `sampleText` is the `beside “…”` label rather than the element's
   * own text — render and report it as where the clicks land, not as a quote.
   */
  sampleIsNear?: boolean;
  /** How many distinct pages this element was interacted with on. */
  pages: number;
  clicks: number;
  rageClicks: number;
  deadClicks: number;
  /** Composite score; higher = worse. */
  score: number;
  /** Client timestamp of the most recent interaction with this element, ms. */
  lastInteraction: number;
}

export interface DeviceBucket {
  /** Device category: "mobile" | "tablet" | "desktop". */
  category: string;
  /** Distinct sessions that fell into this bucket. */
  sessions: number;
  /** Share of all measured sessions, 0–100. */
  pct: number;
  /** Average viewport width (CSS px) for the bucket. */
  avgWidth: number | null;
}

export interface TopInteraction {
  /** Component name (from data-component) or, failing that, the selector. */
  label: string;
  /** True when `label` is a real component name, false when it's a raw selector. */
  isComponent: boolean;
  /** A representative DOM selector for this element. */
  selector: string | null;
  /** A sample of the element's visible text (label), if any. */
  sampleText: string | null;
  /** Total successful (interactive) clicks on this element. */
  clicks: number;
  /** Distinct sessions that clicked it. */
  sessions: number;
  /** Distinct pages it was clicked on. */
  pages: number;
}

/** Coerce a DB cell to a finite number. Tolerates pg's stringified bigints. */
function num(row: Record<string, unknown> | undefined, key: string): number {
  const v = row?.[key];
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export async function getOverview(filter: EventFilter = {}): Promise<OverviewStats> {
  if (!(await storeReady())) {
    return {
      ready: false,
      totalEvents: 0,
      sessions: 0,
      pageViews: 0,
      rageClicks: 0,
      deadClicks: 0,
      jsErrors: 0,
    };
  }
  const [row] = await query(
    `SELECT
       COUNT(*)                                                      AS "totalEvents",
       COUNT(DISTINCT session_id)                                    AS sessions,
       SUM(CASE WHEN type = 'page_view'  THEN 1 ELSE 0 END)          AS "pageViews",
       SUM(CASE WHEN type = 'rage_click' THEN 1 ELSE 0 END)          AS "rageClicks",
       SUM(CASE WHEN type = 'dead_click' THEN 1 ELSE 0 END)          AS "deadClicks",
       SUM(CASE WHEN type = 'js_error'   THEN 1 ELSE 0 END)          AS "jsErrors"
     FROM ${polishdEventsSource(filter)}`,
  );

  return {
    ready: true,
    totalEvents: num(row, "totalEvents"),
    sessions: num(row, "sessions"),
    pageViews: num(row, "pageViews"),
    rageClicks: num(row, "rageClicks"),
    deadClicks: num(row, "deadClicks"),
    jsErrors: num(row, "jsErrors"),
  };
}

/**
 * Score ranking. Weights match the build plan's guidance — rage clicks are
 * the strongest frustration signal, then dead clicks and errors; shallow
 * scroll (content not reached) contributes mildly.
 */
export async function getPageStats(limit = 5, filter: EventFilter = {}): Promise<PageStat[]> {
  const rows = await query(
    `SELECT
       path,
       COUNT(DISTINCT session_id)                                     AS sessions,
       SUM(CASE WHEN type = 'page_view'  THEN 1 ELSE 0 END)           AS "pageViews",
       SUM(CASE WHEN type = 'rage_click' THEN 1 ELSE 0 END)           AS "rageClicks",
       SUM(CASE WHEN type = 'dead_click' THEN 1 ELSE 0 END)           AS "deadClicks",
       SUM(CASE WHEN type = 'js_error'   THEN 1 ELSE 0 END)           AS "jsErrors",
       AVG(CASE WHEN type = 'scroll_depth' THEN value END)            AS "avgScrollDepth"
     FROM ${polishdEventsSource(filter)}
     GROUP BY path`,
  );

  return rows
    .map((r): PageStat => {
      const rageClicks = num(r, "rageClicks");
      const deadClicks = num(r, "deadClicks");
      const jsErrors = num(r, "jsErrors");
      const avg = r.avgScrollDepth;
      const avgNum = typeof avg === "number" ? avg : typeof avg === "string" ? Number(avg) : NaN;
      const avgScrollDepth = Number.isFinite(avgNum) ? Math.round(avgNum) : null;
      const shallowPenalty =
        avgScrollDepth !== null && avgScrollDepth < 50 ? (50 - avgScrollDepth) / 25 : 0;
      const score =
        rageClicks * 3 + deadClicks * 2 + jsErrors * 2.5 + shallowPenalty;
      return {
        path: r.path as string,
        sessions: num(r, "sessions"),
        pageViews: num(r, "pageViews"),
        rageClicks,
        deadClicks,
        jsErrors,
        avgScrollDepth,
        score: Math.round(score * 10) / 10,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** How much a page is visited, as `getTopPages` ranks it. */
export interface PageTraffic {
  /** Distinct sessions that reached the page. */
  sessions: number;
  pageViews: number;
}

/**
 * Traffic for exactly these paths — the same two numbers `getTopPages` ranks
 * on, for a caller that already knows which pages it's choosing between (the
 * design review picking which snapshots to show the model). Paths nobody
 * visited are absent; `[]` and an unready store give an empty map.
 */
export async function getPageTraffic(paths: string[]): Promise<Map<string, PageTraffic>> {
  const out = new Map<string, PageTraffic>();
  const wanted = [...new Set(paths)].slice(0, 100);
  if (wanted.length === 0 || !(await storeReady())) return out;
  const placeholders = wanted.map(() => "?").join(", ");
  const rows = await query(
    `SELECT
       path,
       COUNT(DISTINCT session_id)                                     AS sessions,
       SUM(CASE WHEN type = 'page_view' THEN 1 ELSE 0 END)            AS "pageViews"
     FROM ${polishdEventsSource()}
     WHERE path IN (${placeholders})
     GROUP BY path`,
    wanted,
  );
  for (const r of rows) {
    out.set(r.path as string, { sessions: num(r, "sessions"), pageViews: num(r, "pageViews") });
  }
  return out;
}

/** One point in a page's sessions-over-time series (one calendar day, UTC). */
export interface PageTrendPoint {
  /** Bucket start — UTC midnight, ms since epoch. */
  ts: number;
  /** Short human label for the bucket, e.g. "Jun 14". */
  label: string;
  /** Distinct sessions that viewed the page on that day. */
  sessions: number;
}

/** A top page plus its session trend, for the "Top pages" table + drawer chart. */
export interface TopPage {
  path: string;
  sessions: number;
  pageViews: number;
  rageClicks: number;
  deadClicks: number;
  jsErrors: number;
  avgScrollDepth: number | null;
  /** Daily sessions series, oldest → newest, gap-filled. */
  trend: PageTrendPoint[];
}

const DAY_MS = 86_400_000;
/** Cap the trend window so a wide date range stays a readable chart. */
const MAX_TREND_DAYS = 30;

function dayStart(ts: number): number {
  return ts - (ts % DAY_MS);
}

function fmtDay(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * The most-visited pages, ranked by distinct sessions, each with a daily
 * sessions-over-time series for the detail chart. The aggregate is one grouped
 * query; the trend comes from a second pull of page_view events for just the
 * top paths, bucketed by UTC day in JS so it stays backend-portable.
 */
export async function getTopPages(limit = 8, filter: EventFilter = {}): Promise<TopPage[]> {
  if (!(await storeReady())) return [];

  const rows = await query(
    `SELECT
       path,
       COUNT(DISTINCT session_id)                                     AS sessions,
       SUM(CASE WHEN type = 'page_view'  THEN 1 ELSE 0 END)           AS "pageViews",
       SUM(CASE WHEN type = 'rage_click' THEN 1 ELSE 0 END)           AS "rageClicks",
       SUM(CASE WHEN type = 'dead_click' THEN 1 ELSE 0 END)           AS "deadClicks",
       SUM(CASE WHEN type = 'js_error'   THEN 1 ELSE 0 END)           AS "jsErrors",
       AVG(CASE WHEN type = 'scroll_depth' THEN value END)            AS "avgScrollDepth"
     FROM ${polishdEventsSource(filter)}
     GROUP BY path`,
  );

  const pages = rows
    .map((r) => {
      const avg = r.avgScrollDepth;
      const avgNum = typeof avg === "number" ? avg : typeof avg === "string" ? Number(avg) : NaN;
      return {
        path: r.path as string,
        sessions: num(r, "sessions"),
        pageViews: num(r, "pageViews"),
        rageClicks: num(r, "rageClicks"),
        deadClicks: num(r, "deadClicks"),
        jsErrors: num(r, "jsErrors"),
        avgScrollDepth: Number.isFinite(avgNum) ? Math.round(avgNum) : null,
      };
    })
    // "Top" = most visited; page views break ties.
    .sort((a, b) => b.sessions - a.sessions || b.pageViews - a.pageViews)
    .slice(0, limit);

  if (pages.length === 0) return [];

  // Pull page_view timestamps for just the top paths, then bucket by day.
  const paths = pages.map((p) => p.path);
  const placeholders = paths.map(() => "?").join(", ");
  const views = await query(
    `SELECT path, ts, session_id
     FROM ${polishdEventsSource(filter)}
     WHERE type = 'page_view' AND path IN (${placeholders})`,
    paths,
  );

  // path → (UTC day → set of sessions seen that day)
  const byPath = new Map<string, Map<number, Set<string>>>();
  for (const v of views) {
    const p = v.path as string;
    const day = dayStart(num(v, "ts"));
    let days = byPath.get(p);
    if (!days) byPath.set(p, (days = new Map()));
    let set = days.get(day);
    if (!set) days.set(day, (set = new Set()));
    set.add(v.session_id as string);
  }

  // Build a gap-filled daily series (zeros included) over the page's range,
  // capped to the most recent MAX_TREND_DAYS so wide ranges stay readable.
  const buildTrend = (days: Map<number, Set<string>> | undefined): PageTrendPoint[] => {
    if (!days || days.size === 0) return [];
    const keys = [...days.keys()].sort((a, b) => a - b);
    const end = keys[keys.length - 1];
    let start = keys[0];
    if ((end - start) / DAY_MS > MAX_TREND_DAYS - 1) start = end - (MAX_TREND_DAYS - 1) * DAY_MS;
    const out: PageTrendPoint[] = [];
    for (let d = start; d <= end; d += DAY_MS) {
      out.push({ ts: d, label: fmtDay(d), sessions: days.get(d)?.size ?? 0 });
    }
    return out;
  };

  return pages.map((p): TopPage => ({ ...p, trend: buildTrend(byPath.get(p.path)) }));
}

// ── Overview metric trends ───────────────────────────────────────────────────
// The six numbers at the top of the dashboard are all-time totals, which say
// nothing about *when* anything happened. These series are what the tiles open
// into: the same six metrics bucketed over time, at both granularities, so the
// chart can switch between them without another round trip.

/** The overview tiles, each of which has a series in `MetricPoint`. */
export type MetricKey =
  | "sessions"
  | "pageViews"
  | "rageClicks"
  | "deadClicks"
  | "jsErrors"
  | "totalEvents";

/** How wide one bucket is. Both are always computed; the reader picks. */
export type TrendGranularity = "hour" | "day";

/**
 * One time bucket, carrying every overview metric at once.
 *
 * All six ride together because they come from one grouped scan and the chart
 * lets you flip between metrics — paying for six columns once is cheaper than
 * six queries, and much cheaper than a fetch per switch.
 */
export interface MetricPoint {
  /** Bucket start — UTC, ms since epoch. */
  ts: number;
  /** Short axis label: "Jun 14" daily, "15:00" hourly. */
  label: string;
  /** Unambiguous label for the tooltip: "Jun 14, 15:00 UTC". */
  title: string;
  /**
   * Distinct sessions *active* in the bucket. A session that spans two hours
   * is counted in both, so hourly totals sum to more than the daily figure —
   * each bucket answers "how many people were here then", not a share of one.
   */
  sessions: number;
  pageViews: number;
  rageClicks: number;
  deadClicks: number;
  jsErrors: number;
  /** Every captured event in the bucket, of any type. */
  totalEvents: number;
}

export interface MetricTrends {
  /** Hourly buckets, oldest → newest, gap-filled. Empty when there's no data. */
  hour: MetricPoint[];
  /** Daily buckets, oldest → newest, gap-filled. Empty when there's no data. */
  day: MetricPoint[];
}

const HOUR_MS = 3_600_000;
/** Cap the hourly window so the chart stays readable — two days of detail. */
const MAX_TREND_HOURS = 48;

function fmtHour(ts: number): string {
  return `${String(new Date(ts).getUTCHours()).padStart(2, "0")}:00`;
}

function fmtLongDay(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * One granularity of the overview series.
 *
 * Bucketing is `ts / bucketMs` integer division, which both backends do the
 * same way on an integer column, so the grouping happens in the database and
 * only one row per bucket comes back — unlike the page trend, which pulls raw
 * page_view rows because it also needs per-path session sets.
 *
 * Buckets are UTC, matching the daily page trend: the label is rendered on the
 * server, and any local-timezone rendering would depend on where the server
 * happens to run rather than where the reader is.
 */
async function metricSeries(
  bucketMs: number,
  maxBuckets: number,
  fmt: (ts: number) => { label: string; title: string },
  filter: EventFilter,
): Promise<MetricPoint[]> {
  const rows = await query(
    `SELECT (ts / ${bucketMs})                                       AS bucket,
            COUNT(*)                                                 AS "totalEvents",
            COUNT(DISTINCT session_id)                               AS sessions,
            SUM(CASE WHEN type = 'page_view'  THEN 1 ELSE 0 END)     AS "pageViews",
            SUM(CASE WHEN type = 'rage_click' THEN 1 ELSE 0 END)     AS "rageClicks",
            SUM(CASE WHEN type = 'dead_click' THEN 1 ELSE 0 END)     AS "deadClicks",
            SUM(CASE WHEN type = 'js_error'   THEN 1 ELSE 0 END)     AS "jsErrors"
     FROM ${polishdEventsSource(filter)}
     GROUP BY (ts / ${bucketMs})`,
  );

  const counts = new Map<number, Omit<MetricPoint, "ts" | "label" | "title">>();
  for (const r of rows) {
    counts.set(num(r, "bucket"), {
      sessions: num(r, "sessions"),
      pageViews: num(r, "pageViews"),
      rageClicks: num(r, "rageClicks"),
      deadClicks: num(r, "deadClicks"),
      jsErrors: num(r, "jsErrors"),
      totalEvents: num(r, "totalEvents"),
    });
  }

  // Which buckets get drawn — gap filling, the cap and clock skew — is decided
  // in shared/metric-buckets.ts, which is pure and tested. Buckets with no row
  // are the zeros it filled in.
  return trendWindow(counts.keys(), maxBuckets, Math.floor(Date.now() / bucketMs)).map(
    (b): MetricPoint => {
      const ts = b * bucketMs;
      const c = counts.get(b);
      return {
        ts,
        ...fmt(ts),
        sessions: c?.sessions ?? 0,
        pageViews: c?.pageViews ?? 0,
        rageClicks: c?.rageClicks ?? 0,
        deadClicks: c?.deadClicks ?? 0,
        jsErrors: c?.jsErrors ?? 0,
        totalEvents: c?.totalEvents ?? 0,
      };
    },
  );
}

/** Both granularities of the overview series, for the stat tiles' charts. */
export async function getMetricTrends(filter: EventFilter = {}): Promise<MetricTrends> {
  if (!(await storeReady())) return { hour: [], day: [] };
  const [hour, day] = await Promise.all([
    metricSeries(
      HOUR_MS,
      MAX_TREND_HOURS,
      (ts) => ({ label: fmtHour(ts), title: `${fmtDay(ts)}, ${fmtHour(ts)} UTC` }),
      filter,
    ),
    metricSeries(
      DAY_MS,
      MAX_TREND_DAYS,
      (ts) => ({ label: fmtDay(ts), title: fmtLongDay(ts) }),
      filter,
    ),
  ]);
  return { hour, day };
}

/**
 * Per-element interaction breakdown, grouped by DOM selector path. This is the
 * data that makes Stage 2 synthesis possible: it tells you *which UI element*
 * the issues are, not just which page.
 *
 * Explicitly monitored components (those wrapped in <PolishdMonitor>, the only
 * source of `data-component`) are excluded here — they get their own dedicated
 * "Monitored components" section, so this table covers the rest of the UI.
 */
export async function getElementStats(limit = 12, filter: EventFilter = {}): Promise<ElementStat[]> {
  const rows = await query(
    `SELECT
       COALESCE(selector, '(unknown)')                                 AS label,
       MAX(selector)                                                    AS selector,
       MAX(text)                                                        AS "sampleText",
       MAX(CASE WHEN type = 'dead_click' THEN meta ->> 'near' END)      AS near,
       COUNT(DISTINCT path)                                             AS pages,
       SUM(CASE WHEN type = 'click'      THEN 1 ELSE 0 END)             AS clicks,
       SUM(CASE WHEN type = 'rage_click' THEN 1 ELSE 0 END)             AS "rageClicks",
       SUM(CASE WHEN type = 'dead_click' THEN 1 ELSE 0 END)             AS "deadClicks",
       MAX(ts)                                                          AS "lastTs"
     FROM ${polishdEventsSource(filter)}
     WHERE type IN ('click', 'rage_click', 'dead_click') AND component IS NULL
     GROUP BY COALESCE(selector, '(unknown)')`,
  );

  return rows
    .map((r): ElementStat => {
      const rageClicks = num(r, "rageClicks");
      const deadClicks = num(r, "deadClicks");
      const clicks = num(r, "clicks");
      const near = typeof r.near === "string" && r.near ? r.near : undefined;
      const own = (r.sampleText as string) || null;
      return {
        label: r.label as string,
        selector: (r.selector as string) ?? null,
        sampleText: own ?? besideLabel(near),
        ...(near ? { near } : {}),
        ...(!own && near ? { sampleIsNear: true } : {}),
        pages: num(r, "pages"),
        clicks,
        rageClicks,
        deadClicks,
        score: Math.round((rageClicks * 3 + deadClicks * 2) * 10) / 10,
        lastInteraction: num(r, "lastTs"),
      };
    })
    // Most recently interacted-with element first; score breaks ties.
    .sort((a, b) => b.lastInteraction - a.lastInteraction || b.score - a.score)
    .slice(0, limit);
}

/**
 * Device-size distribution. One `viewport` event is sampled per session at
 * start; its category lives in the `text` column (mobile/tablet/desktop) and
 * its width in `value`, so this groups without touching the JSON `meta` column.
 * Sorted most-used device first — answers "what size screen do visitors use?".
 */
export async function getDeviceBreakdown(filter: EventFilter = {}): Promise<DeviceBucket[]> {
  const rows = await query(
    `SELECT
       text                        AS category,
       COUNT(DISTINCT session_id)  AS sessions,
       AVG(value)                  AS "avgWidth"
     FROM ${polishdEventsSource(filter)}
     WHERE type = 'viewport' AND text IS NOT NULL
     GROUP BY text`,
  );

  const buckets = rows.map((r) => {
    const avg = r.avgWidth;
    const avgNum = typeof avg === "number" ? avg : typeof avg === "string" ? Number(avg) : NaN;
    return {
      category: r.category as string,
      sessions: num(r, "sessions"),
      avgWidth: Number.isFinite(avgNum) ? Math.round(avgNum) : null,
    };
  });

  const total = buckets.reduce((sum, b) => sum + b.sessions, 0);
  return buckets
    .map((b): DeviceBucket => ({
      ...b,
      pct: total > 0 ? Math.round((b.sessions / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.sessions - a.sessions);
}

/**
 * Most-used features. Ranks interactive elements by raw click volume (the
 * `click` type — successful clicks on links/buttons/etc., excluding rage and
 * dead clicks). Where `getElementStats` surfaces what's *broken*, this
 * surfaces what's *popular* — which buttons and features people actually use.
 */
export async function getTopInteractions(
  limit = 12,
  filter: EventFilter = {},
): Promise<TopInteraction[]> {
  const rows = await query(
    `SELECT
       COALESCE(component, selector, '(unknown)')             AS label,
       MAX(CASE WHEN component IS NOT NULL THEN 1 ELSE 0 END) AS "isComponent",
       MAX(selector)                                          AS selector,
       MAX(text)                                              AS "sampleText",
       COUNT(*)                                               AS clicks,
       COUNT(DISTINCT session_id)                             AS sessions,
       COUNT(DISTINCT path)                                   AS pages
     FROM ${polishdEventsSource(filter)}
     WHERE type = 'click'
     GROUP BY COALESCE(component, selector, '(unknown)')`,
  );

  return rows
    .map((r): TopInteraction => ({
      label: r.label as string,
      isComponent: num(r, "isComponent") === 1,
      selector: (r.selector as string) ?? null,
      sampleText: (r.sampleText as string) ?? null,
      clicks: num(r, "clicks"),
      sessions: num(r, "sessions"),
      pages: num(r, "pages"),
    }))
    .sort((a, b) => b.clicks - a.clicks || b.sessions - a.sessions)
    .slice(0, limit);
}

// ── Session journeys ─────────────────────────────────────────────────────────

/** One action in a reconstructed session, in the order it happened. */
export interface JourneyStep {
  type: PolishdEventType;
  /** Client clock for this action, ms since epoch. */
  ts: number;
  /** Pathname the action occurred on. */
  path: string;
  /** Component name, element text, or selector — whatever identifies the target. */
  label: string | null;
  /** Extra context for the step (error message, scroll %, etc.). */
  detail: string | null;
}

/** Device/viewport details sampled once at the start of a session. */
export interface JourneyDevice {
  category: string | null;
  width: number | null;
  height: number | null;
  dpr: number | null;
}

/** A single sampled session, reconstructed start-to-finish for the flow chart. */
export interface SessionJourney {
  /** Short, display-safe slice of the opaque session id. */
  id: string;
  /** First and last client timestamps seen for the session. */
  startedAt: number;
  endedAt: number;
  /** Wall-clock length of the recording, ms. */
  durationMs: number;
  /** True when a `session_end` event was captured (a complete recording). */
  complete: boolean;
  /** Distinct pages visited. */
  pages: number;
  device: JourneyDevice;
  rageClicks: number;
  deadClicks: number;
  jsErrors: number;
  /** Composite score; higher = worse. Drives the sampling order. */
  score: number;
  /** Ordered list of user actions. */
  steps: JourneyStep[];
  /** True when `steps` was capped and the journey is longer than shown. */
  truncated: boolean;
}

/** Event types that are user *actions* (the flow-chart nodes). */
const JOURNEY_ACTION_TYPES: ReadonlySet<PolishdEventType> = new Set<PolishdEventType>([
  "page_view",
  "click",
  "rage_click",
  "dead_click",
  "js_error",
  "session_end",
]);

/** Keep journeys readable: cap how many steps a single flow chart renders. */
const MAX_JOURNEY_STEPS = 50;

/**
 * Sampled full-session recordings, reconstructed as ordered action flows.
 *
 * Sampling strategy: every session is scored by a composite score (rage×3 + dead×2 +
 * errors×2.5). We surface the highest-scoring sessions first — those are the
 * ones worth replaying — preferring *complete* recordings (a `session_end` was
 * captured) and breaking ties by recency. When there's no signal at all this
 * degrades to "most recent complete sessions", so the section is still useful.
 */
export async function getSessionJourneys(
  limit = 6,
  filter: EventFilter = {},
): Promise<SessionJourney[]> {
  if (!(await storeReady())) return [];

  // 1. Score and rank candidate sessions for sampling.
  const summary = await query(
    `SELECT
       session_id                                                    AS id,
       MIN(ts)                                                        AS started,
       MAX(ts)                                                        AS ended,
       COUNT(DISTINCT path)                                           AS pages,
       SUM(CASE WHEN type = 'rage_click' THEN 1 ELSE 0 END)          AS rage,
       SUM(CASE WHEN type = 'dead_click' THEN 1 ELSE 0 END)          AS dead,
       SUM(CASE WHEN type = 'js_error'   THEN 1 ELSE 0 END)          AS errors,
       MAX(CASE WHEN type = 'session_end' THEN 1 ELSE 0 END)         AS complete,
       SUM(CASE WHEN type IN ('page_view','click','rage_click','dead_click')
                THEN 1 ELSE 0 END)                                   AS actions
     FROM ${polishdEventsSource(filter)}
     GROUP BY session_id`,
  );

  const ranked = summary
    .map((r) => {
      const rage = num(r, "rage");
      const dead = num(r, "dead");
      const errors = num(r, "errors");
      return {
        id: r.id as string,
        started: num(r, "started"),
        ended: num(r, "ended"),
        pages: num(r, "pages"),
        rage,
        dead,
        errors,
        complete: num(r, "complete") === 1,
        actions: num(r, "actions"),
        score: Math.round((rage * 3 + dead * 2 + errors * 2.5) * 10) / 10,
      };
    })
    // A "journey" needs at least a couple of actions to be worth showing.
    .filter((s) => s.actions >= 2)
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.complete) - Number(a.complete) ||
        b.ended - a.ended,
    )
    .slice(0, limit);

  if (ranked.length === 0) return [];

  // 2. Pull every event for just the sampled sessions, in chronological order.
  //    Under the same filter, so a journey shows the steps that scored it and
  //    not a tail from outside the window.
  const ids = ranked.map((s) => s.id);
  const placeholders = ids.map(() => "?").join(", ");
  const rows = await query(
    `SELECT session_id, type, ts, path, selector, component, text, value, meta
     FROM ${polishdEventsSource(filter)}
     WHERE session_id IN (${placeholders})
     ORDER BY session_id, ts, id`,
    ids,
  );

  // 3. Group rows back into per-session event streams.
  const streams = new Map<string, Record<string, unknown>[]>();
  for (const r of rows) {
    const sid = r.session_id as string;
    const list = streams.get(sid);
    if (list) list.push(r);
    else streams.set(sid, [r]);
  }

  // 4. Build a journey per ranked session, preserving the ranking order.
  return ranked.map((s): SessionJourney => {
    const events = streams.get(s.id) ?? [];
    const device: JourneyDevice = { category: null, width: null, height: null, dpr: null };
    const steps: JourneyStep[] = [];

    for (const e of events) {
      const type = e.type as PolishdEventType;

      // The viewport event isn't an action — it carries device details.
      if (type === "viewport") {
        device.category = (e.text as string) ?? null;
        device.width = e.value == null ? null : Number(e.value);
        const meta = parseMeta(e.meta);
        if (meta) {
          if (typeof meta.h === "number") device.height = meta.h;
          if (typeof meta.dpr === "number") device.dpr = meta.dpr;
        }
        continue;
      }

      if (!JOURNEY_ACTION_TYPES.has(type)) continue; // scroll_depth, web_vital
      if (steps.length >= MAX_JOURNEY_STEPS) break;

      let label: string | null = null;
      let detail: string | null = null;
      if (type === "js_error") {
        const meta = parseMeta(e.meta);
        detail = meta && typeof meta.message === "string" ? meta.message : "Unknown error";
      } else if (type !== "page_view" && type !== "session_end") {
        const near = type === "dead_click" ? parseMeta(e.meta)?.near : undefined;
        label =
          (e.component as string) ||
          (e.text as string) ||
          besideLabel(typeof near === "string" ? near : undefined) ||
          (e.selector as string) ||
          null;
      }

      steps.push({ type, ts: num(e, "ts"), path: e.path as string, label, detail });
    }

    return {
      id: s.id.slice(0, 8),
      startedAt: s.started,
      endedAt: s.ended,
      durationMs: Math.max(0, s.ended - s.started),
      complete: s.complete,
      pages: s.pages,
      device,
      rageClicks: s.rage,
      deadClicks: s.dead,
      jsErrors: s.errors,
      score: s.score,
      steps,
      truncated: steps.length >= MAX_JOURNEY_STEPS,
    };
  });
}

/** One explicitly-monitored component (wrapped in <PolishdMonitor>). */
export interface MonitoredComponent {
  /** The name passed to <PolishdMonitor name="...">. */
  name: string;
  /** Normal clicks attributed to this component. */
  clicks: number;
  rageClicks: number;
  deadClicks: number;
  /** Deliberate hovers recorded (≥200ms dwell). */
  hovers: number;
  /** Average hover dwell time in ms. Null when no hover data. */
  avgHoverMs: number | null;
  /** Times the region was rendered (mount events). Only for `content` monitors. */
  mounts: number;
  /** Total component_view events (one per continuous viewport visit ≥500ms). */
  componentViews: number;
  /** Average time visible per viewport visit, in ms. Null when no view data. */
  avgViewMs: number | null;
  /**
   * Largest rendered height in px observed across all view events. We take the
   * max (not the average) because a component name can be attached to more than
   * one element — note slugs wrap both the short sidebar row and the tall
   * article body — and the max is the meaningful "how long is this content".
   */
  heightPx: number | null;
  /** Average max scroll-depth % reached across all view events. */
  avgScrollDepth: number | null;
  /** Distinct sessions that interacted with this component. */
  sessions: number;
  /** Distinct pages the component appeared on. */
  pages: number;
}

/**
 * Fetch all components explicitly wrapped in <PolishdMonitor>. The definitive
 * marker is the presence of at least one "hover", "component_view", or "mount"
 * event for that component name (all three are only emitted by PolishdMonitor).
 * We then pull all event types for those components so the table shows the
 * complete picture.
 *
 * The per-view `meta` (height, scrollDepth) is parsed and aggregated in JS.
 * A single key can be read in SQL on both backends with `meta ->> 'key'` (see
 * `getRecentErrors`), but averaging numbers out of it would need a cast each
 * backend spells differently — and this table is small enough to fold here.
 */
export async function getMonitoredComponents(filter: EventFilter = {}): Promise<MonitoredComponent[]> {
  if (!(await storeReady())) return [];

  const rows = await query(
    `SELECT
       component                                                              AS name,
       SUM(CASE WHEN type = 'click'           THEN 1 ELSE 0 END)             AS clicks,
       SUM(CASE WHEN type = 'rage_click'      THEN 1 ELSE 0 END)             AS "rageClicks",
       SUM(CASE WHEN type = 'dead_click'      THEN 1 ELSE 0 END)             AS "deadClicks",
       SUM(CASE WHEN type = 'hover'           THEN 1 ELSE 0 END)             AS hovers,
       AVG(CASE WHEN type = 'hover'           THEN value END)                AS "avgHoverMs",
       SUM(CASE WHEN type = 'mount'           THEN 1 ELSE 0 END)             AS mounts,
       SUM(CASE WHEN type = 'component_view'  THEN 1 ELSE 0 END)             AS "componentViews",
       AVG(CASE WHEN type = 'component_view'  THEN value END)                AS "avgViewMs",
       COUNT(DISTINCT session_id)                                             AS sessions,
       COUNT(DISTINCT path)                                                   AS pages
     FROM ${polishdEventsSource(filter)}
     WHERE component IN (
       SELECT DISTINCT component FROM ${polishdEventsSource(filter)}
       WHERE type IN ('hover', 'component_view', 'mount') AND component IS NOT NULL
     )
     GROUP BY component
     ORDER BY "componentViews" DESC, mounts DESC, hovers DESC`,
  );

  if (rows.length === 0) return [];

  // Pull component_view meta for just these components and reduce the
  // height/scrollDepth in JS (portable across SQLite + Postgres). Height takes
  // the max observed (the tallest element the name was attached to — the
  // article body); scroll depth is averaged across visits.
  const names = rows.map((r) => r.name as string);
  const placeholders = names.map(() => "?").join(", ");
  const viewRows = await query(
    `SELECT component, meta FROM ${polishdEventsSource(filter)}
     WHERE type = 'component_view' AND component IN (${placeholders})`,
    names,
  );

  // component → max height + running scroll-depth average.
  const dims = new Map<string, { hMax: number; hSeen: boolean; dSum: number; dN: number }>();
  for (const v of viewRows) {
    const name = v.component as string;
    const meta = parseMeta(v.meta);
    if (!meta) continue;
    let acc = dims.get(name);
    if (!acc) dims.set(name, (acc = { hMax: 0, hSeen: false, dSum: 0, dN: 0 }));
    if (typeof meta.height === "number") { acc.hSeen = true; if (meta.height > acc.hMax) acc.hMax = meta.height; }
    // Current clients only send scrollDepth for components taller than the
    // viewport; older ones sent it always, so a component that fit on screen
    // reported a trivial 100%. Apply the same rule to history: ignore depth
    // from rows whose recorded height fits a typical viewport.
    if (
      typeof meta.scrollDepth === "number" &&
      !(typeof meta.height === "number" && meta.height <= 700)
    ) { acc.dSum += meta.scrollDepth; acc.dN++; }
  }

  const toNum = (v: unknown) => {
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (typeof v === "string") { const n = Number(v); return Number.isFinite(n) ? n : null; }
    return null;
  };

  return rows.map((r): MonitoredComponent => {
    const name = r.name as string;
    const acc = dims.get(name);
    return {
      name,
      clicks: num(r, "clicks"),
      rageClicks: num(r, "rageClicks"),
      deadClicks: num(r, "deadClicks"),
      hovers: num(r, "hovers"),
      avgHoverMs: toNum(r.avgHoverMs) !== null ? Math.round(toNum(r.avgHoverMs)!) : null,
      mounts: num(r, "mounts"),
      componentViews: num(r, "componentViews"),
      avgViewMs: toNum(r.avgViewMs) !== null ? Math.round(toNum(r.avgViewMs)!) : null,
      heightPx: acc && acc.hSeen ? Math.round(acc.hMax) : null,
      avgScrollDepth: acc && acc.dN > 0 ? Math.round(acc.dSum / acc.dN) : null,
      sessions: num(r, "sessions"),
      pages: num(r, "pages"),
    };
  });
}

// ── Capture health ───────────────────────────────────────────────────────────

export type { CaptureHealth } from "../shared/capture-status";

/**
 * Read the proxy-health counters: the drop record ingest writes, plus what
 * the events table says about storing over the same window.
 *
 * The pair is the point. A drop count on its own cannot tell "nobody has
 * visited yet" from "everybody visited and every event was thrown away" —
 * that is why it is recorded — but neither can it tell a broken proxy from a
 * crawler POSTing at a public endpoint. `lastStoredAt` settles that outright:
 * every event is attributed to the cookie the proxy mints, so a store dated
 * after the most recent drop means the proxy is minting right now. The
 * windowed counts let the dashboard describe the rest in proportion.
 */
export async function getCaptureHealth(): Promise<CaptureHealth> {
  const windowMs = CAPTURE_WINDOW_MS;
  const empty: CaptureHealth = {
    noSessionCount: 0,
    recentNoSessionCount: 0,
    lastNoSessionAt: null,
    lastStoredAt: null,
    recentEvents: 0,
    recentBatches: 0,
    windowMs,
  };
  if (!(await storeReady())) return empty;

  const since = Date.now() - windowMs;
  // `received_at` is stamped once per insert call, so distinct values count
  // batches — approximately: two batches landing in the same millisecond
  // collapse into one. Good enough for a percentage, and it costs no schema.
  const [rows, raw] = await Promise.all([
    query(
      `SELECT
         MAX(received_at)                                                AS "lastStoredAt",
         SUM(CASE WHEN received_at >= ? THEN 1 ELSE 0 END)               AS "recentEvents",
         COUNT(DISTINCT CASE WHEN received_at >= ? THEN received_at END) AS "recentBatches"
       FROM ${polishdEventsSource()}`,
      [since, since],
    ),
    getMeta(NO_SESSION_META_KEY),
  ]);
  const row = rows[0];
  // MAX() over an empty table is NULL, which `num` would flatten to 0 — and a
  // stored-at of 0 reads as "stored in 1970", i.e. older than any drop. Keep
  // the absence.
  const everStored = row?.lastStoredAt !== null && row?.lastStoredAt !== undefined;

  const rec = parseNoSessionRecord(raw);
  return {
    noSessionCount: rec?.count ?? 0,
    recentNoSessionCount: noSessionCountSince(rec, since),
    lastNoSessionAt: rec && rec.lastAt > 0 ? rec.lastAt : null,
    lastStoredAt: everStored ? num(row, "lastStoredAt") : null,
    recentEvents: num(row, "recentEvents"),
    recentBatches: num(row, "recentBatches"),
    windowMs,
  };
}

// ── Builds ───────────────────────────────────────────────────────────────────

/** One build the site has shipped, as its events describe it. */
export interface BuildStat {
  /** The label as stored — a commit sha or the host's deployment label. */
  build: string;
  /** Server time of its first and most recent event, ms since epoch. */
  firstSeen: number;
  lastSeen: number;
  sessions: number;
  events: number;
  pageViews: number;
  rageClicks: number;
  deadClicks: number;
  jsErrors: number;
}

/**
 * Every build with events, newest first — where "newest" is the build whose
 * first event is most recent, not whose last is. A tab left open across a
 * deploy keeps reporting the old build for a while, and must not make it the
 * current one again; a build only becomes current by appearing, once.
 *
 * Rows without a build (stored before builds were tracked, or from a host
 * that names none) belong to no build and aren't listed. Under a filter the
 * list is of the builds seen in that window — handing the Analytics tab's
 * range a Builds table that agrees with the rest of it.
 */
export async function getBuilds(limit = 50, filter: EventFilter = {}): Promise<BuildStat[]> {
  if (!(await storeReady())) return [];
  const rows = await query(
    `SELECT build,
            MIN(received_at)                                      AS "firstSeen",
            MAX(received_at)                                      AS "lastSeen",
            COUNT(DISTINCT session_id)                            AS sessions,
            COUNT(*)                                              AS events,
            SUM(CASE WHEN type = 'page_view'  THEN 1 ELSE 0 END)  AS "pageViews",
            SUM(CASE WHEN type = 'rage_click' THEN 1 ELSE 0 END)  AS "rageClicks",
            SUM(CASE WHEN type = 'dead_click' THEN 1 ELSE 0 END)  AS "deadClicks",
            SUM(CASE WHEN type = 'js_error'   THEN 1 ELSE 0 END)  AS "jsErrors"
     FROM ${polishdEventsSource(filter)}
     WHERE build IS NOT NULL
     GROUP BY build
     ORDER BY "firstSeen" DESC
     LIMIT ?`,
    [limit],
  );
  return rows.map((r) => ({
    build: r.build as string,
    firstSeen: num(r, "firstSeen"),
    lastSeen: num(r, "lastSeen"),
    sessions: num(r, "sessions"),
    events: num(r, "events"),
    pageViews: num(r, "pageViews"),
    rageClicks: num(r, "rageClicks"),
    deadClicks: num(r, "deadClicks"),
    jsErrors: num(r, "jsErrors"),
  }));
}

/**
 * The build currently shipping, as far as the store can tell: the one that
 * appeared most recently. Null until a build has been stamped on anything.
 */
export async function getCurrentBuild(): Promise<BuildStat | null> {
  return (await getBuilds(1))[0] ?? null;
}

// ── Aggregate loader ─────────────────────────────────────────────────────────

/** Everything the dashboard (and the AI summary) reads, in one shape. */
export interface PolishdDashboardData {
  overview: Awaited<ReturnType<typeof getOverview>>;
  health: CaptureHealth;
  pages: Awaited<ReturnType<typeof getTopPages>>;
  /** Overview metrics over time, at both granularities. */
  trends: MetricTrends;
  elements: Awaited<ReturnType<typeof getElementStats>>;
  devices: Awaited<ReturnType<typeof getDeviceBreakdown>>;
  topUsed: Awaited<ReturnType<typeof getTopInteractions>>;
  journeys: Awaited<ReturnType<typeof getSessionJourneys>>;
  errors: Awaited<ReturnType<typeof getRecentErrors>>;
  monitored: Awaited<ReturnType<typeof getMonitoredComponents>>;
}

/**
 * Fetch every dashboard query in parallel. Server-only. Lives here (not in the
 * dashboard) so the AI summary layer can reuse it without importing React.
 *
 * `filter` scopes every section at once (the Analytics tab's range); the AI
 * summary always reads the whole history, so it passes none. Capture health
 * is never filtered — it describes the proxy, not a window of traffic.
 */
export async function loadPolishdDashboardData(filter: EventFilter = {}): Promise<PolishdDashboardData> {
  // One-time sweep retyping historical text clicks recorded as dead/rage under
  // the old rules — after it, every aggregate below reads corrected history.
  // The trend series count the same dead_click/rage_click rows the tiles do, so
  // they have to be on this side of the sweep too, or the chart would contradict
  // the number above it.
  await ensureReclassifiedHistory();
  const [
    overview,
    health,
    pages,
    trends,
    elements,
    devices,
    topUsed,
    journeys,
    errors,
    monitored,
  ] = await Promise.all([
    getOverview(filter),
    getCaptureHealth(),
    getTopPages(8, filter),
    getMetricTrends(filter),
    getElementStats(12, filter),
    getDeviceBreakdown(filter),
    getTopInteractions(12, filter),
    getSessionJourneys(6, filter),
    getRecentErrors(20, filter),
    getMonitoredComponents(filter),
  ]);
  return {
    overview,
    health,
    pages,
    trends,
    elements,
    devices,
    topUsed,
    journeys,
    errors,
    monitored,
  };
}

/**
 * The most recently seen distinct errors, up to `limit`, each with its total
 * count and the context of its latest occurrence.
 *
 * The SQL groups on what stays the same every time a throw site fires — page,
 * component, message, source, frame, line, origin — read out of `meta` with
 * `->>`, which both backends spell the same way on this column (Postgres on
 * `jsonb`, SQLite since 3.38; `node:sqlite` ships 3.46+). It used to group by
 * the whole `meta`, and once errors carried per-occurrence context (`after`,
 * `afterMs`) every throw became a group of its own: one frequent error filled
 * the window and the others fell out of it. The final fold by message, across
 * pages and throw sites, happens here.
 */
export async function getRecentErrors(limit = 10, filter: EventFilter = {}): Promise<RecentError[]> {
  // A message can span many SQL groups — one per page and throw site — so
  // fetch well past `limit`. The cap only bounds history: an error whose
  // older variants fall past it reads a little low, never wrong in kind.
  // `->>` is text on Postgres but keeps a JSON number a number on SQLite, so
  // `line: 12` and `line: "12"` would group apart on one engine only. The cast
  // makes both engines group, and return, the same text.
  const field = (key: string) => `CAST(meta ->> '${key}' AS TEXT)`;
  const stable = [
    "path",
    "component",
    field("message"),
    field("source"),
    field("frame"),
    field("line"),
    field("origin"),
  ];
  const rows = await query(
    `SELECT path, component,
            ${field("message")} AS message,
            ${field("source")}  AS source,
            ${field("origin")}  AS origin,
            COUNT(*) AS n, MAX(ts) AS last_ts, MAX(id) AS last_id
     FROM ${polishdEventsSource(filter)} WHERE type = 'js_error'
     GROUP BY ${stable.join(", ")}
     ORDER BY last_id DESC LIMIT ?`,
    [limit * 20],
  );
  const errors = new Map<string, RecentError>();
  /** The newest row of each folded error, whose meta carries its context. */
  const latestId = new Map<RecentError, number>();
  for (const r of rows) {
    const message = typeof r.message === "string" ? r.message : "Unknown error";
    const source = typeof r.source === "string" ? r.source : "";
    // Extension errors are dropped at capture and again at ingest, but rows
    // written before that filter existed are still in the table — and this
    // list is where they were loudest. Drop them on the way out, so the fix
    // applies to history and not just to new sessions.
    if (isIgnorableError({ message, source })) continue;
    const origin: RecentError["origin"] =
      r.origin === "foreign" || r.origin === "unknown" ? r.origin : undefined;
    const component = (r.component as string) ?? undefined;
    const path = r.path as string;
    const key = JSON.stringify([message, component ?? null, origin ?? null]);
    const seen = errors.get(key);
    if (seen) {
      // Rows arrive most recent first, so the first one already set the
      // latest page; later rows only add to the tally.
      seen.count += num(r, "n");
      seen.ts = Math.max(seen.ts, num(r, "last_ts"));
      if (!seen.paths.includes(path)) seen.paths.push(path);
    } else if (errors.size < limit) {
      const error: RecentError = {
        path,
        component,
        message,
        origin,
        ts: num(r, "last_ts"),
        count: num(r, "n"),
        paths: [path],
      };
      errors.set(key, error);
      latestId.set(error, num(r, "last_id"));
    }
  }

  // The varying context — digest, frame, the click before — from each error's
  // newest occurrence: one lookup by id for the whole list.
  const ids = [...latestId.values()];
  if (ids.length > 0) {
    const metas = new Map<number, ReturnType<typeof parseMeta>>();
    for (const r of await query(
      `SELECT id, meta FROM events WHERE id IN (${ids.map(() => "?").join(", ")})`,
      ids,
    )) {
      metas.set(num(r, "id"), parseMeta(r.meta));
    }
    for (const [error, id] of latestId) {
      const meta = metas.get(id);
      if (!meta) continue;
      const text = (k: string) =>
        typeof meta[k] === "string" || typeof meta[k] === "number" ? String(meta[k]) : undefined;
      const digest = text("digest");
      const frame = text("frame");
      const after = text("after");
      const afterSelector = text("afterSelector");
      const handle = text("handle");
      if (digest) error.digest = digest;
      if (frame) error.frame = frame;
      if (after) error.after = after;
      if (typeof meta.afterMs === "number") error.afterMs = meta.afterMs;
      if (afterSelector) error.afterSelector = afterSelector;
      if (handle) error.handle = handle;
    }
  }
  return [...errors.values()];
}

/** How an element with no label of its own is named after the control it missed. */
function besideLabel(near: string | undefined): string | null {
  return near ? `beside “${near}”` : null;
}

/** Grouped friction rows read at most — well past what a small site produces. */
const FRICTION_ROW_CAP = 10_000;
/** Rage-click meta rows read for their handles, most recent first. */
const RAGE_HANDLE_ROWS = 2_000;

/**
 * Rage clicks, dead clicks and errors, folded per element, component, page
 * and error message — with distinct sessions, the pages each happened on, and
 * the context capture attached (`meta.near`, `meta.handle`; on an error
 * `digest`, `frame`, `after`, `afterMs`, `afterSelector`). See friction.ts.
 *
 * Deliberately not part of `loadPolishdDashboardData`: only the AI summary
 * reads it, so it runs when a summary is generated, never on a dashboard
 * render. One grouped query — events of one kind, on one page, target and
 * session (and, for dead clicks and errors, meta) collapse to a row. Past the
 * row cap the most recent friction wins, and the index says it was capped.
 *
 * A rage click's meta only matters for its handle, which is the same on every
 * click of one element, so rage rows aren't split by it; the handles come
 * from a second, small query instead of spending the row cap.
 */
export async function getFriction(): Promise<FrictionIndex> {
  if (!(await storeReady())) return EMPTY_FRICTION;
  const metaExpr = `CASE WHEN type = 'rage_click' THEN NULL ELSE meta END`;
  const [rows, rageMeta] = await Promise.all([
    query(
      `SELECT type, path, selector, component, session_id, ${metaExpr} AS meta,
              MAX(text) AS text, COUNT(*) AS n, MAX(id) AS last_id
       FROM ${polishdEventsSource()}
       WHERE type IN ('rage_click', 'dead_click', 'js_error')
       GROUP BY type, path, selector, component, session_id, ${metaExpr}
       ORDER BY last_id DESC LIMIT ?`,
      [FRICTION_ROW_CAP + 1],
    ),
    query(
      `SELECT selector, component, meta, COUNT(*) AS n, MAX(id) AS last_id
       FROM ${polishdEventsSource()}
       WHERE type = 'rage_click' AND meta IS NOT NULL
       GROUP BY selector, component, meta
       ORDER BY last_id DESC LIMIT ?`,
      [RAGE_HANDLE_ROWS],
    ),
  ]);
  const capped = rows.length > FRICTION_ROW_CAP;
  const parsed: FrictionRow[] = [];
  for (const r of rows.slice(0, FRICTION_ROW_CAP)) {
    const meta = parseMeta(r.meta) ?? null;
    const type = r.type as FrictionKind;
    if (type === "js_error") {
      // The same extension-noise rule getRecentErrors applies to history.
      const message = typeof meta?.message === "string" ? meta.message : "";
      const source = typeof meta?.source === "string" ? meta.source : "";
      if (isIgnorableError({ message, source })) continue;
    }
    parsed.push({
      type,
      path: r.path as string,
      selector: (r.selector as string) ?? null,
      component: (r.component as string) ?? null,
      text: (r.text as string) ?? null,
      session: r.session_id as string,
      meta,
      n: num(r, "n"),
    });
  }
  const handles = rageMeta.flatMap((r) => {
    const handle = parseMeta(r.meta)?.handle;
    return typeof handle === "string" && handle.trim()
      ? [{
          selector: (r.selector as string) ?? null,
          component: (r.component as string) ?? null,
          handle,
          n: num(r, "n"),
        }]
      : [];
  });
  return withRageHandles(foldFriction(parsed, capped), handles);
}

// ── Cross-install telemetry (the installs view) ──────────────────────────────
// Everything above reads through polishdEventsSource(), which filters
// telemetry rows out; these two queries are the only readers of them. They
// power the dashboard's Installs tab — present only on installations that
// collect telemetry, i.e. whose database actually holds tagged rows.

export interface TelemetryInstall {
  /** The installation's hostname, as derived from its requests' Origin. */
  install: string;
  sessions: number;
  events: number;
  /** Dashboard tab views (page_view events). */
  pageViews: number;
  clicks: number;
  rageClicks: number;
  deadClicks: number;
  /** Server receive time of the most recent event, ms since epoch. */
  lastSeen: number;
  /** Whether a model is connected there; null = never reported (old emitter). */
  hasModel: boolean | null;
  /** Provider/model in use, from the latest install_state report. */
  provider: string | null;
  model: string | null;
}

/** One row per reporting installation, most recently active first. */
export async function getTelemetryInstalls(limit = 100): Promise<TelemetryInstall[]> {
  const rows = await query(
    `SELECT install_id,
            COUNT(DISTINCT session_id) AS sessions,
            COUNT(*) AS events,
            SUM(CASE WHEN type = 'page_view' THEN 1 ELSE 0 END) AS page_views,
            SUM(CASE WHEN type = 'click' THEN 1 ELSE 0 END) AS clicks,
            SUM(CASE WHEN type = 'rage_click' THEN 1 ELSE 0 END) AS rage_clicks,
            SUM(CASE WHEN type = 'dead_click' THEN 1 ELSE 0 END) AS dead_clicks,
            MAX(received_at) AS last_seen
     FROM events
     WHERE install_id IS NOT NULL
     GROUP BY install_id
     ORDER BY last_seen DESC
     LIMIT ?`,
    [limit],
  );

  // The newest install_state per install answers "is a model connected, and
  // which one" — state the click stream can't carry. Latest wins so an
  // install that connects (or disconnects) a model reads correctly.
  const stateRows = await query(
    `SELECT install_id, meta FROM events e
     WHERE type = 'install_state' AND install_id IS NOT NULL
       AND id = (SELECT MAX(id) FROM events e2
                 WHERE e2.type = 'install_state' AND e2.install_id = e.install_id)`,
  );
  const states = new Map<string, { hasModel: boolean; provider: string | null; model: string | null }>();
  for (const r of stateRows) {
    const meta = parseMeta(r.meta);
    if (!meta) continue;
    states.set(r.install_id as string, {
      hasModel: meta.hasModel === true,
      provider: typeof meta.provider === "string" && meta.provider ? meta.provider : null,
      model: typeof meta.model === "string" && meta.model ? meta.model : null,
    });
  }

  return rows.map((r) => {
    const state = states.get(r.install_id as string);
    return {
      install: r.install_id as string,
      sessions: num(r, "sessions"),
      events: num(r, "events"),
      pageViews: num(r, "page_views"),
      clicks: num(r, "clicks"),
      rageClicks: num(r, "rage_clicks"),
      deadClicks: num(r, "dead_clicks"),
      lastSeen: num(r, "last_seen"),
      hasModel: state ? state.hasModel : null,
      provider: state?.hasModel ? state.provider : null,
      model: state?.hasModel ? state.model : null,
    };
  });
}

export interface TelemetryPathStat {
  /** The namespaced dashboard path, e.g. "/~polishd/analytics". */
  path: string;
  views: number;
  sessions: number;
  installs: number;
}

/** Which dashboard tabs get used, across every reporting installation. */
export async function getTelemetryTopPaths(limit = 10): Promise<TelemetryPathStat[]> {
  const rows = await query(
    `SELECT path,
            COUNT(*) AS views,
            COUNT(DISTINCT session_id) AS sessions,
            COUNT(DISTINCT install_id) AS installs
     FROM events
     WHERE install_id IS NOT NULL AND type = 'page_view'
     GROUP BY path
     ORDER BY views DESC
     LIMIT ?`,
    [limit],
  );
  return rows.map((r) => ({
    path: r.path as string,
    views: num(r, "views"),
    sessions: num(r, "sessions"),
    installs: num(r, "installs"),
  }));
}

/**
 * Whether any telemetry has ever landed here — the cheap gate that decides
 * whether the dashboard shows an Installs tab at all. Almost every
 * installation is a *sender*, not a collector, and for them the tab would
 * only ever be an empty screen.
 */
export async function hasTelemetryInstalls(): Promise<boolean> {
  const rows = await query(`SELECT 1 AS present FROM events WHERE install_id IS NOT NULL LIMIT 1`);
  return rows.length > 0;
}
