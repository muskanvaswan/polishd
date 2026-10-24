"use server";

/**
 * Polishd — server actions for site snapshots (the Design tab's gallery).
 *
 * Like every server action in this package, each one gates on
 * `requirePolishdAuth()` first: action ids ship in the public client bundle,
 * so these are reachable whether or not the dashboard page ever rendered.
 *
 * The capture itself is driven from the browser (see snapshot-capture.ts):
 * the dashboard asks for a plan, sends each route to Polishd's screenshot
 * service — or, for a site the service can't reach, has this server shoot it
 * — stores the images, and reports each cell back here. These actions plan,
 * issue upload targets, check and record, and close the snapshot. None of
 * them carries an image larger than a chunk: a server action accepts 1 MB.
 *
 * Image bytes for display travel through an action rather than a new GET
 * route on purpose: the ingest route is the package's only public endpoint,
 * and consumers wire it up by re-exporting `POST` alone — a new handler would
 * silently not exist on every install that doesn't update that one-line file.
 * Actions need no wiring and inherit the auth guard.
 *
 * Everything after auth reduces to a message rather than a thrown error: a
 * rejected action crashes the dashboard tab into Next's error boundary with
 * an opaque digest, while a returned message renders in the card.
 */
import { buildDesignDigest } from "../ai/design";
import { fingerprintDigest } from "../ai/digest";
import { requirePolishdAuth } from "../ai/guard";
import { resolveSettings } from "../ai/settings";
import { parseCaptureBlock, type StoredCaptureBlock } from "../capture/protocol";
import { isDashboardPath, resolveDashboardRoute } from "../config";
import { getDesignData } from "../server/design";
import type { ShotSlot } from "../server/snapshot-files";
import { resolveSiteOrigin } from "../server/site-origin";
import {
  MAX_SNAPSHOT_ROUTES,
  appendSnapshotChunk,
  beginSnapshot,
  captureLocalShot,
  finishSnapshot,
  readSnapshotImage,
  recordSnapshotShot,
  saveSnapshotBlock,
  saveSnapshotConsent,
  snapshotAvailability,
  snapshotUploadTarget,
  type Failure,
  type LocalShotResult,
  type PolishdSnapshot,
  type ShotRecord,
  type SnapshotAvailability,
  type SnapshotPlan,
  type UploadTarget,
} from "../server/snapshots";
import { designPreviewTargets } from "../shared/design-values";

function failed(prefix: string, err: unknown): Failure {
  return { ok: false, message: `${prefix}: ${err instanceof Error ? err.message : "unknown error"}` };
}

/** Plan a capture: the routes, renderings and values to picture, and who shoots. */
export async function beginSnapshotCaptureAction(): Promise<
  ({ ok: true } & SnapshotPlan) | (Failure & { consentRequired?: true })
> {
  await requirePolishdAuth();
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

    const data = await getDesignData();
    const dashboardRoute = resolveDashboardRoute();
    // Shoot what visitors have actually rendered, never the dashboard itself
    // (nor the telemetry pseudo-paths the collector namespaces under /~polishd).
    const scanned = data.pages
      .map((p) => p.path)
      .filter(
        (p) => p.startsWith("/") && !p.startsWith("/~") && !isDashboardPath(p, dashboardRoute),
      );
    const routes = (scanned.length > 0 ? scanned : ["/"]).slice(0, MAX_SNAPSHOT_ROUTES);

    // Stamp the snapshot with the same metrics fingerprint the AI review caches
    // under, so "taken before/after this round of changes" is a hash comparison.
    let fingerprint: string | null = null;
    if (data.ready && data.pages.length > 0) {
      const { settings } = await resolveSettings();
      fingerprint = fingerprintDigest(buildDesignDigest(data, settings.context));
    }

    // The one-off and off-grid values flagged right now get pictured in place,
    // so hovering one on the Design tab shows the element that carries it.
    const shot = new Set(routes);
    const targets = designPreviewTargets(data).filter((t) => t.pages.some((p) => shot.has(p)));

    // The same decision the Design tab rendered with, re-made per call: the
    // service is only ever used once the owner has agreed to it.
    const { mode, storageIssue } = await snapshotAvailability(origin);
    if (mode.kind === "consent") {
      // Asked on the first capture, not before: the dashboard opens the
      // consent dialog on this answer and captures once it's allowed.
      return {
        ok: false,
        consentRequired: true,
        message: "Allow Polishd's screenshot service to capture.",
      };
    }
    if (mode.kind === "disabled") {
      return {
        ok: false,
        message:
          mode.reason === "no_storage"
            ? (storageIssue ?? "Snapshot images have nowhere to be stored here.")
            : mode.reason === "declined"
              ? "Site snapshots are off: Polishd's screenshot service wasn't allowed."
              : "Site snapshots are off on this deployment (POLISHD_SNAPSHOT_SERVICE=off).",
      };
    }
    const engine = mode.kind === "service" ? { kind: "service" as const, url: mode.url } : { kind: "local" as const };
    return await beginSnapshot({ origin, routes, fingerprint, targets, engine });
  } catch (err) {
    return failed("Snapshot capture failed unexpectedly", err);
  }
}

/**
 * The owner's answer to the consent dialog — may production snapshots call
 * Polishd's screenshot service? Returns the section's mode afterwards.
 */
export async function setSnapshotServiceConsentAction(
  allow: boolean,
): Promise<({ ok: true } & SnapshotAvailability) | Failure> {
  await requirePolishdAuth();
  try {
    if (!(await saveSnapshotConsent(allow === true))) {
      return { ok: false, message: "The store refused to record the choice." };
    }
    return { ok: true, ...(await snapshotAvailability(await resolveSiteOrigin())) };
  } catch (err) {
    return failed("Couldn't record the choice", err);
  }
}

/**
 * Remember why the last capture couldn't use the service (null: it got
 * through), so the section stays off at the bottom of the tab until a
 * capture succeeds — across reloads, not just this page view.
 */
export async function setSnapshotBlockAction(
  block: unknown,
): Promise<({ ok: true; block: StoredCaptureBlock | null }) | Failure> {
  await requirePolishdAuth();
  try {
    const parsed = block === null ? null : parseCaptureBlock(block);
    if (block !== null && !parsed) return { ok: false, message: "That isn't a capture block." };
    return { ok: true, block: await saveSnapshotBlock(parsed) };
  } catch (err) {
    return failed("Couldn't record the capture's outcome", err);
  }
}

/** Where to put one image: a presigned Blob URL, or a disk file to stream chunks to. */
export async function snapshotUploadTargetAction(
  id: string,
  slot: ShotSlot,
  type: string,
  size: number,
): Promise<({ ok: true } & UploadTarget) | Failure> {
  await requirePolishdAuth();
  try {
    return await snapshotUploadTarget(id, slot, type, size);
  } catch (err) {
    return failed("Couldn't prepare the upload", err);
  }
}

/** One chunk of a disk-stored image (base64, well under the 1 MB action limit). */
export async function appendSnapshotChunkAction(
  id: string,
  file: string,
  offset: number,
  base64: string,
  last: boolean,
): Promise<{ ok: true } | Failure> {
  await requirePolishdAuth();
  try {
    return await appendSnapshotChunk(id, file, offset, base64, last);
  } catch (err) {
    return failed("Couldn't store the image", err);
  }
}

/** Record one cell shot through the service, once its images are stored. */
export async function recordSnapshotShotAction(
  id: string,
  record: ShotRecord,
): Promise<{ ok: true } | Failure> {
  await requirePolishdAuth();
  try {
    return await recordSnapshotShot(id, record);
  } catch (err) {
    return failed("Couldn't record the shot", err);
  }
}

/** Shoot, store and record one cell with this server's own browser. */
export async function captureLocalShotAction(
  id: string,
  slot: ShotSlot,
  findKeys: string[],
): Promise<LocalShotResult> {
  await requirePolishdAuth();
  try {
    return await captureLocalShot(id, slot, findKeys);
  } catch (err) {
    return failed("Screenshot capture failed unexpectedly", err);
  }
}

/** Record the accumulated shots as a snapshot and prune old ones. */
export async function finishSnapshotCaptureAction(
  id: string,
): Promise<{ ok: true; snapshot: PolishdSnapshot } | Failure> {
  await requirePolishdAuth();
  try {
    return await finishSnapshot(id);
  } catch (err) {
    return failed("The snapshot couldn't be recorded", err);
  }
}

export type SnapshotImageResult = { ok: true; dataUrl: string } | { ok: false };

/** One shot's image as a data URL — fetched lazily as tiles scroll into use. */
export async function getSnapshotImageAction(
  snapshotId: string,
  file: string,
): Promise<SnapshotImageResult> {
  await requirePolishdAuth();
  const dataUrl = await readSnapshotImage(snapshotId, file);
  return dataUrl ? { ok: true, dataUrl } : { ok: false };
}
