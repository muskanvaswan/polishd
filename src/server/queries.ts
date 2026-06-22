/**
 * Buffd — dashboard aggregations (server only).
 *
 * Read-side queries over the events table. These power the `/buffd` dashboard
 * and, later, feed the Stage-2 synthesis prompt. Everything degrades to empty
 * results when the store is in no-op mode, so the dashboard always renders.
 *
 * SQL here is written in a portable subset that runs on both backends: `?`
 * placeholders (the store rewrites them per dialect) and boolean aggregates
 * spelled `SUM(CASE WHEN … THEN 1 ELSE 0 END)` rather than SQLite's `SUM(x = y)`.
 */
import { parseMeta, query, storeReady } from "./store";
import type { BuffdEventType } from "../shared/types";

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

export interface RecentError {
  path: string;
  message: string;
  component?: string;
  ts: number;
}

export interface ElementStat {
  /** The DOM selector this element was interacted with as. */
  label: string;
  /** A representative DOM selector for this element. */
  selector: string | null;
  /** A sample of the element's visible text (label), if any. */
  sampleText: string | null;
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

export async function getOverview(): Promise<OverviewStats> {
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
     FROM events`,
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
export async function getPageStats(limit = 5): Promise<PageStat[]> {
  const rows = await query(
    `SELECT
       path,
       COUNT(DISTINCT session_id)                                     AS sessions,
       SUM(CASE WHEN type = 'page_view'  THEN 1 ELSE 0 END)           AS "pageViews",
       SUM(CASE WHEN type = 'rage_click' THEN 1 ELSE 0 END)           AS "rageClicks",
       SUM(CASE WHEN type = 'dead_click' THEN 1 ELSE 0 END)           AS "deadClicks",
       SUM(CASE WHEN type = 'js_error'   THEN 1 ELSE 0 END)           AS "jsErrors",
       AVG(CASE WHEN type = 'scroll_depth' THEN value END)            AS "avgScrollDepth"
     FROM events
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
export async function getTopPages(limit = 8): Promise<TopPage[]> {
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
     FROM events
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
     FROM events
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

/**
 * Per-element interaction breakdown, grouped by DOM selector path. This is the
 * data that makes Stage 2 synthesis possible: it tells you *which UI element*
 * the issues are, not just which page.
 *
 * Explicitly monitored components (those wrapped in <BuffdMonitor>, the only
 * source of `data-component`) are excluded here — they get their own dedicated
 * "Monitored components" section, so this table covers the rest of the UI.
 */
export async function getElementStats(limit = 12): Promise<ElementStat[]> {
  const rows = await query(
    `SELECT
       COALESCE(selector, '(unknown)')                                 AS label,
       MAX(selector)                                                    AS selector,
       MAX(text)                                                        AS "sampleText",
       COUNT(DISTINCT path)                                             AS pages,
       SUM(CASE WHEN type = 'click'      THEN 1 ELSE 0 END)             AS clicks,
       SUM(CASE WHEN type = 'rage_click' THEN 1 ELSE 0 END)             AS "rageClicks",
       SUM(CASE WHEN type = 'dead_click' THEN 1 ELSE 0 END)             AS "deadClicks",
       MAX(ts)                                                          AS "lastTs"
     FROM events
     WHERE type IN ('click', 'rage_click', 'dead_click') AND component IS NULL
     GROUP BY COALESCE(selector, '(unknown)')`,
  );

  return rows
    .map((r): ElementStat => {
      const rageClicks = num(r, "rageClicks");
      const deadClicks = num(r, "deadClicks");
      const clicks = num(r, "clicks");
      return {
        label: r.label as string,
        selector: (r.selector as string) ?? null,
        sampleText: (r.sampleText as string) ?? null,
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
export async function getDeviceBreakdown(): Promise<DeviceBucket[]> {
  const rows = await query(
    `SELECT
       text                        AS category,
       COUNT(DISTINCT session_id)  AS sessions,
       AVG(value)                  AS "avgWidth"
     FROM events
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
export async function getTopInteractions(limit = 12): Promise<TopInteraction[]> {
  const rows = await query(
    `SELECT
       COALESCE(component, selector, '(unknown)')             AS label,
       MAX(CASE WHEN component IS NOT NULL THEN 1 ELSE 0 END) AS "isComponent",
       MAX(selector)                                          AS selector,
       MAX(text)                                              AS "sampleText",
       COUNT(*)                                               AS clicks,
       COUNT(DISTINCT session_id)                             AS sessions,
       COUNT(DISTINCT path)                                   AS pages
     FROM events
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
  type: BuffdEventType;
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
const JOURNEY_ACTION_TYPES: ReadonlySet<BuffdEventType> = new Set<BuffdEventType>([
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
export async function getSessionJourneys(limit = 6): Promise<SessionJourney[]> {
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
     FROM events
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
  const ids = ranked.map((s) => s.id);
  const placeholders = ids.map(() => "?").join(", ");
  const rows = await query(
    `SELECT session_id, type, ts, path, selector, component, text, value, meta
     FROM events
     WHERE session_id IN (${placeholders})
     ORDER BY session_id, id`,
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
      const type = e.type as BuffdEventType;

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
        label =
          (e.component as string) || (e.text as string) || (e.selector as string) || null;
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

/** One explicitly-monitored component (wrapped in <BuffdMonitor>). */
export interface MonitoredComponent {
  /** The name passed to <BuffdMonitor name="...">. */
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
 * Fetch all components explicitly wrapped in <BuffdMonitor>. The definitive
 * marker is the presence of at least one "hover", "component_view", or "mount"
 * event for that component name (all three are only emitted by BuffdMonitor).
 * We then pull all event types for those components so the table shows the
 * complete picture.
 *
 * The per-view `meta` (height, scrollDepth) is aggregated in JS rather than SQL:
 * the two backends spell JSON extraction differently (SQLite `JSON_EXTRACT`,
 * Postgres `->>`), and there's no portable function, so we parse meta here —
 * matching how `getSessionJourneys` and `getTopPages` keep their SQL portable.
 */
export async function getMonitoredComponents(): Promise<MonitoredComponent[]> {
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
     FROM events
     WHERE component IN (
       SELECT DISTINCT component FROM events
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
    `SELECT component, meta FROM events
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
    if (typeof meta.scrollDepth === "number") { acc.dSum += meta.scrollDepth; acc.dN++; }
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

export async function getRecentErrors(limit = 10): Promise<RecentError[]> {
  const rows = await query(
    `SELECT path, component, meta, ts
     FROM events WHERE type = 'js_error'
     ORDER BY id DESC LIMIT ?`,
    [limit],
  );
  return rows.map((r) => {
    let message = "Unknown error";
    const meta = parseMeta(r.meta);
    if (meta && typeof meta.message === "string") message = meta.message;
    return {
      path: r.path as string,
      component: (r.component as string) ?? undefined,
      message,
      ts: num(r, "ts"),
    };
  });
}
