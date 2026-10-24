/**
 * Polishd — site snapshots (server only).
 *
 * Full-page screenshots of the host site: every scanned route, phone and
 * desktop, light and dark. The store's metadata table holds only the index —
 * which snapshots exist, the shots each produced, and the design-metrics
 * fingerprint at capture time — so a snapshot taken before a round of design
 * fixes can later be paired with one taken after, and shots can feed the
 * aesthetic review.
 *
 * **Who shoots.** In production nothing browser-related runs here. The
 * dashboard, in the owner's browser, sends each route to Polishd's hosted
 * screenshot service (service/ in this repo), which shoots the calling origin
 * and hands the images back; the dashboard then stores them. A site the
 * service can't reach — `next dev` on localhost — is shot by a browser on this
 * machine instead (snapshot-local.ts), through the same loop. The dashboard
 * drives both; this module plans the capture, issues upload targets, checks
 * and records what comes back, and closes the snapshot.
 *
 * **Where images live.** On Vercel, in Vercel Blob, switched on by the
 * variable a connected store injects (`BLOB_STORE_ID` over OIDC,
 * `BLOB_READ_WRITE_TOKEN` classically). The browser uploads straight to the
 * store with a presigned URL scoped to one pathname, one type and a size cap —
 * images are too big to pass through a server action (1 MB) or a Vercel
 * function (4.5 MB). Elsewhere, on disk under `.polishd/snapshots/<id>/`,
 * sent in chunks small enough for a server action.
 *
 * **What's trusted.** The capture in progress is parked in the store, and
 * every call is checked against it: file names are derived here from the
 * slot, never taken from the browser; a Blob URL the browser reports is
 * looked up with the server's own credentials and must be the pathname this
 * capture signed. Every failure degrades to a message, never a crash.
 */
import { appendFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import type {
  EncodedImage,
  ShotResult,
  SkipReason,
  SnapshotDevice,
  SnapshotEngine,
  SnapshotTheme,
} from "../capture/protocol";
import type { DesignPreviewTarget } from "../shared/design-values";
import {
  blobConfigured,
  blobPathnameMatches,
  createBlobUploader,
  isBlobObjectUrl,
  isPrivateBlobUrl,
  snapshotBlobPathname,
  type BlobAccess,
} from "./snapshot-blob";
import {
  darkModeVerdict,
  imageMime,
  parseSnapshotFile,
  previewMisses,
  snapshotFileFor,
  type ShotSlot,
} from "./snapshot-files";
import { localCaptureUnavailable, shootLocally } from "./snapshot-local";
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
   * Image filename inside the snapshot's `shots/` directory. Empty when the
   * cell was skipped. Still the shot's identifier when the image itself lives
   * in Blob storage.
   */
  file: string;
  /** Where the image uploaded, for Blob-stored shots. */
  url?: string;
  /** Why the cell has no image, when it doesn't. */
  skipped?: string;
}

/**
 * A cropped picture of one flagged design value in place — the element that
 * carries a one-off type style, color, radius or off-grid padding, ringed,
 * with the component around it. Shot from the same rendering as the route's
 * full shot.
 */
export interface PolishdSnapshotPreview {
  /** The value pictured — `designValueKey` of its target. */
  key: string;
  route: string;
  device: string;
  theme: string;
  /** Image filename inside the snapshot's `previews/` directory. */
  file: string;
  /** Where the image uploaded, for Blob-stored previews. */
  url?: string;
}

/** One capture run: every page of the site at one moment in time. */
export interface PolishdSnapshot {
  id: string;
  capturedAt: number;
  /** The origin that was shot, e.g. "https://example.com". */
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
  /** What shot it: Polishd's screenshot service, a browser on this machine, or both. */
  engines?: ("service" | "local")[];
}

interface SnapshotIndex {
  v: 1;
  snapshots: PolishdSnapshot[];
}

const INDEX_KEY = "design_snapshots";

/** Snapshots kept before the oldest is pruned (images and index entry both). */
const MAX_SNAPSHOTS = 6;

/** Cap on routes shot per run. */
export const MAX_SNAPSHOT_ROUTES = 12;

/**
 * The renderings every snapshot shoots, in order: the gallery's default view
 * first, so most value pictures match the shot the user is already looking at.
 */
export const SNAPSHOT_RENDERINGS: { device: SnapshotDevice; theme: SnapshotTheme }[] = [
  { device: "desktop", theme: "light" },
  { device: "desktop", theme: "dark" },
  { device: "phone", theme: "light" },
  { device: "phone", theme: "dark" },
];

/** Largest image accepted for storage — well over what the service sends. */
export const MAX_SNAPSHOT_IMAGE_BYTES = 8 * 1024 * 1024;
/** How long a presigned upload URL stays valid. */
const UPLOAD_URL_TTL_MS = 5 * 60_000;
/** The Blob API version the SDK speaks (`BLOB_API_VERSION` in @vercel/blob 2.x). */
const BLOB_API_VERSION = "12";

/** Server-side Blob uploads (the local engine's) work out the store's access mode once. */
const uploadToBlob = createBlobUploader();

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
 * and Blob-stored images are only ever fetched from the URL the index recorded.
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
    const dir = shot ? "shots" : "previews";
    const bytes = image.url
      ? await readBlobImage(image.url)
      : await readFile(join(snapshotsRoot(), snapshot.id, dir, image.file));
    return bytes ? `data:${imageMime(image.file)};base64,${bytes.toString("base64")}` : null;
  } catch {
    return null; // Directory pruned or deleted by hand — the tile shows a blank.
  }
}

/**
 * A Blob-stored image's bytes, or null when it's gone. A public store's URL is
 * a plain fetch. A private store's refuses anonymous reads, so it goes through
 * the SDK's `get`, which attaches the deployment's credential (OIDC or token,
 * whichever it has) and only ever sends it to a Vercel Blob host.
 */
async function readBlobImage(url: string): Promise<Buffer | null> {
  if (isPrivateBlobUrl(url)) {
    const { get } = await import("@vercel/blob");
    const result = await get(url, { access: "private" });
    if (result?.statusCode !== 200) return null;
    return Buffer.from(await new Response(result.stream).arrayBuffer());
  }
  const res = await fetch(url);
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}

/** The Blob SDK, or why it couldn't load. */
async function loadBlobSdk(): Promise<typeof import("@vercel/blob") | { message: string }> {
  try {
    return await import("@vercel/blob");
  } catch {
    return {
      message:
        "Blob storage is configured (BLOB_STORE_ID or BLOB_READ_WRITE_TOKEN is set) " +
        "but @vercel/blob isn't installed. It ships as an optional dependency of " +
        "@polishd/next — reinstall without `--omit=optional`.",
    };
  }
}

/**
 * Best-effort removal of a snapshot's images, wherever they were stored.
 * Blob-stored images carry their URLs in the index; disk-stored ones sit in a
 * directory named by the snapshot id. Both paths swallow failure — an orphaned
 * blob costs cents, a prune that crashed the capture would cost the feature.
 */
async function deleteSnapshotImages(
  snapshot: Pick<PolishdSnapshot, "id" | "shots" | "previews">,
): Promise<void> {
  const urls = [...(snapshot.shots ?? []), ...(snapshot.previews ?? [])].flatMap((s) =>
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

// ── The capture in progress ──────────────────────────────────────────────────

/** A recorded cell, with what `finish` needs that the index doesn't keep. */
interface PendingShot extends PolishdSnapshotShot {
  hash?: string;
  reason?: SkipReason;
}

/**
 * The capture in progress, parked in the store between calls. This record —
 * not anything the browser sends — is what each call trusts for the origin,
 * the route list and the shots so far; the browser only ever hands back the
 * id and a slot. One capture runs at a time: a new begin sweeps an unfinished
 * predecessor, images and all.
 */
interface PendingSnapshot {
  v: 2;
  id: string;
  origin: string;
  fingerprint: string | null;
  startedAt: number;
  routes: string[];
  targets: DesignPreviewTarget[];
  storage: "blob" | "disk";
  /** The access mode browser uploads succeeded with, once one has. */
  blobAccess?: BlobAccess;
  engines: ("service" | "local")[];
  shots: PendingShot[];
  previews: PolishdSnapshotPreview[];
  /** Value keys looked for in some rendering. */
  looked: string[];
}

const PENDING_KEY = "design_snapshot_pending";

/** The parked capture — or, for sweeping only, whatever an older version parked. */
async function loadPendingRaw(): Promise<Partial<PendingSnapshot> | null> {
  const raw = await getMeta(PENDING_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PendingSnapshot>;
    return parsed && typeof parsed.id === "string" ? parsed : null;
  } catch {
    return null;
  }
}

async function loadPending(id: string): Promise<PendingSnapshot | null> {
  const parsed = await loadPendingRaw();
  return parsed?.v === 2 && parsed.id === id ? (parsed as PendingSnapshot) : null;
}

/** Persist the in-flight capture; null clears it. */
async function savePending(pending: PendingSnapshot | null): Promise<boolean> {
  return setMeta(PENDING_KEY, pending ? JSON.stringify(pending) : "");
}

const GONE = {
  ok: false as const,
  message: "This capture is no longer in progress — start a new one.",
};

export type Failure = { ok: false; message: string };

/** What the dashboard needs to drive a capture. */
export interface SnapshotPlan {
  id: string;
  origin: string;
  routes: string[];
  renderings: { device: SnapshotDevice; theme: SnapshotTheme }[];
  /** Flagged values to picture, each with the pages it was measured on. */
  targets: DesignPreviewTarget[];
  engine: SnapshotEngine;
  /** Whether this server can shoot with a browser of its own (never on Vercel). */
  localAvailable: boolean;
  storage: "blob" | "disk";
}

export interface BeginSnapshotInput {
  /** The site to shoot, scheme included. */
  origin: string;
  /** Paths to shoot, exactly. */
  routes: string[];
  /** Design-metrics fingerprint at capture time, for later pairing. */
  fingerprint: string | null;
  /** Flagged values to picture in place, each on the pages it was measured on. */
  targets?: DesignPreviewTarget[];
  engine: SnapshotEngine;
}

/**
 * Start a capture: run the environment preflight, sweep any unfinished
 * predecessor's images, and park the plan in the store.
 */
export async function beginSnapshot(
  input: BeginSnapshotInput,
): Promise<({ ok: true } & SnapshotPlan) | Failure> {
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
  // environment must fail here too.
  const issue = await snapshotCaptureIssue();
  if (issue) return { ok: false, message: issue };

  const routes = input.routes.slice(0, MAX_SNAPSHOT_ROUTES);
  if (routes.length === 0) return { ok: false, message: "No routes to capture." };

  // A predecessor that never finished (tab closed mid-run) left images
  // behind; sweep them before its record is overwritten.
  const stale = await loadPendingRaw();
  if (stale?.id) {
    await deleteSnapshotImages({ id: stale.id, shots: stale.shots ?? [], previews: stale.previews ?? [] });
  }

  const pending: PendingSnapshot = {
    v: 2,
    id: Date.now().toString(36),
    origin: input.origin,
    fingerprint: input.fingerprint,
    startedAt: Date.now(),
    routes,
    targets: input.targets ?? [],
    storage: blobConfigured() ? "blob" : "disk",
    engines: [],
    shots: [],
    previews: [],
    looked: [],
  };
  if (!(await savePending(pending))) {
    return { ok: false, message: "The store refused to record the capture in progress." };
  }
  return {
    ok: true,
    id: pending.id,
    origin: pending.origin,
    routes,
    renderings: SNAPSHOT_RENDERINGS,
    targets: pending.targets,
    engine: input.engine,
    localAvailable: localCaptureUnavailable() === null,
    storage: pending.storage,
  };
}

function validSlot(pending: PendingSnapshot, slot: ShotSlot): boolean {
  return (
    pending.routes.includes(slot.route) &&
    SNAPSHOT_RENDERINGS.some((r) => r.device === slot.device && r.theme === slot.theme)
  );
}

// ── Uploads from the browser ─────────────────────────────────────────────────

export type UploadTarget =
  | {
      kind: "blob";
      file: string;
      /** Presigned `PUT` URL: one pathname, one type, a size cap, five minutes. */
      url: string;
      /** Headers the Blob API expects alongside it (bar the access mode). */
      headers: Record<string, string>;
      /** The store's access mode, once a previous upload found it out. */
      access: BlobAccess | null;
    }
  | { kind: "disk"; file: string };

/**
 * Where the browser should put one image of the capture. For Blob, a presigned
 * URL scoped to exactly this image's pathname; for disk, the file name to
 * stream chunks to. Either way the name is derived here from the slot.
 */
export async function snapshotUploadTarget(
  id: string,
  slot: ShotSlot,
  type: string,
  size: number,
): Promise<({ ok: true } & UploadTarget) | Failure> {
  const pending = await loadPending(id);
  if (!pending) return GONE;
  if (!validSlot(pending, slot)) return { ok: false, message: "That shot isn't part of this capture." };
  const file = snapshotFileFor(pending.routes, slot, type);
  if (!file) return { ok: false, message: "That image isn't part of this capture." };
  if (!Number.isFinite(size) || size <= 0 || size > MAX_SNAPSHOT_IMAGE_BYTES) {
    return { ok: false, message: "That image is too large to store." };
  }
  if (pending.storage === "disk") return { ok: true, kind: "disk", file };

  const blob = await loadBlobSdk();
  if ("message" in blob) return { ok: false, message: blob.message };
  try {
    const pathname = snapshotBlobPathname(id, file);
    const validUntil = Date.now() + UPLOAD_URL_TTL_MS;
    // No credentials passed: the SDK uses the OIDC token with BLOB_STORE_ID
    // first, BLOB_READ_WRITE_TOKEN otherwise — whichever the project has.
    const token = await blob.issueSignedToken({
      pathname,
      operations: ["put"],
      validUntil,
      allowedContentTypes: [type],
      maximumSizeInBytes: MAX_SNAPSHOT_IMAGE_BYTES,
    });
    const { presignedUrl } = await blob.presignUrl(token, {
      operation: "put",
      pathname,
      access: pending.blobAccess ?? "public",
      validUntil,
      allowedContentTypes: [type],
      maximumSizeInBytes: MAX_SNAPSHOT_IMAGE_BYTES,
      // Unguessable URLs for a public store; a private one refuses anonymous
      // reads anyway. The dashboard serves images through its own auth gate.
      addRandomSuffix: true,
    });
    return {
      ok: true,
      kind: "blob",
      file,
      url: presignedUrl,
      headers: {
        "x-api-version": BLOB_API_VERSION,
        "x-vercel-blob-store-id": blob.parseStoreIdFromDelegationToken(token.delegationToken),
        "x-content-type": type,
      },
      access: pending.blobAccess ?? null,
    };
  } catch (err) {
    return {
      ok: false,
      message: `Couldn't prepare an upload to Vercel Blob: ${
        err instanceof Error ? err.message : "unknown error"
      }`,
    };
  }
}

/**
 * Append one chunk of a disk-stored image. Chunks arrive in order, each small
 * enough for a server action; the file only takes its real name once the last
 * one lands, so a half-written image is never indexed.
 */
export async function appendSnapshotChunk(
  id: string,
  file: string,
  offset: number,
  base64: string,
  last: boolean,
): Promise<{ ok: true } | Failure> {
  const pending = await loadPending(id);
  if (!pending) return GONE;
  if (pending.storage !== "disk") return { ok: false, message: "This capture stores images in Blob." };
  const parsed = parseSnapshotFile(file);
  if (!parsed || parsed.routeIndex >= pending.routes.length) {
    return { ok: false, message: "That image isn't part of this capture." };
  }
  const bytes = Buffer.from(base64, "base64");
  const dir = join(snapshotsRoot(), id, parsed.dir);
  const part = join(dir, `${file}.part`);
  try {
    await mkdir(dir, { recursive: true });
    if (offset === 0) {
      await writeFile(part, bytes);
    } else {
      const size = (await stat(part)).size;
      if (size !== offset) return { ok: false, message: "An image chunk arrived out of order." };
      if (size + bytes.length > MAX_SNAPSHOT_IMAGE_BYTES) {
        return { ok: false, message: "That image is too large to store." };
      }
      await appendFile(part, bytes);
    }
    if (last) await rename(part, join(dir, file));
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      message: `Couldn't write the snapshot image (${
        err instanceof Error ? err.message : "unknown error"
      }) — is the filesystem writable?`,
    };
  }
}

// ── Recording shots ──────────────────────────────────────────────────────────

export interface StoredImage {
  file: string;
  /** Blob object URL, for Blob-stored images. */
  url?: string;
}

/** One cell's outcome, as the dashboard reports it once its images are stored. */
export interface ShotRecord {
  route: string;
  device: SnapshotDevice;
  theme: SnapshotTheme;
  hash?: string;
  reason?: SkipReason;
  skipped?: string;
  image?: StoredImage;
  previews: { key: string; image: StoredImage }[];
  looked: string[];
  engine: "service" | "local";
  /** The access mode a browser upload to Blob succeeded with. */
  access?: BlobAccess;
}

/**
 * Check that a stored image is the one this capture minted for the slot: the
 * right name, and either a finished file on disk or a blob in this project's
 * store at the signed pathname — looked up with the server's own credentials,
 * so a browser can't make the index point anywhere else.
 */
async function verifyStored(
  pending: PendingSnapshot,
  slot: ShotSlot,
  image: StoredImage,
): Promise<string | null> {
  const parsed = parseSnapshotFile(image.file);
  const expectedWebp = snapshotFileFor(pending.routes, slot, "image/webp");
  const expectedPng = snapshotFileFor(pending.routes, slot, "image/png");
  if (!parsed || (image.file !== expectedWebp && image.file !== expectedPng)) {
    return "an image name this capture didn't issue";
  }
  if (pending.storage === "disk") {
    if (image.url) return "a Blob URL for a disk-stored capture";
    try {
      const s = await stat(join(snapshotsRoot(), pending.id, parsed.dir, image.file));
      return s.isFile() && s.size > 0 ? null : "an empty image";
    } catch {
      return "an image that never finished uploading";
    }
  }
  if (!image.url || !isBlobObjectUrl(image.url)) return "an image that isn't in Vercel Blob";
  const blob = await loadBlobSdk();
  if ("message" in blob) return blob.message;
  try {
    const meta = await blob.head(image.url);
    if (!blobPathnameMatches(meta.pathname, pending.id, image.file)) {
      return "a blob at a pathname this capture didn't sign";
    }
    if (meta.size > MAX_SNAPSHOT_IMAGE_BYTES) return "an image over the size cap";
    return null;
  } catch {
    return "an image the Blob store doesn't have";
  }
}

/** Append a cell to the pending record. Callers have verified (or written) its images. */
function addToPending(pending: PendingSnapshot, record: ShotRecord): void {
  pending.shots.push({
    route: record.route,
    device: record.device,
    theme: record.theme,
    file: record.image?.file ?? "",
    ...(record.image?.url ? { url: record.image.url } : {}),
    ...(record.image ? {} : { skipped: (record.skipped ?? "not captured").slice(0, 200) }),
    ...(record.hash ? { hash: record.hash.slice(0, 64) } : {}),
    ...(record.reason ? { reason: record.reason } : {}),
  });
  for (const p of record.previews) {
    pending.previews.push({
      key: p.key,
      route: record.route,
      device: record.device,
      theme: record.theme,
      file: p.image.file,
      ...(p.image.url ? { url: p.image.url } : {}),
    });
  }
  for (const key of record.looked) if (!pending.looked.includes(key)) pending.looked.push(key);
  if (!pending.engines.includes(record.engine)) pending.engines.push(record.engine);
}

/**
 * Record one cell the dashboard shot through the service and stored. Calls
 * for a cell already recorded are a no-op, so a retry after a lost response
 * is harmless. The dashboard sends these one at a time — they read and write
 * the same pending record.
 */
export async function recordSnapshotShot(
  id: string,
  record: ShotRecord,
): Promise<{ ok: true } | Failure> {
  const pending = await loadPending(id);
  if (!pending) return GONE;
  const slot: ShotSlot = { route: record.route, device: record.device, theme: record.theme };
  if (!validSlot(pending, slot)) return { ok: false, message: "That shot isn't part of this capture." };
  if (pending.shots.some((s) => s.route === slot.route && s.device === slot.device && s.theme === slot.theme)) {
    return { ok: true };
  }
  const targetKeys = new Set(pending.targets.map((t) => t.key));
  if (record.previews.length > 16 || record.previews.some((p) => !targetKeys.has(p.key))) {
    return { ok: false, message: "Those value pictures aren't part of this capture." };
  }
  if (record.image) {
    const problem = await verifyStored(pending, slot, record.image);
    if (problem) return { ok: false, message: `The shot was refused: ${problem}.` };
  }
  for (const [n, p] of record.previews.entries()) {
    const problem = await verifyStored(pending, { ...slot, preview: n }, p.image);
    if (problem) return { ok: false, message: `A value picture was refused: ${problem}.` };
  }
  addToPending(pending, {
    ...record,
    looked: record.looked.filter((k) => targetKeys.has(k)),
  });
  if (record.access && pending.storage === "blob") pending.blobAccess = record.access;
  if (!(await savePending(pending))) {
    return { ok: false, message: "The shot was stored but the store refused to record it." };
  }
  return { ok: true };
}

/** Write one image the local engine produced to wherever this capture stores images. */
async function storeLocalImage(
  pending: PendingSnapshot,
  slot: ShotSlot,
  image: EncodedImage,
): Promise<StoredImage | null> {
  const file = snapshotFileFor(pending.routes, slot, image.type);
  const parsed = file ? parseSnapshotFile(file) : null;
  if (!file || !parsed) return null;
  const bytes = Buffer.from(image.data, "base64");
  if (pending.storage === "disk") {
    const dir = join(snapshotsRoot(), pending.id, parsed.dir);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, file), bytes);
    return { file };
  }
  const blob = await loadBlobSdk();
  if ("message" in blob) throw new Error(blob.message);
  const { url } = await uploadToBlob((access) =>
    blob.put(snapshotBlobPathname(pending.id, file), bytes, {
      access,
      contentType: image.type,
      addRandomSuffix: true,
    }),
  );
  return { file, url };
}

export type LocalShotResult = { ok: true; shot: ShotResult } | Failure;

/**
 * Shoot one cell with this machine's browser, store its images and record it
 * — the local engine's whole step in one call. Returns the shot itself, images
 * included, so the dashboard can show it as it lands.
 */
export async function captureLocalShot(
  id: string,
  slot: ShotSlot,
  findKeys: string[],
): Promise<LocalShotResult> {
  const pending = await loadPending(id);
  if (!pending) return GONE;
  if (!validSlot(pending, slot)) return { ok: false, message: "That shot isn't part of this capture." };
  const unavailable = localCaptureUnavailable();
  if (unavailable) return { ok: false, message: unavailable };

  const wanted = new Set(findKeys);
  const find = pending.targets
    .filter((t) => wanted.has(t.key) && t.pages.includes(slot.route))
    .slice(0, 16)
    .map((t) => ({ key: t.key, ref: t.ref }));

  let shot: ShotResult;
  try {
    shot = await shootLocally({
      origin: pending.origin,
      route: slot.route,
      device: slot.device,
      theme: slot.theme,
      find,
    });
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "The local browser failed." };
  }

  // Re-read: shooting took seconds, and the record must be the current one.
  const current = await loadPending(id);
  if (!current) return GONE;
  if (current.shots.some((s) => s.route === slot.route && s.device === slot.device && s.theme === slot.theme)) {
    return { ok: true, shot };
  }
  const stored: StoredImage[] = [];
  try {
    const image = shot.image ? await storeLocalImage(current, slot, shot.image) : undefined;
    if (image) stored.push(image);
    const previews: { key: string; image: StoredImage }[] = [];
    for (const [n, p] of shot.previews.entries()) {
      const saved = await storeLocalImage(current, { ...slot, preview: n }, p.image);
      if (saved) {
        stored.push(saved);
        previews.push({ key: p.key, image: saved });
      }
    }
    addToPending(current, {
      route: slot.route,
      device: slot.device,
      theme: slot.theme,
      hash: shot.hash,
      reason: shot.reason,
      skipped: shot.skipped,
      image: image ?? undefined,
      previews,
      looked: shot.looked,
      engine: "local",
    });
  } catch (err) {
    await deleteImageFiles(id, stored);
    return {
      ok: false,
      message: `Couldn't store the screenshot: ${err instanceof Error ? err.message : "unknown error"}`,
    };
  }
  if (!(await savePending(current))) {
    return { ok: false, message: "The route was shot but the store refused to record it." };
  }
  return { ok: true, shot };
}

/**
 * Close out the capture: settle dark mode, record the shots in the snapshot
 * index and prune old snapshots past `MAX_SNAPSHOTS`, images included. Cells
 * that were never recorded are simply absent from the snapshot.
 */
export async function finishSnapshot(id: string): Promise<{ ok: true; snapshot: PolishdSnapshot } | Failure> {
  const pending = await loadPending(id);
  if (!pending) return GONE;

  // A site with no dark mode renders the same pixels twice; keep one set.
  const verdict = darkModeVerdict(pending.shots);
  const redundant = new Set(verdict.redundant);
  const dropped = pending.shots.filter((_, i) => redundant.has(i));
  const kept = pending.shots.filter((_, i) => !redundant.has(i));

  // One picture per value: the first rendering that showed it.
  const seen = new Set<string>();
  const previews = pending.previews.filter((p) => {
    if (seen.has(p.key)) return false;
    seen.add(p.key);
    return true;
  });
  const extraPreviews = pending.previews.filter((p) => !previews.includes(p));

  const snapshot: PolishdSnapshot = {
    id: pending.id,
    capturedAt: Date.now(),
    origin: pending.origin,
    fingerprint: pending.fingerprint,
    shots: kept.map(({ route, device, theme, file, url, skipped }) => ({
      route,
      device,
      theme,
      file,
      ...(url ? { url } : {}),
      ...(skipped ? { skipped } : {}),
    })),
    authWalled: [...new Set(kept.filter((s) => s.reason === "auth_wall").map((s) => s.route))],
    noDarkMode: verdict.noDarkMode,
    previews,
    previewMisses: previewMisses(pending.looked, previews.map((p) => p.key)),
    engines: pending.engines,
  };

  if (snapshot.shots.every((s) => !s.file)) {
    await deleteSnapshotImages(pending);
    await savePending(null);
    const first = pending.shots.find((s) => s.skipped)?.skipped;
    return {
      ok: false,
      message: `Every page failed to capture${first ? ` (${first})` : ""}.`,
    };
  }

  const index = await loadIndex();
  index.snapshots.unshift(snapshot);
  const pruned = index.snapshots.slice(MAX_SNAPSHOTS);
  index.snapshots = index.snapshots.slice(0, MAX_SNAPSHOTS);
  if (!(await setMeta(INDEX_KEY, JSON.stringify(index)))) {
    await deleteSnapshotImages(pending);
    await savePending(null);
    return { ok: false, message: "The snapshot was shot but the store refused to record it." };
  }
  await savePending(null);
  // Redundant dark shots and duplicate value pictures were stored before they
  // were known to be redundant.
  if (dropped.length > 0 || extraPreviews.length > 0) {
    await deleteImageFiles(pending.id, [...dropped, ...extraPreviews]);
  }
  for (const old of pruned) await deleteSnapshotImages(old);
  return { ok: true, snapshot };
}

/** Delete specific images of a snapshot that is otherwise kept. */
async function deleteImageFiles(id: string, images: { file: string; url?: string }[]): Promise<void> {
  const urls = images.flatMap((i) => (i.url ? [i.url] : []));
  if (urls.length > 0) {
    try {
      const { del } = await import("@vercel/blob");
      await del(urls);
    } catch {
      // Orphans cost cents; leave them.
    }
  }
  for (const image of images) {
    const parsed = image.file ? parseSnapshotFile(image.file) : null;
    if (!image.url && parsed) {
      await rm(join(snapshotsRoot(), id, parsed.dir, image.file), { force: true }).catch(() => {});
    }
  }
}

/**
 * A problem that will make the next capture fail, detectable from the
 * environment alone — or null when none is. On Vercel the filesystem is
 * read-only, so images need a Blob store; and a Blob store needs the SDK the
 * `--omit=optional` install may have dropped. The dashboard says so up front
 * rather than after the first shot, and `beginSnapshot` runs the same check
 * for callers that never rendered the dashboard.
 */
export async function snapshotCaptureIssue(): Promise<string | null> {
  if (process.env.VERCEL && !blobConfigured()) {
    return (
      "Snapshot images have nowhere to live on this deployment: the filesystem " +
      "is read-only and no Blob store is connected. Connect a Vercel Blob store " +
      "to the project (Storage → Blob in the Vercel dashboard) — the " +
      "BLOB_STORE_ID or BLOB_READ_WRITE_TOKEN it injects switches snapshot " +
      "storage over automatically — then redeploy."
    );
  }
  if (blobConfigured()) {
    try {
      await import("@vercel/blob");
    } catch {
      return (
        "Snapshot images would upload to Vercel Blob (BLOB_STORE_ID or " +
        "BLOB_READ_WRITE_TOKEN is set), but @vercel/blob isn't installed. It " +
        "ships as an optional dependency of @polishd/next, so this install was " +
        "likely run with `--omit=optional` — reinstall with optional " +
        "dependencies included, then redeploy."
      );
    }
  }
  return null;
}
