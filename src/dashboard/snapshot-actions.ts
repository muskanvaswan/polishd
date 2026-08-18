"use server";

/**
 * Polishd — server actions for site snapshots (the Design tab's gallery).
 *
 * Like every server action in this package, each one gates on
 * `requirePolishdAuth()` first: action ids ship in the public client bundle,
 * so these are reachable whether or not the dashboard page ever rendered.
 *
 * Image bytes travel through an action rather than a new GET route on purpose:
 * the ingest route is the package's only public endpoint, and consumers wire
 * it up by re-exporting `POST` alone — a new handler would silently not exist
 * on every install that doesn't update that one-line file. Actions need no
 * wiring and inherit the auth guard.
 */
import { headers } from "next/headers";

import { buildDesignDigest } from "../ai/design";
import { fingerprintDigest } from "../ai/digest";
import { requirePolishdAuth } from "../ai/guard";
import { resolveSettings } from "../ai/settings";
import { isDashboardPath, resolveDashboardRoute } from "../config";
import { getDesignData } from "../server/design";
import {
  MAX_SNAPSHOT_ROUTES,
  captureSnapshot,
  readSnapshotImage,
  type CaptureSnapshotResult,
} from "../server/snapshots";

/**
 * The origin to shoot. `POLISHD_SITE_ORIGIN` wins when set (proxies, tunnels,
 * a prod URL shot from a dev machine); otherwise the origin the dashboard was
 * itself requested on — the one URL the server is guaranteed to be reachable
 * at, learned from the request rather than configuration.
 */
async function resolveSiteOrigin(): Promise<string | null> {
  const configured = process.env.POLISHD_SITE_ORIGIN;
  if (configured) return configured.replace(/\/+$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return null;
  const proto =
    h.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * Shoot the site as it stands: every scanned route (the pages real visitors
 * actually rendered), phone and desktop, light and dark. Long-running — a
 * dozen routes takes on the order of a minute.
 */
export async function captureSnapshotAction(): Promise<CaptureSnapshotResult> {
  await requirePolishdAuth();

  const origin = await resolveSiteOrigin();
  if (!origin) {
    return {
      ok: false,
      message:
        "Couldn't work out the site's URL from the request — set POLISHD_SITE_ORIGIN " +
        "to the origin the site is reachable at.",
    };
  }

  const data = await getDesignData();
  const dashboardRoute = resolveDashboardRoute();
  // Shoot what visitors have actually rendered, never the dashboard itself
  // (nor the telemetry pseudo-paths the collector namespaces under /~polishd).
  const scanned = data.pages
    .map((p) => p.path)
    .filter((p) => p.startsWith("/") && !p.startsWith("/~") && !isDashboardPath(p, dashboardRoute));
  const routes = (scanned.length > 0 ? scanned : ["/"]).slice(0, MAX_SNAPSHOT_ROUTES);

  // Stamp the snapshot with the same metrics fingerprint the AI review caches
  // under, so "taken before/after this round of changes" is a hash comparison.
  let fingerprint: string | null = null;
  if (data.ready && data.pages.length > 0) {
    const { settings } = await resolveSettings();
    fingerprint = fingerprintDigest(buildDesignDigest(data, settings.context));
  }

  return captureSnapshot({ origin, routes, fingerprint });
}

export type SnapshotImageResult = { ok: true; dataUrl: string } | { ok: false };

/** One shot's PNG as a data URL — fetched lazily as tiles scroll into use. */
export async function getSnapshotImageAction(
  snapshotId: string,
  file: string,
): Promise<SnapshotImageResult> {
  await requirePolishdAuth();
  const dataUrl = await readSnapshotImage(snapshotId, file);
  return dataUrl ? { ok: true, dataUrl } : { ok: false };
}
