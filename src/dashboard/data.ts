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
 * Lives here rather than in server/queries.ts because that module is shared
 * with the AI summary layer, which deliberately doesn't import React.
 */
import { cache } from "react";

import { ensureReclassifiedHistory } from "../server/reclassify";
import {
  getCaptureHealth,
  getDeviceBreakdown,
  getElementStats,
  getMetricTrends,
  getMonitoredComponents,
  getOverview,
  getRecentErrors,
  getSessionJourneys,
  getTopInteractions,
  getTopPages,
  type PolishdDashboardData,
} from "../server/queries";

/**
 * Wrap a query so it (a) waits for the one-time history reclassification that
 * the batch loader used to run up front — the sweep is module-memoized, so
 * concurrent sections join a single pass — and (b) runs once per request no
 * matter how many sections await it.
 */
function swept<T>(fn: () => Promise<T>): () => Promise<T> {
  return cache(async () => {
    await ensureReclassifiedHistory();
    return fn();
  });
}

export const loadOverview = swept(getOverview);
export const loadHealth = swept(getCaptureHealth);
export const loadPages = swept(() => getTopPages(8));
export const loadTrends = swept(getMetricTrends);
export const loadElements = swept(() => getElementStats(12));
export const loadDevices = swept(getDeviceBreakdown);
export const loadTopUsed = swept(() => getTopInteractions(12));
export const loadJourneys = swept(() => getSessionJourneys(6));
export const loadErrors = swept(() => getRecentErrors(8));
export const loadMonitored = swept(getMonitoredComponents);

/**
 * The full analytics payload, assembled from the same cached parts the
 * sections use — so the summary card asking for everything costs nothing
 * beyond what the sections are already fetching for themselves.
 */
export const loadDashboardData = cache(async (): Promise<PolishdDashboardData> => {
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
    loadOverview(),
    loadHealth(),
    loadPages(),
    loadTrends(),
    loadElements(),
    loadDevices(),
    loadTopUsed(),
    loadJourneys(),
    loadErrors(),
    loadMonitored(),
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
});
