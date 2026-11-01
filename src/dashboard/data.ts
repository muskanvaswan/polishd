/**
 * Per-request cached loaders for the dashboard's streamed sections.
 *
 * Each section of the analytics tab is an async server component that awaits
 * only the queries it actually renders, so a slow aggregate (journeys, metric
 * trends) can't hold back a fast one (devices). React's `cache()` scopes the
 * memoization to the request, so sections that share an input — the summary
 * card wants everything, the capture banner wants overview + health — still
 * run each underlying query exactly once per render.
 *
 * Every loader takes the tab's range (shared/analytics-range.ts) and resolves
 * it to the filter the queries take. The range is a string, so `cache()` keys
 * on its value; the filter it resolves to is cached per range as well, since
 * "this build" costs a query to name. A source (shared/analytics-source.ts)
 * rides along the same way; omitted, it's whatever `POLISHD_ANALYTICS_SOURCE`
 * says — so callers that never pass one, like the summary, still share a
 * cache entry with the tab on its default view.
 *
 * Lives here rather than in server/queries.ts because that module is shared
 * with the AI summary layer, which deliberately doesn't import React.
 */
import { cache } from "react";

import { ensureReclassifiedHistory } from "../server/reclassify";
import {
  getBuilds,
  getCaptureHealth,
  getCurrentBuild,
  getDeviceBreakdown,
  getElementStats,
  getMetricTrends,
  getMonitoredComponents,
  getOverview,
  getSessionJourneys,
  getTopInteractions,
  getTopPages,
  type BuildStat,
  type EventFilter,
  type PolishdDashboardData,
} from "../server/queries";
import {
  DEFAULT_ANALYTICS_RANGE,
  rangeBuild,
  rangeSince,
  type AnalyticsRange,
} from "../shared/analytics-range";
import type { PolishdAnalyticsSource } from "../shared/analytics-source";

/** The build "this build" means right now: the newest one in the store. */
export const loadCurrentBuild = cache(
  (source?: PolishdAnalyticsSource): Promise<BuildStat | null> => getCurrentBuild(source),
);

/**
 * The filter a range stands for. A "this build" range with no build to name
 * falls back to everything rather than to nothing: an empty tab would read
 * as a capture failure.
 */
export const loadFilter = cache(
  async (range: AnalyticsRange, source?: PolishdAnalyticsSource): Promise<EventFilter> => {
    const named = rangeBuild(range);
    if (named) return { build: named, source };
    if (range === "build") {
      const current = await loadCurrentBuild(source);
      return current ? { build: current.build, source } : { source };
    }
    return { since: rangeSince(range), source };
  },
);

/**
 * Wrap a query so it (a) waits for the one-time history reclassification that
 * the batch loader used to run up front — the sweep is module-memoized, so
 * concurrent sections join a single pass — and (b) runs once per request,
 * range and source no matter how many sections await it.
 */
function swept<T>(
  fn: (filter: EventFilter) => Promise<T>,
): (range?: AnalyticsRange, source?: PolishdAnalyticsSource) => Promise<T> {
  return cache(async (range: AnalyticsRange = DEFAULT_ANALYTICS_RANGE, source?: PolishdAnalyticsSource) => {
    await ensureReclassifiedHistory();
    return fn(await loadFilter(range, source));
  });
}

export const loadOverview = swept((f) => getOverview(f));
export const loadPages = swept((f) => getTopPages(8, f));
export const loadTrends = swept((f) => getMetricTrends(f));
export const loadElements = swept((f) => getElementStats(12, f));
export const loadDevices = swept((f) => getDeviceBreakdown(f));
export const loadTopUsed = swept((f) => getTopInteractions(12, f));
export const loadJourneys = swept((f) => getSessionJourneys(6, f));
export const loadMonitored = swept((f) => getMonitoredComponents(f));
export const loadBuilds = swept((f) => getBuilds(50, f));
/** Capture health describes the proxy, not a window of traffic: never scoped to a range. */
export const loadHealth = cache(async (source?: PolishdAnalyticsSource) => {
  await ensureReclassifiedHistory();
  return getCaptureHealth(source);
});

/**
 * The full analytics payload, assembled from the same cached parts the
 * sections use — so the summary card asking for everything costs nothing
 * beyond what the sections are already fetching for themselves.
 */
export const loadDashboardData = cache(
  async (
    range: AnalyticsRange = DEFAULT_ANALYTICS_RANGE,
    source?: PolishdAnalyticsSource,
  ): Promise<PolishdDashboardData> => {
    const [
      overview,
      health,
      pages,
      trends,
      elements,
      devices,
      topUsed,
      journeys,
      monitored,
    ] = await Promise.all([
      loadOverview(range, source),
      loadHealth(source),
      loadPages(range, source),
      loadTrends(range, source),
      loadElements(range, source),
      loadDevices(range, source),
      loadTopUsed(range, source),
      loadJourneys(range, source),
      loadMonitored(range, source),
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
      monitored,
    };
  },
);
