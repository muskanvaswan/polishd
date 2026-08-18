/**
 * Polishd — site snapshots (server only).
 *
 * Full-page screenshots of the host site, captured with `allpages` (Playwright
 * underneath) and kept on disk under `.polishd/snapshots/<id>/`. The store's
 * metadata table holds only the index — which snapshots exist, the shots each
 * produced, and the design-metrics fingerprint at capture time — so a snapshot
 * taken before a round of design fixes can later be paired with one taken
 * after, and shots can feed the aesthetic review.
 *
 * Capture is a dev-time affair: it needs a writable filesystem and a Chromium
 * it can launch, both true on the laptop running `next dev` and generally
 * false on serverless hosts. Every failure degrades to a message, never a
 * crash — the same contract as the rest of the server layer.
 */
import { isAbsolute, join } from "node:path";
import { mkdir, readFile, rm } from "node:fs/promises";
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
   */
  file: string;
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

/** Where snapshot directories live. Sits next to the dev SQLite file. */
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
 * caller can never read outside a snapshot directory.
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
    const bytes = await readFile(join(snapshotsRoot(), snapshot.id, "shots", shot.file));
    return `data:image/png;base64,${bytes.toString("base64")}`;
  } catch {
    return null; // Directory pruned or deleted by hand — the tile shows a blank.
  }
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
 * Edge first, Playwright's downloaded Chromium as the fallback — but never
 * auto-download a browser: that is a 120 MB side effect no dashboard button
 * should trigger silently, so it surfaces as an instruction instead.
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
  return {
    message:
      "Couldn't start a browser for screenshots — no Chrome or Edge was found, and " +
      "Playwright's Chromium isn't installed. Run `npx playwright install chromium` " +
      "once, then capture again.",
  };
}

/**
 * Shoot the given routes and record the run in the snapshot index. Old
 * snapshots past `MAX_SNAPSHOTS` are pruned, files included.
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
  const outDir = join(snapshotsRoot(), id);

  try {
    await mkdir(outDir, { recursive: true });
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

    const index = await loadIndex();
    index.snapshots.unshift(snapshot);
    const pruned = index.snapshots.slice(MAX_SNAPSHOTS);
    index.snapshots = index.snapshots.slice(0, MAX_SNAPSHOTS);
    if (!(await setMeta(INDEX_KEY, JSON.stringify(index)))) {
      await rm(outDir, { recursive: true, force: true }).catch(() => {});
      return {
        ok: false,
        message: "The snapshot was shot but the store refused to record it.",
      };
    }
    for (const old of pruned) {
      await rm(join(snapshotsRoot(), old.id), { recursive: true, force: true }).catch(
        () => {},
      );
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
  }
}
