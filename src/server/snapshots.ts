/**
 * Polishd — site snapshots (server only).
 *
 * Full-page screenshots of the host site, captured with `allpages` (Playwright
 * underneath). The store's metadata table holds only the index — which
 * snapshots exist, the shots each produced, and the design-metrics fingerprint
 * at capture time — so a snapshot taken before a round of design fixes can
 * later be paired with one taken after, and shots can feed the aesthetic
 * review.
 *
 * The images themselves live in one of two places. On a laptop running
 * `next dev` they sit on disk under `.polishd/snapshots/<id>/`. On Vercel —
 * where the filesystem is read-only and gone by the next invocation — they
 * upload to Vercel Blob instead, switched on by nothing more than the
 * `BLOB_READ_WRITE_TOKEN` a connected Blob store injects. The browser follows
 * the same split: the user's own Chrome or Playwright's Chromium locally,
 * the `@sparticuz/chromium` build (a Chromium compiled to run inside
 * Lambda-shaped Linux containers) as the serverless fallback. Both arrive as
 * optional dependencies, so a standard install needs no extra wiring. Every
 * failure degrades to a message, never a crash — the same contract as the
 * rest of the server layer.
 */
import { isAbsolute, join } from "node:path";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { Browser } from "playwright-core";

import { getMeta, setMeta, storeReady } from "./store";

/** One captured (or deliberately skipped) screenshot within a snapshot. */
export interface PolishdSnapshotShot {
  /** Route path, e.g. "/pricing". */
  route: string;
  /** Device name: "phone" | "desktop". */
  device: string;
  /** "light" | "dark". */
  theme: string;
  /**
   * Image filename inside the snapshot's `shots/` subdirectory — allpages
   * reports and writes bare names there. Empty when the cell was skipped.
   * Still the shot's identifier when the image itself lives in Blob storage.
   */
  file: string;
  /**
   * Where the image uploaded, when it did — set only for Blob-stored shots.
   * Absent on disk-stored shots, whose bytes live under the snapshots root.
   */
  url?: string;
  /** Why the cell has no image, when it doesn't. */
  skipped?: string;
}

/** One capture run: every page of the site at one moment in time. */
export interface PolishdSnapshot {
  id: string;
  capturedAt: number;
  /** The origin that was shot, e.g. "http://localhost:3000". */
  origin: string;
  /**
   * The design-metrics fingerprint at capture time (same hash the AI review
   * caches under). Two snapshots with different fingerprints bracket a design
   * change — the raw material for before/after diffing.
   */
  fingerprint: string | null;
  shots: PolishdSnapshotShot[];
  /** Routes that redirected to something that looked like a login. */
  authWalled: string[];
  /** True when the site rendered identically in light and dark. */
  noDarkMode: boolean;
}

interface SnapshotIndex {
  v: 1;
  snapshots: PolishdSnapshot[];
}

const INDEX_KEY = "design_snapshots";

/** Snapshots kept before the oldest is pruned (files and index entry both). */
const MAX_SNAPSHOTS = 6;

/** Cap on routes shot per run, to bound how long the capture action holds. */
export const MAX_SNAPSHOT_ROUTES = 12;

/** The device/theme matrix every snapshot shoots. */
const SNAPSHOT_DEVICES = ["phone", "desktop"] as const;
const SNAPSHOT_THEMES = ["light", "dark"] as const;

/**
 * True when shots should upload to Vercel Blob rather than land on disk.
 * `BLOB_READ_WRITE_TOKEN` is injected automatically once a Blob store is
 * connected to the project, so presence of the variable is the whole signal —
 * no Polishd-specific configuration on top.
 */
function blobConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

/** Where disk-stored snapshot directories live. Sits next to the dev SQLite file. */
function snapshotsRoot(): string {
  const configured = process.env.POLISHD_SNAPSHOT_DIR;
  if (configured) {
    return isAbsolute(configured) ? configured : join(process.cwd(), configured);
  }
  return join(process.cwd(), ".polishd", "snapshots");
}

async function loadIndex(): Promise<SnapshotIndex> {
  const raw = await getMeta(INDEX_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as SnapshotIndex;
      if (parsed?.v === 1 && Array.isArray(parsed.snapshots)) return parsed;
    } catch {
      // A corrupt index is replaced on the next successful capture.
    }
  }
  return { v: 1, snapshots: [] };
}

/** Every recorded snapshot, newest first. Read-only; `[]` when none/no store. */
export async function listSnapshots(): Promise<PolishdSnapshot[]> {
  return (await loadIndex()).snapshots;
}

/**
 * Read one shot's image as a data URL, or null when it doesn't exist. The
 * filename is only accepted when the index lists it for that snapshot, so a
 * caller can never read outside a snapshot directory — and Blob-stored shots
 * are only ever fetched from the URL the index recorded at capture time.
 */
export async function readSnapshotImage(
  snapshotId: string,
  file: string,
): Promise<string | null> {
  const index = await loadIndex();
  const snapshot = index.snapshots.find((s) => s.id === snapshotId);
  const shot = snapshot?.shots.find((s) => s.file === file && s.file.length > 0);
  if (!snapshot || !shot) return null;
  try {
    if (shot.url) {
      const res = await fetch(shot.url);
      if (!res.ok) return null;
      const bytes = Buffer.from(await res.arrayBuffer());
      return `data:image/png;base64,${bytes.toString("base64")}`;
    }
    const bytes = await readFile(join(snapshotsRoot(), snapshot.id, "shots", shot.file));
    return `data:image/png;base64,${bytes.toString("base64")}`;
  } catch {
    return null; // Directory pruned or deleted by hand — the tile shows a blank.
  }
}

// ── Storage ──────────────────────────────────────────────────────────────────

/**
 * Upload every captured PNG to Vercel Blob and annotate each shot with its
 * URL. The pathnames get a random suffix: public-but-unguessable is the only
 * access model Blob offers, and the dashboard still serves images through the
 * auth-gated action rather than handing these URLs to the browser. Returns an
 * error message, or null when every image landed; on failure the ones already
 * uploaded are deleted, so a half-stored snapshot never survives.
 */
async function uploadShots(
  id: string,
  outDir: string,
  shots: PolishdSnapshotShot[],
): Promise<string | null> {
  let blob: typeof import("@vercel/blob");
  try {
    blob = await import("@vercel/blob");
  } catch {
    return (
      "Blob storage is configured (BLOB_READ_WRITE_TOKEN is set) but @vercel/blob " +
      "isn't installed. It ships as an optional dependency of @polishd/next — " +
      "reinstall without `--omit=optional`."
    );
  }
  const uploaded: string[] = [];
  try {
    for (const shot of shots) {
      if (!shot.file) continue;
      const bytes = await readFile(join(outDir, "shots", shot.file));
      const { url } = await blob.put(`polishd/snapshots/${id}/${shot.file}`, bytes, {
        access: "public",
        contentType: "image/png",
        addRandomSuffix: true,
      });
      shot.url = url;
      uploaded.push(url);
    }
    return null;
  } catch (err) {
    if (uploaded.length > 0) await blob.del(uploaded).catch(() => {});
    return `Couldn't upload screenshots to Vercel Blob: ${
      err instanceof Error ? err.message : "unknown error"
    }`;
  }
}

/**
 * Best-effort removal of a snapshot's images, wherever they were stored.
 * Blob-stored shots carry their URLs in the index; disk-stored ones sit in a
 * directory named by the snapshot id. Both paths swallow failure — an orphaned
 * blob costs cents, a prune that crashed the capture would cost the feature.
 */
async function deleteSnapshotImages(snapshot: PolishdSnapshot): Promise<void> {
  const urls = snapshot.shots.flatMap((s) => (s.url ? [s.url] : []));
  if (urls.length > 0) {
    try {
      const { del } = await import("@vercel/blob");
      await del(urls);
    } catch {
      // SDK missing or the store unreachable — leave the orphans.
    }
  }
  await rm(join(snapshotsRoot(), snapshot.id), { recursive: true, force: true }).catch(
    () => {},
  );
}

// ── Capture ──────────────────────────────────────────────────────────────────

export interface CaptureSnapshotInput {
  /** The site to shoot, scheme included. */
  origin: string;
  /** Paths to shoot — discovery is skipped, these are shot exactly. */
  routes: string[];
  /** Design-metrics fingerprint at capture time, for later pairing. */
  fingerprint: string | null;
}

export type CaptureSnapshotResult =
  | { ok: true; snapshot: PolishdSnapshot }
  | { ok: false; message: string };

/**
 * Launch a Chromium the way the allpages CLI does — the user's own Chrome or
 * Edge first, Playwright's downloaded Chromium next — but never auto-download
 * a browser: that is a 120 MB side effect no dashboard button should trigger
 * silently. On Linux with none of those (the shape of every serverless
 * container) the `@sparticuz/chromium` build takes over: a Chromium compiled
 * to unpack and run inside Lambda-style sandboxes, installed as an optional
 * dependency so production needs no setup step.
 */
async function launchBrowser(): Promise<{ browser: Browser } | { message: string }> {
  const { chromium } = await import("playwright-core");
  const args = ["--force-color-profile=srgb", "--hide-scrollbars"];
  for (const channel of ["chrome", "msedge", undefined] as const) {
    try {
      return { browser: await chromium.launch({ args, ...(channel ? { channel } : {}) }) };
    } catch {
      // Try the next channel.
    }
  }
  if (process.platform === "linux") {
    let sparticuz: (typeof import("@sparticuz/chromium"))["default"] | null;
    try {
      sparticuz = (await import("@sparticuz/chromium")).default;
    } catch {
      sparticuz = null; // Omitted from the install — named in the message below.
    }
    if (sparticuz) {
      try {
        return {
          browser: await chromium.launch({
            // The sparticuz flags (--no-sandbox, --single-process, …) are what
            // let Chromium run in a serverless sandbox at all; ours follow.
            args: [...sparticuz.args, ...args],
            executablePath: await sparticuz.executablePath(),
          }),
        };
      } catch (err) {
        return {
          message: `The serverless Chromium (@sparticuz/chromium) failed to launch: ${
            err instanceof Error ? err.message : "unknown error"
          }`,
        };
      }
    }
    return {
      message:
        "Couldn't start a browser for screenshots — no Chrome, Edge, or Playwright " +
        "Chromium was found, and the @sparticuz/chromium fallback isn't installed. " +
        "It ships as an optional dependency of @polishd/next, so this install was " +
        "likely run with `--omit=optional` — reinstall with optional dependencies " +
        "included (or run `npx playwright install chromium`), then capture again.",
    };
  }
  return {
    message:
      "Couldn't start a browser for screenshots — no Chrome or Edge was found, and " +
      "Playwright's Chromium isn't installed. Run `npx playwright install chromium` " +
      "once, then capture again.",
  };
}

/**
 * A problem that will make the next capture fail, detectable from the
 * environment alone — or null when none is. Covers the two setup gaps a
 * serverless deploy can have: no Blob store connected (nowhere for images to
 * live when the filesystem is read-only), and the `--omit=optional` install
 * missing a dependency the environment says will be needed. Either way the
 * dashboard can say so up front rather than a minute into a doomed capture,
 * and `captureSnapshot` runs the same check for callers that never rendered
 * the dashboard.
 */
export async function snapshotCaptureIssue(): Promise<string | null> {
  // On Vercel the filesystem is read-only and reset between invocations, so
  // disk storage — the fallback when no Blob token is present — cannot work.
  // Without a connected store every capture is doomed before it starts.
  if (process.env.VERCEL && !blobConfigured()) {
    return (
      "Snapshot images have nowhere to live on this deployment: the filesystem " +
      "is read-only and no Blob store is connected. Connect a Vercel Blob store " +
      "to the project (Storage → Blob in the Vercel dashboard) — the " +
      "BLOB_READ_WRITE_TOKEN it injects switches snapshot storage over " +
      "automatically — then redeploy."
    );
  }
  if (blobConfigured()) {
    try {
      await import("@vercel/blob");
    } catch {
      return (
        "Snapshot images would upload to Vercel Blob (BLOB_READ_WRITE_TOKEN is set), " +
        "but @vercel/blob isn't installed. It ships as an optional dependency of " +
        "@polishd/next, so this install was likely run with `--omit=optional` — " +
        "reinstall with optional dependencies included, then redeploy."
      );
    }
  }
  // On Vercel there is never a system Chrome and never a Playwright download,
  // so the sparticuz build is not a fallback but the only browser that can
  // launch — its absence is a certain failure worth flagging early.
  if (process.env.VERCEL && process.platform === "linux") {
    try {
      await import("@sparticuz/chromium");
    } catch {
      return (
        "Capturing snapshots here needs the serverless Chromium from " +
        "@sparticuz/chromium, which isn't installed. It ships as an optional " +
        "dependency of @polishd/next, so this install was likely run with " +
        "`--omit=optional` — reinstall with optional dependencies included, " +
        "then redeploy."
      );
    }
  }
  return null;
}

/**
 * Shoot the given routes and record the run in the snapshot index. Old
 * snapshots past `MAX_SNAPSHOTS` are pruned, images included.
 */
export async function captureSnapshot(
  input: CaptureSnapshotInput,
): Promise<CaptureSnapshotResult> {
  if (!(await storeReady())) {
    return {
      ok: false,
      message:
        "The analytics store isn't writable here, so a snapshot couldn't be recorded. " +
        "Run locally or configure a database — see DATABASE.md.",
    };
  }

  // The same preflight the dashboard runs before enabling the capture button.
  // Actions are reachable without the dashboard ever rendering, so a doomed
  // environment must fail here too — with the diagnosis, not a minute of
  // capture ending in an EROFS.
  const issue = await snapshotCaptureIssue();
  if (issue) return { ok: false, message: issue };

  let run: typeof import("allpages").allpages;
  try {
    ({ allpages: run } = await import("allpages"));
  } catch (err) {
    return {
      ok: false,
      message: `The allpages screenshot engine failed to load: ${
        err instanceof Error ? err.message : "unknown error"
      }`,
    };
  }

  const launched = await launchBrowser();
  if ("message" in launched) return { ok: false, message: launched.message };

  const id = `${Date.now().toString(36)}`;
  const toBlob = blobConfigured();

  // In Blob mode allpages still writes to disk first, but into the system
  // temp directory — the one location serverless hosts keep writable — and
  // the files only exist for the moments between capture and upload.
  let outDir: string;
  try {
    if (toBlob) {
      outDir = await mkdtemp(join(tmpdir(), "polishd-snapshot-"));
    } else {
      outDir = join(snapshotsRoot(), id);
      await mkdir(outDir, { recursive: true });
    }
  } catch (err) {
    await launched.browser.close().catch(() => {});
    return {
      ok: false,
      message: `Couldn't create the snapshot directory (${
        err instanceof Error ? err.message : "unknown error"
      }) — is the filesystem writable?`,
    };
  }

  try {
    const result = await run({
      url: input.origin,
      routes: input.routes.slice(0, MAX_SNAPSHOT_ROUTES),
      outDir,
      devices: [...SNAPSHOT_DEVICES],
      themes: [...SNAPSHOT_THEMES],
      // The dashboard composes its own grid; the stitched contact sheet would
      // only duplicate every image on disk.
      skipSheet: true,
      browser: launched.browser,
    });

    const snapshot: PolishdSnapshot = {
      id,
      capturedAt: Date.now(),
      origin: input.origin,
      fingerprint: input.fingerprint,
      shots: result.shots.map((s) => ({
        route: s.route.path,
        device: s.device.name,
        theme: s.theme,
        file: s.file ?? "",
        ...(s.skipped ? { skipped: s.skipped } : {}),
      })),
      authWalled: result.authWalled,
      noDarkMode: result.noDarkMode,
    };

    if (snapshot.shots.every((s) => !s.file)) {
      await rm(outDir, { recursive: true, force: true }).catch(() => {});
      return {
        ok: false,
        message:
          "Every page failed to capture — is the site reachable at " +
          `${input.origin} from this process?`,
      };
    }

    if (toBlob) {
      const failure = await uploadShots(id, outDir, snapshot.shots);
      if (failure) return { ok: false, message: failure };
    }

    const index = await loadIndex();
    index.snapshots.unshift(snapshot);
    const pruned = index.snapshots.slice(MAX_SNAPSHOTS);
    index.snapshots = index.snapshots.slice(0, MAX_SNAPSHOTS);
    if (!(await setMeta(INDEX_KEY, JSON.stringify(index)))) {
      await deleteSnapshotImages(snapshot);
      return {
        ok: false,
        message: "The snapshot was shot but the store refused to record it.",
      };
    }
    for (const old of pruned) {
      await deleteSnapshotImages(old);
    }

    return { ok: true, snapshot };
  } catch (err) {
    await rm(outDir, { recursive: true, force: true }).catch(() => {});
    return {
      ok: false,
      message: `Screenshot capture failed: ${
        err instanceof Error ? err.message : "unknown error"
      }`,
    };
  } finally {
    await launched.browser.close().catch(() => {});
    // The temp staging directory never outlives the capture; the disk-mode
    // directory is the storage itself and stays.
    if (toBlob) await rm(outDir, { recursive: true, force: true }).catch(() => {});
  }
}
