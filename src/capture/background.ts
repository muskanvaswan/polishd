/**
 * Polishd — the background capture contract (shared: no server, no React).
 *
 * A capture the owner starts is driven from their browser tab: it asks the
 * screenshot service for each rendering and stores what comes back. A
 * background capture has no tab. The site's server asks the service for the
 * whole capture at once, and the service's worker does the rest — shoots
 * every page, uploads each image to the site's own storage, and reports each
 * shot — by calling the site back:
 *
 *   site    → service   POST {service}/captures          BackgroundCaptureRequest
 *   service → site      POST {origin}{callback}          { capture: CaptureCall }
 *
 * The callback is the site's ingest route, the one endpoint every install
 * already has. A call carries the capture's id and a token the site minted
 * for this capture alone; without both, the body is just a malformed beacon.
 *
 * The service keeps nothing here either: images go from its worker straight
 * to the site's storage, with an upload target the site issues per image.
 *
 * Both ends import this file, and nothing in it changes shape without a new
 * version: a worker built last month talks to a site deployed today.
 */
import {
  SNAPSHOT_DEVICES,
  SNAPSHOT_THEMES,
  isRoutePath,
  parseRef,
  type DesignValueRef,
  type Parsed,
  type SkipReason,
  type SnapshotDevice,
  type SnapshotTheme,
} from "./protocol";

export const BACKGROUND_CAPTURE_VERSION = 1;

/** The same caps a capture has anywhere: twelve routes, sixty-four values. */
export const MAX_BACKGROUND_ROUTES = 12;
export const MAX_BACKGROUND_TARGETS = 64;

export interface CaptureRendering {
  device: SnapshotDevice;
  theme: SnapshotTheme;
}

/** A flagged value to picture, with the pages it was measured on. */
export interface CaptureTarget {
  key: string;
  ref: DesignValueRef;
  pages: string[];
}

/** What a site asks the service for. */
export interface BackgroundCaptureRequest {
  v: typeof BACKGROUND_CAPTURE_VERSION;
  /** The site, as it knows itself. The service shoots this and calls nowhere else back. */
  origin: string;
  /** The path on `origin` that takes the worker's calls — the ingest route. */
  callback: string;
  /** The capture the site parked, and the token that speaks for it. */
  id: string;
  token: string;
  routes: string[];
  renderings: CaptureRendering[];
  targets: CaptureTarget[];
}

const ID = /^[a-z0-9]{1,24}$/;
const TOKEN = /^[a-f0-9]{32,128}$/;

function parseOrigin(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 300) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin === raw ? raw : null;
  } catch {
    return null;
  }
}

function parseRenderings(raw: unknown): CaptureRendering[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 4) return null;
  const out: CaptureRendering[] = [];
  for (const r of raw) {
    const device = (r as { device?: unknown } | null)?.device;
    const theme = (r as { theme?: unknown } | null)?.theme;
    if (!(SNAPSHOT_DEVICES as readonly unknown[]).includes(device)) return null;
    if (!(SNAPSHOT_THEMES as readonly unknown[]).includes(theme)) return null;
    if (out.some((o) => o.device === device && o.theme === theme)) continue;
    out.push({ device: device as SnapshotDevice, theme: theme as SnapshotTheme });
  }
  return out;
}

/** Read a capture request. Everything is checked; refs are rebuilt field by field. */
export function parseBackgroundCaptureRequest(body: unknown): Parsed<BackgroundCaptureRequest> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, message: "the body must be a JSON object" };
  }
  const b = body as Record<string, unknown>;
  if (b.v !== BACKGROUND_CAPTURE_VERSION) return { ok: false, message: "an unknown capture version" };
  const origin = parseOrigin(b.origin);
  if (!origin) return { ok: false, message: "origin must be the site's origin" };
  if (!isRoutePath(b.callback) || b.callback.length > 200) {
    return { ok: false, message: "callback must be a path on the site" };
  }
  if (typeof b.id !== "string" || !ID.test(b.id)) return { ok: false, message: "a capture id is required" };
  if (typeof b.token !== "string" || !TOKEN.test(b.token)) {
    return { ok: false, message: "a capture token is required" };
  }
  if (!Array.isArray(b.routes) || b.routes.length === 0 || b.routes.length > MAX_BACKGROUND_ROUTES) {
    return { ok: false, message: `routes must be 1 to ${MAX_BACKGROUND_ROUTES} paths` };
  }
  const routes: string[] = [];
  for (const r of b.routes) {
    if (!isRoutePath(r)) return { ok: false, message: "each route must be a path on the site" };
    if (!routes.includes(r)) routes.push(r);
  }
  const renderings = parseRenderings(b.renderings);
  if (!renderings) return { ok: false, message: "renderings must be drawn from phone/desktop × light/dark" };

  const targets: CaptureTarget[] = [];
  if (b.targets !== undefined) {
    if (!Array.isArray(b.targets) || b.targets.length > MAX_BACKGROUND_TARGETS) {
      return { ok: false, message: `at most ${MAX_BACKGROUND_TARGETS} values to picture` };
    }
    for (const t of b.targets) {
      const key = (t as { key?: unknown } | null)?.key;
      const ref = parseRef((t as { ref?: unknown } | null)?.ref);
      const pages = (t as { pages?: unknown } | null)?.pages;
      if (typeof key !== "string" || key.length === 0 || key.length > 120 || !ref || !Array.isArray(pages)) {
        return { ok: false, message: "each value to picture needs a key, a valid ref and its pages" };
      }
      targets.push({ key, ref, pages: pages.filter((p): p is string => routes.includes(p as string)) });
    }
  }
  return {
    ok: true,
    value: {
      v: BACKGROUND_CAPTURE_VERSION,
      origin,
      callback: b.callback,
      id: b.id,
      token: b.token,
      routes,
      renderings,
      targets,
    },
  };
}

// ── The worker's calls back to the site ──────────────────────────────────────

/** One cell of the capture, or one value picture shot in it. */
export interface CaptureSlot {
  route: string;
  device: SnapshotDevice;
  theme: SnapshotTheme;
  preview?: number;
}

export interface CaptureStoredImage {
  file: string;
  /** The Blob object URL, when the site stores images in Vercel Blob. */
  url?: string;
}

export type CaptureBlobAccess = "public" | "private";

/** One cell's outcome, reported once its images are stored. */
export interface CaptureShotRecord {
  route: string;
  device: SnapshotDevice;
  theme: SnapshotTheme;
  hash?: string;
  reason?: SkipReason;
  skipped?: string;
  image?: CaptureStoredImage;
  previews: { key: string; image: CaptureStoredImage }[];
  looked: string[];
  /** The access mode an upload to Blob succeeded with. */
  access?: CaptureBlobAccess;
}

export type CaptureCall =
  /** Is this capture yours? Asked by the service before it spends anything on it. */
  | { op: "hello" }
  /** Where does this image go? */
  | { op: "target"; slot: CaptureSlot; type: string; size: number }
  /** One piece of an image the site keeps on its own disk. */
  | { op: "chunk"; file: string; offset: number; data: string; last: boolean }
  | { op: "record"; record: CaptureShotRecord }
  /** Close the capture. `error` says why it ended early, when it did. */
  | { op: "finish"; error?: string };

export interface CaptureCallEnvelope {
  capture: { v: typeof BACKGROUND_CAPTURE_VERSION; id: string; token: string } & CaptureCall;
}

export type CaptureTargetReply =
  | {
      ok: true;
      kind: "blob";
      file: string;
      url: string;
      headers: Record<string, string>;
      access: CaptureBlobAccess | null;
    }
  | { ok: true; kind: "disk"; file: string };

/** `gone`: the capture isn't this one any more — stop, there's nothing to finish. */
export type CaptureFailure = { ok: false; message: string; gone?: true };

const SKIP_REASONS: readonly SkipReason[] = [
  "auth_wall",
  "off_origin",
  "protected",
  "bot_check",
  "http_error",
  "timeout",
  "budget",
  "blank",
  "failed",
];

function text(raw: unknown, max: number): string | undefined {
  return typeof raw === "string" && raw.length > 0 ? raw.slice(0, max) : undefined;
}

function parseSlot(raw: unknown): CaptureSlot | null {
  const s = raw as Record<string, unknown> | null;
  if (!s || !isRoutePath(s.route)) return null;
  if (!(SNAPSHOT_DEVICES as readonly unknown[]).includes(s.device)) return null;
  if (!(SNAPSHOT_THEMES as readonly unknown[]).includes(s.theme)) return null;
  if (s.preview !== undefined && !(Number.isInteger(s.preview) && (s.preview as number) >= 0)) return null;
  return {
    route: s.route,
    device: s.device as SnapshotDevice,
    theme: s.theme as SnapshotTheme,
    ...(s.preview !== undefined ? { preview: s.preview as number } : {}),
  };
}

function parseStored(raw: unknown): CaptureStoredImage | null {
  const i = raw as Record<string, unknown> | null;
  const file = text(i?.file, 80);
  if (!file) return null;
  const url = text(i?.url, 600);
  return { file, ...(url ? { url } : {}) };
}

function parseRecord(raw: unknown): CaptureShotRecord | null {
  const r = raw as Record<string, unknown> | null;
  const slot = parseSlot(r);
  if (!r || !slot || slot.preview !== undefined) return null;
  const previews: CaptureShotRecord["previews"] = [];
  if (!Array.isArray(r.previews) || r.previews.length > 16) return null;
  for (const p of r.previews) {
    const key = text((p as { key?: unknown } | null)?.key, 120);
    const image = parseStored((p as { image?: unknown } | null)?.image);
    if (!key || !image) return null;
    previews.push({ key, image });
  }
  let image: CaptureStoredImage | undefined;
  if (r.image !== undefined) {
    const stored = parseStored(r.image);
    if (!stored) return null;
    image = stored;
  }
  const hash = text(r.hash, 64);
  const skipped = text(r.skipped, 200);
  const reason = SKIP_REASONS.find((known) => known === r.reason);
  const looked = Array.isArray(r.looked)
    ? r.looked.filter((k): k is string => typeof k === "string" && k.length <= 120).slice(0, 64)
    : [];
  return {
    route: slot.route,
    device: slot.device,
    theme: slot.theme,
    ...(hash ? { hash } : {}),
    ...(reason ? { reason } : {}),
    ...(skipped ? { skipped } : {}),
    ...(image ? { image } : {}),
    previews,
    looked,
    ...(r.access === "public" || r.access === "private" ? { access: r.access } : {}),
  };
}

export interface ParsedCaptureCall {
  id: string;
  token: string;
  call: CaptureCall;
}

/**
 * Read a body as a worker's call. Null when it isn't one at all — an
 * ordinary beacon, which the ingest route then handles as it always has.
 */
export function parseCaptureCall(body: unknown): Parsed<ParsedCaptureCall> | null {
  const c = (body as { capture?: unknown } | null)?.capture as Record<string, unknown> | undefined;
  if (!c || typeof c !== "object") return null;
  if (c.v !== BACKGROUND_CAPTURE_VERSION) return { ok: false, message: "an unknown capture version" };
  if (typeof c.id !== "string" || !ID.test(c.id) || typeof c.token !== "string" || !TOKEN.test(c.token)) {
    return { ok: false, message: "a capture id and token are required" };
  }
  const head = { id: c.id, token: c.token };
  switch (c.op) {
    case "hello":
      return { ok: true, value: { ...head, call: { op: "hello" } } };
    case "target": {
      const slot = parseSlot(c.slot);
      const size = Number(c.size);
      if (!slot || typeof c.type !== "string" || !Number.isFinite(size)) {
        return { ok: false, message: "a target needs a slot, a type and a size" };
      }
      return { ok: true, value: { ...head, call: { op: "target", slot, type: c.type, size } } };
    }
    case "chunk": {
      const offset = Number(c.offset);
      if (typeof c.file !== "string" || typeof c.data !== "string" || !Number.isInteger(offset) || offset < 0) {
        return { ok: false, message: "a chunk needs a file, an offset and its data" };
      }
      return {
        ok: true,
        value: { ...head, call: { op: "chunk", file: c.file, offset, data: c.data, last: c.last === true } },
      };
    }
    case "record": {
      const record = parseRecord(c.record);
      if (!record) return { ok: false, message: "that isn't a shot record" };
      return { ok: true, value: { ...head, call: { op: "record", record } } };
    }
    case "finish": {
      const error = text(c.error, 300);
      return { ok: true, value: { ...head, call: { op: "finish", ...(error ? { error } : {}) } } };
    }
    default:
      return { ok: false, message: "an unknown capture call" };
  }
}

/**
 * True for a URL a worker may upload an image to: Vercel's Blob API, which is
 * where every upload target a site issues points. The site names the URL, so
 * the worker checks it — it won't send a PUT wherever it's told.
 */
export function isBlobUploadUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.protocol === "https:" &&
      (u.hostname === "vercel.com" ||
        u.hostname === "blob.vercel-storage.com" ||
        u.hostname.endsWith(".blob.vercel-storage.com"))
    );
  } catch {
    return false;
  }
}
