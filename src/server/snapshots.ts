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
 *
 * Alongside the full shots, each route call also pictures the Design tab's
 * flagged values in place — a ringed crop of the element carrying a one-off
 * type style, color, radius or off-grid padding (server/value-previews.ts) —
 * stored beside the shots under the same disk-or-Blob rule, and listed in the
 * snapshot as `previews` so hovering the value on the dashboard shows where
 * it renders.
 *
 * Capture is chunked into one server call per route: begin → one
 * `captureSnapshotRoute` per route → finish, with the in-flight state parked
 * in the store between calls. A whole-site capture in a single request would
 * have to outlive a serverless host's function time limit — which the package
 * cannot raise on the host's behalf (`maxDuration` must be declared inline in
 * the host's own page module), and which kills the function mid-shoot with no
 * result at all. One route per request keeps every call short enough to fit.
 */
import { isAbsolute, join } from "node:path";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { Shot as AllpagesShot } from "allpages";
import type { Browser } from "playwright-core";

import type { DesignPreviewTarget } from "../shared/design-values";
import { getMeta, setMeta, storeReady } from "./store";
import { captureValuePreviews, type PreviewRendering } from "./value-previews";

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

/**
 * A cropped picture of one flagged design value in place — the element that
 * carries a one-off type style, color, radius or off-grid padding, ringed,
 * with the component around it. Shot during the capture, from the same
 * rendering as the route's full shots.
 */
export interface PolishdSnapshotPreview {
  /** The value pictured — `designValueKey` of its target. */
  key: string;
  route: string;
  device: string;
  theme: string;
  /** Image filename inside the snapshot's `previews/` subdirectory. */
  file: string;
  /** Where the image uploaded, for Blob-stored previews. */
  url?: string;
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
  /** Pictures of the flagged values, where each one renders. Absent on older snapshots. */
  previews?: PolishdSnapshotPreview[];
  /**
   * Values this capture looked for on their pages and never found on screen
   * — rendered only after an interaction, or only at a width it didn't shoot.
   */
  previewMisses?: string[];
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
 * Where a flagged value is looked for, in order: the gallery's default view
 * first, so most pictures match the shot the user is already looking at.
 */
const PREVIEW_RENDERINGS: PreviewRendering[] = [
  { device: "desktop", theme: "light" },
  { device: "desktop", theme: "dark" },
  { device: "phone", theme: "light" },
  { device: "phone", theme: "dark" },
];
/** Values pictured per route, and the time the pass may add to its call. */
const MAX_PREVIEWS_PER_ROUTE = 16;
const PREVIEW_BUDGET_MS = 15_000;

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
 * Read one shot's — or one value preview's — image as a data URL, or null
 * when it doesn't exist. The filename is only accepted when the index lists it
 * for that snapshot, so a caller can never read outside a snapshot directory —
 * and Blob-stored images are only ever fetched from the URL the index recorded
 * at capture time.
 */
export async function readSnapshotImage(
  snapshotId: string,
  file: string,
): Promise<string | null> {
  const index = await loadIndex();
  const snapshot = index.snapshots.find((s) => s.id === snapshotId);
  if (!snapshot || file.length === 0) return null;
  const shot = snapshot.shots.find((s) => s.file === file);
  const preview = shot ? undefined : snapshot.previews?.find((p) => p.file === file);
  const image = shot ?? preview;
  if (!image) return null;
  try {
    if (image.url) {
      const res = await fetch(image.url);
      if (!res.ok) return null;
      const bytes = Buffer.from(await res.arrayBuffer());
      return `data:image/png;base64,${bytes.toString("base64")}`;
    }
    const dir = shot ? "shots" : "previews";
    const bytes = await readFile(join(snapshotsRoot(), snapshot.id, dir, image.file));
    return `data:image/png;base64,${bytes.toString("base64")}`;
  } catch {
    return null; // Directory pruned or deleted by hand — the tile shows a blank.
  }
}

// ── Storage ──────────────────────────────────────────────────────────────────

/**
 * Move one route's staged PNGs to their real home — Vercel Blob when a token
 * is present, the snapshots directory otherwise — under a per-route filename
 * prefix: allpages slugs are only unique within a single run, and each route
 * is its own run now. Blob pathnames get a random suffix on top —
 * public-but-unguessable is the only access model Blob offers, and the
 * dashboard still serves images through the auth-gated action rather than
 * handing these URLs to the browser. On a failed upload the pieces already
 * uploaded are deleted, so a half-stored route never survives.
 */
async function storeRouteShots(
  id: string,
  routeIndex: number,
  stageDir: string,
  captured: AllpagesShot[],
): Promise<{ shots: PolishdSnapshotShot[] } | { message: string }> {
  const prefix = `r${routeIndex}-`;
  const shots: PolishdSnapshotShot[] = [];
  const toShot = (s: AllpagesShot, file: string, url?: string): PolishdSnapshotShot => ({
    route: s.route.path,
    device: s.device.name,
    theme: s.theme,
    file,
    ...(url ? { url } : {}),
    ...(s.skipped ? { skipped: s.skipped } : {}),
  });

  if (!blobConfigured()) {
    const shotsDir = join(snapshotsRoot(), id, "shots");
    await mkdir(shotsDir, { recursive: true });
    for (const s of captured) {
      if (!s.file) {
        shots.push(toShot(s, ""));
        continue;
      }
      await copyFile(join(stageDir, "shots", s.file), join(shotsDir, prefix + s.file));
      shots.push(toShot(s, prefix + s.file));
    }
    return { shots };
  }

  const blob = await loadBlobSdk();
  if ("message" in blob) return blob;
  const uploaded: string[] = [];
  try {
    for (const s of captured) {
      if (!s.file) {
        shots.push(toShot(s, ""));
        continue;
      }
      const bytes = await readFile(join(stageDir, "shots", s.file));
      const { url } = await blob.put(`polishd/snapshots/${id}/${prefix}${s.file}`, bytes, {
        access: "public",
        contentType: "image/png",
        addRandomSuffix: true,
      });
      uploaded.push(url);
      shots.push(toShot(s, prefix + s.file, url));
    }
    return { shots };
  } catch (err) {
    if (uploaded.length > 0) await blob.del(uploaded).catch(() => {});
    return {
      message: `Couldn't upload screenshots to Vercel Blob: ${
        err instanceof Error ? err.message : "unknown error"
      }`,
    };
  }
}

/** The Blob SDK, or why it couldn't load. */
async function loadBlobSdk(): Promise<typeof import("@vercel/blob") | { message: string }> {
  try {
    return await import("@vercel/blob");
  } catch {
    return {
      message:
        "Blob storage is configured (BLOB_READ_WRITE_TOKEN is set) but @vercel/blob " +
        "isn't installed. It ships as an optional dependency of @polishd/next — " +
        "reinstall without `--omit=optional`.",
    };
  }
}

/**
 * Store one route's value previews next to its shots — the snapshot's
 * `previews/` directory, or Blob under the same rules as the shots. Names are
 * `v-r<route>-<n>-<device>-<theme>.png`, unique within the snapshot and never
 * mistakable for a shot's. All or nothing, like the shots: a failed upload
 * deletes the pieces already sent.
 */
async function storeRoutePreviews(
  id: string,
  routeIndex: number,
  route: string,
  crops: { key: string; device: string; theme: string; bytes: Buffer }[],
): Promise<PolishdSnapshotPreview[]> {
  const named = crops.map((c, n) => ({
    ...c,
    file: `v-r${routeIndex}-${n}-${c.device}-${c.theme}.png`,
  }));
  const toPreview = (c: (typeof named)[number], url?: string): PolishdSnapshotPreview => ({
    key: c.key,
    route,
    device: c.device,
    theme: c.theme,
    file: c.file,
    ...(url ? { url } : {}),
  });

  if (!blobConfigured()) {
    const dir = join(snapshotsRoot(), id, "previews");
    await mkdir(dir, { recursive: true });
    for (const c of named) await writeFile(join(dir, c.file), c.bytes);
    return named.map((c) => toPreview(c));
  }

  const blob = await loadBlobSdk();
  if ("message" in blob) return [];
  const uploaded: string[] = [];
  try {
    const previews: PolishdSnapshotPreview[] = [];
    for (const c of named) {
      const { url } = await blob.put(`polishd/snapshots/${id}/previews/${c.file}`, c.bytes, {
        access: "public",
        contentType: "image/png",
        addRandomSuffix: true,
      });
      uploaded.push(url);
      previews.push(toPreview(c, url));
    }
    return previews;
  } catch {
    if (uploaded.length > 0) await blob.del(uploaded).catch(() => {});
    return [];
  }
}

/**
 * Best-effort removal of a snapshot's images, wherever they were stored.
 * Blob-stored shots carry their URLs in the index; disk-stored ones sit in a
 * directory named by the snapshot id. Both paths swallow failure — an orphaned
 * blob costs cents, a prune that crashed the capture would cost the feature.
 */
async function deleteSnapshotImages(
  snapshot: Pick<PolishdSnapshot, "id" | "shots" | "previews">,
): Promise<void> {
  const urls = [...snapshot.shots, ...(snapshot.previews ?? [])].flatMap((s) =>
    s.url ? [s.url] : [],
  );
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

export interface BeginSnapshotInput {
  /** The site to shoot, scheme included. */
  origin: string;
  /** Paths to shoot — discovery is skipped, these are shot exactly. */
  routes: string[];
  /** Design-metrics fingerprint at capture time, for later pairing. */
  fingerprint: string | null;
  /** Flagged values to picture in place, each on the pages it was measured on. */
  targets?: DesignPreviewTarget[];
}

export type BeginSnapshotResult =
  | { ok: true; id: string; routes: string[] }
  | { ok: false; message: string };

export type CaptureRouteResult =
  | { ok: true; shots: PolishdSnapshotShot[] }
  | { ok: false; message: string };

export type CaptureSnapshotResult =
  | { ok: true; snapshot: PolishdSnapshot }
  | { ok: false; message: string };

/**
 * The capture in progress, parked in the store between per-route calls. This
 * record — not anything the client sends — is what each `captureSnapshotRoute`
 * call trusts for the origin, the route list, and the shots accumulated so
 * far; the client only ever hands back the id. One capture runs at a time: a
 * new begin sweeps an unfinished predecessor, images and all.
 */
interface PendingSnapshot {
  v: 1;
  id: string;
  origin: string;
  fingerprint: string | null;
  startedAt: number;
  /** The plan, in order. Route calls are validated against it. */
  routes: string[];
  /** Routes already captured, so a retried call doesn't shoot twice. */
  done: string[];
  shots: PolishdSnapshotShot[];
  authWalled: string[];
  /** Stays true only while every route with images rendered identically dark. */
  noDarkMode: boolean;
  /** Values to picture; each is dropped from later routes once pictured. */
  targets: DesignPreviewTarget[];
  previews: PolishdSnapshotPreview[];
  /** Keys looked for on a route and not found there. */
  previewMisses: string[];
}

const PENDING_KEY = "design_snapshot_pending";

async function loadPending(): Promise<PendingSnapshot | null> {
  const raw = await getMeta(PENDING_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PendingSnapshot;
    if (parsed?.v === 1 && typeof parsed.id === "string") {
      // Records parked by a version without value previews.
      parsed.targets ??= [];
      parsed.previews ??= [];
      parsed.previewMisses ??= [];
      return parsed;
    }
  } catch {
    // A corrupt pending record is simply abandoned.
  }
  return null;
}

/** Persist the in-flight capture; null clears it. */
async function savePending(pending: PendingSnapshot | null): Promise<boolean> {
  return setMeta(PENDING_KEY, pending ? JSON.stringify(pending) : "");
}

/**
 * Start a capture: run the environment preflight, sweep any unfinished
 * predecessor's images, and park the plan in the store. The returned routes
 * are what the caller should then feed to `captureSnapshotRoute`, one call
 * each, before `finishSnapshot` records the run.
 */
export async function beginSnapshot(input: BeginSnapshotInput): Promise<BeginSnapshotResult> {
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

  const routes = input.routes.slice(0, MAX_SNAPSHOT_ROUTES);
  if (routes.length === 0) return { ok: false, message: "No routes to capture." };

  // A predecessor that never finished (tab closed mid-run) left images
  // behind; sweep them before its record is overwritten.
  const stale = await loadPending();
  if (stale) await deleteSnapshotImages(stale);

  const pending: PendingSnapshot = {
    v: 1,
    id: Date.now().toString(36),
    origin: input.origin,
    fingerprint: input.fingerprint,
    startedAt: Date.now(),
    routes,
    done: [],
    shots: [],
    authWalled: [],
    noDarkMode: true,
    targets: input.targets ?? [],
    previews: [],
    previewMisses: [],
  };
  if (!(await savePending(pending))) {
    return { ok: false, message: "The store refused to record the capture in progress." };
  }
  return { ok: true, id: pending.id, routes };
}

/**
 * Shoot one route of the capture `beginSnapshot` started — both devices, both
 * themes — store its images, and append the results to the pending record.
 * Bounded work per call by design: this is the request that has to fit inside
 * a serverless host's function time limit.
 */
export async function captureSnapshotRoute(
  id: string,
  route: string,
): Promise<CaptureRouteResult> {
  const pending = await loadPending();
  if (!pending || pending.id !== id) {
    return {
      ok: false,
      message: "This capture is no longer in progress — start a new one.",
    };
  }
  if (!pending.routes.includes(route)) {
    return { ok: false, message: `${route} isn't part of this capture.` };
  }
  if (pending.done.includes(route)) {
    // A retry after a lost response — the shots are already recorded.
    return { ok: true, shots: pending.shots.filter((s) => s.route === route) };
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

  // Every route stages into its own temp directory — the one location
  // serverless hosts keep writable — and the files only exist for the moments
  // between capture and `storeRouteShots` moving them home.
  let stageDir: string;
  try {
    stageDir = await mkdtemp(join(tmpdir(), "polishd-snapshot-"));
  } catch (err) {
    await launched.browser.close().catch(() => {});
    return {
      ok: false,
      message: `Couldn't create the snapshot staging directory (${
        err instanceof Error ? err.message : "unknown error"
      }) — is the filesystem writable?`,
    };
  }

  try {
    const result = await run({
      url: pending.origin,
      routes: [route],
      outDir: stageDir,
      devices: [...SNAPSHOT_DEVICES],
      themes: [...SNAPSHOT_THEMES],
      // The dashboard composes its own grid; the stitched contact sheet would
      // only duplicate every image on disk.
      skipSheet: true,
      browser: launched.browser,
    });

    const stored = await storeRouteShots(
      id,
      pending.routes.indexOf(route),
      stageDir,
      result.shots,
    );
    if ("message" in stored) return { ok: false, message: stored.message };

    const pictured = await pictureRouteValues(launched.browser, pending, route, stored.shots);

    pending.done.push(route);
    pending.shots.push(...stored.shots);
    pending.previews.push(...pictured.previews);
    pending.previewMisses.push(...pictured.missed);
    for (const walled of result.authWalled) {
      if (!pending.authWalled.includes(walled)) pending.authWalled.push(walled);
    }
    // A route that produced no images says nothing about dark mode.
    if (stored.shots.some((s) => s.file)) {
      pending.noDarkMode = pending.noDarkMode && result.noDarkMode;
    }
    if (!(await savePending(pending))) {
      await deleteSnapshotImages({ id, shots: stored.shots, previews: pictured.previews });
      return { ok: false, message: "The route was shot but the store refused to record it." };
    }
    return { ok: true, shots: stored.shots };
  } catch (err) {
    return {
      ok: false,
      message: `Screenshot capture failed: ${
        err instanceof Error ? err.message : "unknown error"
      }`,
    };
  } finally {
    await launched.browser.close().catch(() => {});
    await rm(stageDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Picture the capture's flagged values that were measured on `route` and
 * aren't pictured yet, in the renderings this route actually produced shots
 * for (an auth-walled or failed route has none, so it's skipped). Never fails
 * the route: any error leaves the route with its full shots and no previews.
 */
async function pictureRouteValues(
  browser: Browser,
  pending: PendingSnapshot,
  route: string,
  shots: PolishdSnapshotShot[],
): Promise<{ previews: PolishdSnapshotPreview[]; missed: string[] }> {
  const none = { previews: [], missed: [] };
  const pictured = new Set(pending.previews.map((p) => p.key));
  const targets = pending.targets
    .filter((t) => t.pages.includes(route) && !pictured.has(t.key))
    .slice(0, MAX_PREVIEWS_PER_ROUTE);
  const renderings = PREVIEW_RENDERINGS.filter((r) =>
    shots.some((s) => s.file && s.device === r.device && s.theme === r.theme),
  );
  if (targets.length === 0 || renderings.length === 0) return none;
  try {
    const result = await captureValuePreviews(
      browser,
      pending.origin,
      route,
      targets,
      renderings,
      PREVIEW_BUDGET_MS,
    );
    const previews =
      result.crops.length > 0
        ? await storeRoutePreviews(pending.id, pending.routes.indexOf(route), route, result.crops)
        : [];
    return { previews, missed: result.missed };
  } catch {
    return none;
  }
}

/**
 * Close out the capture: record the accumulated shots in the snapshot index
 * and prune old snapshots past `MAX_SNAPSHOTS`, images included. Called once
 * every route has been attempted — routes whose calls failed outright are
 * simply absent from the snapshot.
 */
export async function finishSnapshot(id: string): Promise<CaptureSnapshotResult> {
  const pending = await loadPending();
  if (!pending || pending.id !== id) {
    return {
      ok: false,
      message: "This capture is no longer in progress — start a new one.",
    };
  }

  const snapshot: PolishdSnapshot = {
    id: pending.id,
    capturedAt: Date.now(),
    origin: pending.origin,
    fingerprint: pending.fingerprint,
    shots: pending.shots,
    authWalled: pending.authWalled,
    noDarkMode: pending.noDarkMode,
    previews: pending.previews,
    // A value missed on one of its pages may have been pictured on another.
    previewMisses: [...new Set(pending.previewMisses)].filter(
      (key) => !pending.previews.some((p) => p.key === key),
    ),
  };

  if (snapshot.shots.every((s) => !s.file)) {
    await deleteSnapshotImages(snapshot);
    await savePending(null);
    return {
      ok: false,
      message:
        "Every page failed to capture — is the site reachable at " +
        `${pending.origin} from its own server?`,
    };
  }

  const index = await loadIndex();
  index.snapshots.unshift(snapshot);
  const pruned = index.snapshots.slice(MAX_SNAPSHOTS);
  index.snapshots = index.snapshots.slice(0, MAX_SNAPSHOTS);
  if (!(await setMeta(INDEX_KEY, JSON.stringify(index)))) {
    await deleteSnapshotImages(snapshot);
    await savePending(null);
    return {
      ok: false,
      message: "The snapshot was shot but the store refused to record it.",
    };
  }
  await savePending(null);
  for (const old of pruned) {
    await deleteSnapshotImages(old);
  }
  return { ok: true, snapshot };
}

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
  let chromium: (typeof import("playwright-core"))["chromium"];
  try {
    ({ chromium } = await import("playwright-core"));
  } catch (err) {
    return {
      message: `The browser driver (playwright-core) failed to load: ${
        err instanceof Error ? err.message : "unknown error"
      }`,
    };
  }
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

