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
  beginSnapshot,
  captureSnapshotRoute,
  finishSnapshot,
  readSnapshotImage,
  type BeginSnapshotResult,
  type CaptureRouteResult,
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
 * A denial, phrased for the error box. The capture actions return this rather
 * than letting `PolishdUnauthorizedError` propagate: a thrown error reaches
 * the dashboard as an opaque digest, while the capture UI renders a returned
 * message. The denial itself is unchanged — no work happens.
 */
const DENIED = {
  ok: false as const,
  message:
    "This dashboard session isn't authorized to capture. Reload the dashboard " +
    "— if it asks you to unlock again, do so — then retry.",
};

/** True when the caller may proceed; false is a denial. */
async function authorized(): Promise<boolean> {
  try {
    await requirePolishdAuth();
    return true;
  } catch {
    return false;
  }
}

/**
 * Capture is chunked into one action call per route — begin, then one
 * `captureSnapshotRouteAction` per returned route, then finish — so no single
 * request has to outlive a serverless host's function time limit. The client
 * drives the loop; every per-route call is validated against the plan the
 * begin call parked server-side, so the client contributes nothing but ids.
 *
 * Everything after auth reduces to a message rather than a thrown error: a
 * rejected action crashes the dashboard tab into Next's error boundary with
 * an opaque digest, while a returned message renders in the card.
 */
export async function beginSnapshotCaptureAction(): Promise<BeginSnapshotResult> {
  if (!(await authorized())) return DENIED;

  try {
    const origin = await resolveSiteOrigin();
    if (!origin) {
      return {
        ok: false,
        message:
          "Couldn't work out the site's URL from the request — set POLISHD_SITE_ORIGIN " +
          "to the origin the site is reachable at.",
      };
    }

    // The scanned-page list and the fingerprint are both nice-to-haves from
    // the design data; a database hiccup here must not sink the capture, so
    // they degrade to shooting the root with no fingerprint.
    let routes = ["/"];
    let fingerprint: string | null = null;
    try {
      const data = await getDesignData();
      const dashboardRoute = resolveDashboardRoute();
      // Shoot what visitors have actually rendered, never the dashboard itself
      // (nor the telemetry pseudo-paths the collector namespaces under /~polishd).
      const scanned = data.pages
        .map((p) => p.path)
        .filter(
          (p) => p.startsWith("/") && !p.startsWith("/~") && !isDashboardPath(p, dashboardRoute),
        );
      routes = (scanned.length > 0 ? scanned : ["/"]).slice(0, MAX_SNAPSHOT_ROUTES);

      // Stamp the snapshot with the same metrics fingerprint the AI review
      // caches under, so "taken before/after this round of changes" is a hash
      // comparison.
      if (data.ready && data.pages.length > 0) {
        const { settings } = await resolveSettings();
        fingerprint = fingerprintDigest(buildDesignDigest(data, settings.context));
      }
    } catch (err) {
      console.error("[polishd] snapshot route planning failed, shooting / only:", err);
    }

    return await beginSnapshot({ origin, routes, fingerprint });
  } catch (err) {
    console.error("[polishd] beginSnapshotCaptureAction failed:", err);
    return {
      ok: false,
      message: `Snapshot capture failed unexpectedly: ${
        err instanceof Error ? err.message : "unknown error"
      }`,
    };
  }
}

/** Shoot one route of the capture in progress — both devices, both themes. */
export async function captureSnapshotRouteAction(
  id: string,
  route: string,
): Promise<CaptureRouteResult> {
  if (!(await authorized())) return DENIED;
  try {
    return await captureSnapshotRoute(id, route);
  } catch (err) {
    console.error("[polishd] captureSnapshotRouteAction failed:", err);
    return {
      ok: false,
      message: `Screenshot capture failed unexpectedly: ${
        err instanceof Error ? err.message : "unknown error"
      }`,
    };
  }
}

/** Record the accumulated shots as a snapshot and prune old ones. */
export async function finishSnapshotCaptureAction(
  id: string,
): Promise<CaptureSnapshotResult> {
  if (!(await authorized())) return DENIED;
  try {
    return await finishSnapshot(id);
  } catch (err) {
    console.error("[polishd] finishSnapshotCaptureAction failed:", err);
    return {
      ok: false,
      message: `The snapshot couldn't be recorded: ${
        err instanceof Error ? err.message : "unknown error"
      }`,
    };
  }
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
