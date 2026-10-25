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
 * "this build" costs a query to name.
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
  getRecentErrors,
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

/** The build "this build" means right now: the newest one in the store. */
export const loadCurrentBuild = cache((): Promise<BuildStat | null> => getCurrentBuild());

/**
 * The filter a range stands for. A "this build" range with no build to name
 * falls back to everything rather than to nothing: an empty tab would read
 * as a capture failure.
 */
export const loadFilter = cache(async (range: AnalyticsRange): Promise<EventFilter> => {
  const named = rangeBuild(range);
  if (named) return { build: named };
  if (range === "build") {
    const current = await loadCurrentBuild();
    return current ? { build: current.build } : {};
  }
  return { since: rangeSince(range) };
});

/**
 * Wrap a query so it (a) waits for the one-time history reclassification that
 * the batch loader used to run up front — the sweep is module-memoized, so
 * concurrent sections join a single pass — and (b) runs once per request and
 * range no matter how many sections await it.
 */
function swept<T>(fn: (filter: EventFilter) => Promise<T>): (range?: AnalyticsRange) => Promise<T> {
  return cache(async (range: AnalyticsRange = DEFAULT_ANALYTICS_RANGE) => {
    await ensureReclassifiedHistory();
    return fn(await loadFilter(range));
  });
}

export const loadOverview = swept((f) => getOverview(f));
export const loadPages = swept((f) => getTopPages(8, f));
export const loadTrends = swept((f) => getMetricTrends(f));
export const loadElements = swept((f) => getElementStats(12, f));
export const loadDevices = swept((f) => getDeviceBreakdown(f));
export const loadTopUsed = swept((f) => getTopInteractions(12, f));
export const loadJourneys = swept((f) => getSessionJourneys(6, f));
export const loadErrors = swept((f) => getRecentErrors(20, f));
export const loadMonitored = swept((f) => getMonitoredComponents(f));
export const loadBuilds = swept((f) => getBuilds(50, f));
/** Capture health describes the proxy, not a window of traffic: never scoped. */
export const loadHealth = cache(async () => {
  await ensureReclassifiedHistory();
  return getCaptureHealth();
});

/**
 * The full analytics payload, assembled from the same cached parts the
 * sections use — so the summary card asking for everything costs nothing
 * beyond what the sections are already fetching for themselves.
 */
export const loadDashboardData = cache(
  async (range: AnalyticsRange = DEFAULT_ANALYTICS_RANGE): Promise<PolishdDashboardData> => {
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
      loadOverview(range),
      loadHealth(),
      loadPages(range),
      loadTrends(range),
      loadElements(range),
      loadDevices(range),
      loadTopUsed(range),
      loadJourneys(range),
      loadErrors(range),
      loadMonitored(range),
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
  },
);
