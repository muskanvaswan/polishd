/**
 * Polishd — the screenshot service's wire contract, version 1.
 *
 * Site snapshots are shot by Polishd's hosted screenshot service: the
 * dashboard, running in the site owner's browser, POSTs one route at a time to
 * it, and the service photographs that route on the origin the browser named
 * in its `Origin` header — never any other site. This file is the contract
 * both ends compile against: the dashboard (src/dashboard/snapshot-capture.ts),
 * the service (service/), and the local-Chrome fallback that stands in for the
 * service when the site isn't publicly reachable (src/server/snapshot-local.ts).
 *
 * Versioning: the version lives in the path (`/api/v1/shoot`). Within v1 the
 * contract only grows optional fields — a caller ignores what it doesn't
 * know. A breaking change ships as `/v2` beside v1, which stays up for as long
 * as released package versions call it.
 *
 * Kept free of runtime imports so `node --test`, the package build, and the
 * service's Next build can all load it as-is.
 */

/** Where released packages send captures. A subdomain the project controls. */
export const SNAPSHOT_SERVICE_URL = "https://shots.polishd.muskanvaswan.xyz/api/v1";

export const SNAPSHOT_PROTOCOL_VERSION = 1;

/** The device/theme matrix a snapshot can shoot — allpages' device names. */
export const SNAPSHOT_DEVICES = ["phone", "desktop"] as const;
export const SNAPSHOT_THEMES = ["light", "dark"] as const;
export type SnapshotDevice = (typeof SNAPSHOT_DEVICES)[number];
export type SnapshotTheme = (typeof SNAPSHOT_THEMES)[number];

/**
 * The viewport each device renders at, as allpages defines it — in CSS px,
 * with the pixel ratio. The dashboard uses it to cut a first-screen shot out
 * of a full-page one when an older service ignored `viewport`.
 */
export const DEVICE_VIEWPORTS: Record<SnapshotDevice, { width: number; height: number; scale: number }> = {
  phone: { width: 390, height: 844, scale: 2 },
  desktop: { width: 1440, height: 900, scale: 1 },
};

/** Request caps. The dashboard sends one route × one rendering per call. */
export const MAX_ROUTES_PER_REQUEST = 4;
export const MAX_FIND_PER_REQUEST = 16;
export const MAX_ROUTE_LENGTH = 2048;
/** Bytes of request body the service will read. */
export const MAX_REQUEST_BYTES = 64 * 1024;

/**
 * Bytes of JSON a response may carry. Vercel caps function responses at
 * 4.5 MB; this leaves headroom for the envelope and the platform's own
 * framing. Images are base64 inside it, so the pixel budget is ~3/4 of this.
 */
export const RESPONSE_BUDGET_BYTES = 4_200_000;

/** The identity of one measured design value, as the client scan tallies it. */
export type DesignValueRef =
  | { kind: "font"; family: string; sizePx: number; weight: number }
  | { kind: "color"; hex: string; roles: ("text" | "background" | "border")[] }
  | { kind: "radius"; value: string }
  | { kind: "spacing"; px: number };

/** A flagged value to find on the page and picture in place. */
export interface FindTarget {
  key: string;
  ref: DesignValueRef;
}

export interface ShootRequest {
  routes: string[];
  devices: SnapshotDevice[];
  themes: SnapshotTheme[];
  find: FindTarget[];
  /**
   * Shoot the first screen only — the viewport, not the full page. What the
   * design review is shown. Added within v1; a service that predates it
   * returns the full page, and the dashboard crops.
   */
  viewport?: true;
}

export interface EncodedImage {
  /** `image/webp` normally; `image/png` only if the encoder couldn't do WebP. */
  type: string;
  width: number;
  height: number;
  /** Base64, no `data:` prefix. */
  data: string;
  /** True when a very tall page was cut at the height cap. */
  truncated?: boolean;
}

/**
 * Why a cell has no image.
 * - `auth_wall`  redirected to a login-looking path on the same origin
 * - `off_origin` the page left the origin; no pixels of the other site are returned
 * - `protected`  the deployment answered with Vercel's login (Deployment Protection)
 * - `bot_check`  a bot-check interstitial answered instead of the page
 * - `http_error` the route answered 4xx/5xx
 * - `timeout`    the page didn't load in time
 * - `budget`     didn't fit this response — request it on its own
 * - `failed`     anything else
 */
export type SkipReason =
  | "auth_wall"
  | "off_origin"
  | "protected"
  | "bot_check"
  | "http_error"
  | "timeout"
  | "budget"
  | "failed";

export interface ShotPreview {
  key: string;
  image: EncodedImage;
}

export interface ShotResult {
  route: string;
  device: SnapshotDevice;
  theme: SnapshotTheme;
  image?: EncodedImage;
  /** Hash of the rendered pixels, for spotting a site with no dark mode. */
  hash?: string;
  title?: string;
  status?: number;
  /** Human-readable reason, when there's no image. */
  skipped?: string;
  reason?: SkipReason;
  /** Where the page went instead: a path on the origin, or another host. */
  redirectedTo?: string;
  /** Pictures of the requested values that were found in this rendering. */
  previews: ShotPreview[];
  /** Keys that were looked for in this rendering (found or not). */
  looked: string[];
}

export interface ShootResponse {
  v: 1;
  origin: string;
  shots: ShotResult[];
}

export type ServiceErrorCode =
  | "bad_request"
  | "origin_required"
  | "origin_not_public"
  | "origin_unresolvable"
  | "rate_limited"
  | "unavailable"
  | "internal";

export type RateLimitScope = "ip" | "origin" | "global";

export interface ServiceErrorBody {
  v: 1;
  error: {
    code: ServiceErrorCode;
    message: string;
    /** Seconds until a retry can succeed, for `rate_limited`. */
    retryAfter?: number;
    scope?: RateLimitScope;
  };
}

// ── Validation ───────────────────────────────────────────────────────────────

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
const RADIUS = /^(full|\d{1,4}px( \(mixed\))?)$/;
const ROLES = new Set(["text", "background", "border"]);

/**
 * True for a route the service may shoot: a path on the origin, nothing that
 * a URL parser could read as another host or scheme. The origin check after
 * resolving (`pinRoute` in core.ts) is the real gate; this rejects the obvious
 * shapes early with a clear message.
 */
export function isRoutePath(route: unknown): route is string {
  return (
    typeof route === "string" &&
    route.length > 0 &&
    route.length <= MAX_ROUTE_LENGTH &&
    route.startsWith("/") &&
    !route.startsWith("//") &&
    !route.includes("\\") &&
    // Control characters and whitespace have no business in a path.
    !/[\u0000- \u007f]/.test(route)
  );
}

function parseRef(raw: unknown): DesignValueRef | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  switch (r.kind) {
    case "font":
      return typeof r.family === "string" &&
        r.family.length > 0 &&
        r.family.length <= 60 &&
        typeof r.sizePx === "number" &&
        Number.isFinite(r.sizePx) &&
        r.sizePx > 0 &&
        r.sizePx < 1000 &&
        typeof r.weight === "number" &&
        Number.isFinite(r.weight) &&
        r.weight > 0 &&
        r.weight <= 1000
        ? { kind: "font", family: r.family, sizePx: r.sizePx, weight: r.weight }
        : null;
    case "color": {
      if (typeof r.hex !== "string" || !HEX.test(r.hex) || !Array.isArray(r.roles)) return null;
      if (r.roles.length > 3 || !r.roles.every((x) => typeof x === "string" && ROLES.has(x))) {
        return null;
      }
      return {
        kind: "color",
        hex: r.hex.toLowerCase(),
        roles: r.roles as ("text" | "background" | "border")[],
      };
    }
    case "radius":
      return typeof r.value === "string" && RADIUS.test(r.value)
        ? { kind: "radius", value: r.value }
        : null;
    case "spacing":
      return typeof r.px === "number" && Number.isInteger(r.px) && r.px > 0 && r.px <= 1000
        ? { kind: "spacing", px: r.px }
        : null;
    default:
      return null;
  }
}

function listOf<T extends string>(
  raw: unknown,
  single: unknown,
  allowed: readonly T[],
  name: string,
): Parsed<T[]> {
  const values = raw === undefined ? (single === undefined ? [...allowed] : [single]) : raw;
  if (!Array.isArray(values) || values.length === 0) {
    return { ok: false, message: `${name} must be a non-empty list` };
  }
  const out: T[] = [];
  for (const v of values) {
    if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) {
      return { ok: false, message: `${name} must be drawn from ${allowed.join(", ")}` };
    }
    if (!out.includes(v as T)) out.push(v as T);
  }
  return { ok: true, value: out };
}

/**
 * Read a shoot request body. Accepts `routes`/`devices`/`themes` lists or the
 * singular `route`/`device`/`theme`; devices and themes default to all of
 * them. Everything is checked against the caps, and design-value refs are
 * rebuilt field by field so nothing unexpected reaches the page.
 */
export function parseShootRequest(body: unknown): Parsed<ShootRequest> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, message: "the body must be a JSON object" };
  }
  const b = body as Record<string, unknown>;

  const rawRoutes = b.routes === undefined ? (b.route === undefined ? undefined : [b.route]) : b.routes;
  if (!Array.isArray(rawRoutes) || rawRoutes.length === 0) {
    return { ok: false, message: "routes must be a non-empty list of paths" };
  }
  if (rawRoutes.length > MAX_ROUTES_PER_REQUEST) {
    return { ok: false, message: `at most ${MAX_ROUTES_PER_REQUEST} routes per request` };
  }
  const routes: string[] = [];
  for (const r of rawRoutes) {
    if (!isRoutePath(r)) {
      return { ok: false, message: "each route must be a path on the site, starting with /" };
    }
    if (!routes.includes(r)) routes.push(r);
  }

  const devices = listOf(b.devices, b.device, SNAPSHOT_DEVICES, "devices");
  if (!devices.ok) return devices;
  const themes = listOf(b.themes, b.theme, SNAPSHOT_THEMES, "themes");
  if (!themes.ok) return themes;

  const find: FindTarget[] = [];
  if (b.find !== undefined) {
    if (!Array.isArray(b.find)) return { ok: false, message: "find must be a list" };
    if (b.find.length > MAX_FIND_PER_REQUEST) {
      return { ok: false, message: `at most ${MAX_FIND_PER_REQUEST} values to find per request` };
    }
    for (const t of b.find) {
      const key = (t as { key?: unknown } | null)?.key;
      const ref = parseRef((t as { ref?: unknown } | null)?.ref);
      if (typeof key !== "string" || key.length === 0 || key.length > 120 || !ref) {
        return { ok: false, message: "each value to find needs a key and a valid ref" };
      }
      find.push({ key, ref });
    }
  }

  return {
    ok: true,
    value: {
      routes,
      devices: devices.value,
      themes: themes.value,
      find,
      ...(b.viewport === true ? { viewport: true } : {}),
    },
  };
}

/** Rough size of a shot once serialized — what the response budget counts. */
export function shotWireBytes(shot: ShotResult): number {
  let n = 300 + (shot.title?.length ?? 0) + shot.route.length;
  if (shot.image) n += shot.image.data.length;
  for (const p of shot.previews) n += p.image.data.length + p.key.length + 80;
  for (const k of shot.looked) n += k.length + 4;
  return n;
}

// ── Who can be shot by the service ───────────────────────────────────────────

/**
 * True when `origin` could be reachable from the public internet — the
 * dashboard's first guess at whether the service can shoot it. `localhost`,
 * private and link-local addresses, `.local`/`.internal` names and bare
 * intranet hostnames go straight to the local engine instead. The service
 * makes the authoritative check after DNS; this only avoids a round trip that
 * can't succeed.
 */
export function looksPublicOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (host === "localhost" || (!host.includes(".") && !host.includes(":"))) return false;
  if (/\.(localhost|local|internal|intranet|lan|home|corp|localdomain|home\.arpa)$/.test(host)) {
    return false;
  }
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (host.includes(":")) {
    // IPv6 literal: only global unicast (2000::/3) is public.
    return /^[23][0-9a-f]{0,3}:/.test(host);
  }
  return true;
}

/**
 * Why a capture found the service can't be used from here. The section turns
 * off and stays at the bottom of the Design tab, saying why, until a capture
 * gets through again.
 */
export type CaptureBlockReason =
  | "csp"
  | "unreachable"
  | "down"
  | "rate_limited"
  | "not_public"
  | "protected";

export interface CaptureBlock {
  reason: CaptureBlockReason;
  message: string;
}

/** A block as the store keeps it, with when it happened. */
export interface StoredCaptureBlock extends CaptureBlock {
  at: number;
}

const BLOCK_REASONS = new Set<string>(["csp", "unreachable", "down", "rate_limited", "not_public", "protected"]);

/** Accept a block from the dashboard (or the store) only in its own shape. */
export function parseCaptureBlock(value: unknown): CaptureBlock | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.reason !== "string" || !BLOCK_REASONS.has(v.reason)) return null;
  if (typeof v.message !== "string" || v.message.trim().length === 0) return null;
  return { reason: v.reason as CaptureBlockReason, message: v.message.slice(0, 600) };
}

/** Which engine shoots a capture: the hosted service, or a browser on the site's own server. */
export type SnapshotEngine = { kind: "service"; url: string } | { kind: "local" };

/** The owner's answer to "may snapshots use Polishd's screenshot service?" — null until asked. */
export type SnapshotConsent = "accepted" | "declined" | null;

/** Why capture is off on a deployment, known before any capture runs. */
export type SnapshotDisabledReason = "no_storage" | "declined" | "turned_off";

/**
 * What the Site snapshots section can do on this dashboard:
 *
 * - `local`     — `next dev`, or a dashboard opened on localhost or a private
 *                 address: a browser on this machine shoots, nothing leaves it,
 *                 nothing to consent to.
 * - `consent`   — production, with somewhere to store images, but the owner
 *                 hasn't been asked about the screenshot service yet.
 * - `service`   — production, storage ready, the owner agreed: the service shoots.
 * - `disabled`  — production without one of those: the section is off, and says why.
 */
export type SnapshotMode =
  | { kind: "local"; reason: "development" | "not_public" }
  | { kind: "consent"; url: string }
  | { kind: "service"; url: string }
  | { kind: "disabled"; reason: SnapshotDisabledReason };

export interface SnapshotModeInput {
  /** The origin the dashboard is open on. */
  origin: string;
  /** True under `next dev`. */
  development: boolean;
  /**
   * `POLISHD_SNAPSHOT_SERVICE`: `off` keeps every capture on this machine
   * (and so turns capture off on a public deployment); a URL points at
   * another deployment of the service and is used even in development, which
   * is how the service path is tested locally.
   */
  override?: string;
  /** Whether images have somewhere to go: a Blob store, or a writable disk off Vercel. */
  storageReady: boolean;
  consent: SnapshotConsent;
}

function serviceOverride(override: string | undefined): string | null {
  const o = override?.trim();
  if (!o) return null;
  try {
    const u = new URL(o);
    return u.protocol === "https:" || u.protocol === "http:" ? o.replace(/\/+$/, "") : null;
  } catch {
    return null;
  }
}

/**
 * The service a capture would use here — an override URL or the hosted one —
 * or null when `POLISHD_SNAPSHOT_SERVICE=off` means it's never called. Named
 * in the consent dialog, including when it's reopened after a "Not now".
 */
export function snapshotServiceUrl(override?: string): string | null {
  if (["off", "local"].includes(override?.trim() ?? "")) return null;
  return serviceOverride(override) ?? SNAPSHOT_SERVICE_URL;
}

/** Decide the section's mode. Pure: the dashboard and every capture action ask the same question. */
export function decideSnapshotMode(input: SnapshotModeInput): SnapshotMode {
  const off = ["off", "local"].includes(input.override?.trim() ?? "");
  const url = off ? null : serviceOverride(input.override);
  if (!url) {
    if (input.development) return { kind: "local", reason: "development" };
    if (!looksPublicOrigin(input.origin)) return { kind: "local", reason: "not_public" };
    if (off) return { kind: "disabled", reason: "turned_off" };
  }
  const service = url ?? SNAPSHOT_SERVICE_URL;
  if (!input.storageReady) return { kind: "disabled", reason: "no_storage" };
  if (input.consent === "declined") return { kind: "disabled", reason: "declined" };
  if (input.consent !== "accepted") return { kind: "consent", url: service };
  return { kind: "service", url: service };
}
