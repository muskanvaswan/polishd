/**
 * Polishd — what a capture shoots (server only).
 *
 * The routes, the design fingerprint and the values to picture, worked out
 * from what the store holds. Shared by the capture the owner starts on the
 * Design tab (dashboard/snapshot-actions.ts) and the one taken in the
 * background (snapshot-background.ts), so the two can't drift into shooting
 * different things.
 */
import { buildDesignDigest } from "../ai/design";
import { designReviewTargets, pickReviewRoutes } from "../ai/design-shots";
import { fingerprintDigest } from "../ai/digest";
import { resolveSettings } from "../ai/settings";
import { isDashboardPath, resolveDashboardRoute } from "../config";
import { designPreviewTargets, type DesignPreviewTarget } from "../shared/design-values";
import { getDesignData } from "./design";
import { getPageTraffic } from "./queries";
import { dashboardTabOf } from "./snapshot-files";
import { collapseSlugRoutes } from "./snapshot-routes";
import { MAX_SNAPSHOT_ROUTES } from "./snapshots";

export interface CapturePlan {
  routes: string[];
  /** The design digest's hash at capture time, or null before anything is scanned. */
  fingerprint: string | null;
  targets: DesignPreviewTarget[];
}

/**
 * Plan a capture. A gallery capture shoots every scanned route; a review
 * capture the three most-visited pages. Either way a dynamic route's many
 * pages count as one.
 */
export async function planCapture(options: {
  review: boolean;
  /** A local capture may also shoot the dashboard's own tabs; the service never does. */
  engine: "service" | "local";
}): Promise<CapturePlan> {
  const data = await getDesignData();
  const dashboardRoute = resolveDashboardRoute();
  // Shoot what visitors have actually rendered, never the dashboard as a
  // page of the site. The exception is an install that measures Polishd's
  // own dashboard (it reads dashboard telemetry, labelled /~polishd/<tab>):
  // a local capture shoots those tabs too, where the development dashboard
  // is open. The hosted service never does — it would need the dashboard's
  // credentials.
  const scanned = data.pages
    .map((p) => p.path)
    .filter(
      (p) =>
        p.startsWith("/") &&
        !isDashboardPath(p, dashboardRoute) &&
        (!p.startsWith("/~") || (options.engine === "local" && dashboardTabOf(p) !== null)),
    );
  const candidates = scanned.length > 0 ? scanned : ["/"];
  // Pages that are instances of one dynamic route — /posts/<slug> — are shot
  // once, as the most visited of them. The gallery leads with the landing
  // page, so the route cap never cuts it and its phone view goes first.
  const traffic = await getPageTraffic(candidates);
  const distinct = collapseSlugRoutes(candidates, traffic);
  const routes = options.review
    ? pickReviewRoutes(distinct, traffic)
    : [...distinct.filter((r) => r === "/"), ...distinct.filter((r) => r !== "/")].slice(0, MAX_SNAPSHOT_ROUTES);

  // Stamp the snapshot with the design digest's hash — the measurements the
  // AI review is keyed on — so "taken before/after this round of changes" is
  // a hash comparison.
  let fingerprint: string | null = null;
  if (data.ready && data.pages.length > 0) {
    const { settings } = await resolveSettings();
    fingerprint = fingerprintDigest(buildDesignDigest(data, settings.context));
  }

  // The values flagged right now get pictured in place: on a gallery capture
  // so hovering one on the Design tab shows the element that carries it; on
  // a review capture so the model sees it too, failing contrast included.
  const shot = new Set(routes);
  const targets = (options.review ? designReviewTargets(data) : designPreviewTargets(data)).filter((t) =>
    t.pages.some((p) => shot.has(p)),
  );
  return { routes, fingerprint, targets };
}
