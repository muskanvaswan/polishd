/**
 * Polishd — the capture core: one route, one device, one theme, photographed.
 *
 * Shared by the two places a snapshot is shot: Polishd's hosted screenshot
 * service (service/), which shoots public sites from the owner's browser's
 * request, and the local-Chrome path (src/server/snapshot-local.ts), which
 * stands in for it when the site isn't publicly reachable — `next dev` on a
 * laptop. Both hand this module a page already opened in a context set up for
 * the rendering (viewport, color scheme, user agent, request guard); it loads
 * the route, waits for it to settle, checks where it actually landed, takes the
 * full-page shot, encodes it as WebP, and pictures any flagged design values in
 * place.
 *
 * Free of runtime imports on purpose: the service imports this file straight
 * from the package source, and anything it pulled in would have to resolve
 * from a directory the service's deployment never installs. Playwright is
 * described structurally (`CapturePage`) and allpages' helpers are handed in
 * (`ShootDeps`), so each host supplies its own copies.
 *
 * The in-page functions (`markDesignTargets`, `focusDesignTarget`, …) run in
 * the captured page via `page.evaluate`, which serializes their source — each
 * must be self-contained: nothing from module scope, constants passed in.
 */
import type {
  DesignValueRef,
  EncodedImage,
  FindTarget,
  ShotPreview,
  ShotResult,
  SkipReason,
  SnapshotDevice,
  SnapshotTheme,
} from "./protocol";

// ── Structural Playwright ────────────────────────────────────────────────────

export interface CaptureResponse {
  status(): number;
  headers(): Record<string, string>;
}

export interface CaptureScreenshotOptions {
  fullPage?: boolean;
  clip?: Box;
  animations?: "disabled" | "allow";
  type?: "png";
}

/** The slice of a Playwright `Page` the core uses. */
export interface CapturePage {
  goto(
    url: string,
    options: { waitUntil: "domcontentloaded"; timeout: number },
  ): Promise<CaptureResponse | null>;
  url(): string;
  title(): Promise<string>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  evaluate(fn: any, arg?: any): Promise<any>;
  screenshot(options: CaptureScreenshotOptions): Promise<Uint8Array>;
  waitForLoadState(state: "networkidle", options: { timeout: number }): Promise<void>;
  waitForTimeout(ms: number): Promise<void>;
}

/** An allpages device: viewport in CSS px plus the pixel ratio it renders at. */
export interface DeviceSpec {
  name: string;
  width: number;
  height: number;
  scale: number;
  mobile: boolean;
}

/** The allpages helpers the core leans on, handed in by each host. */
export interface ShootDeps {
  /** Dismiss consent banners, trigger lazy images — allpages' `preparePage`. */
  preparePage(page: CapturePage): Promise<void>;
  looksLikeAuthWall(path: string): boolean;
  looksLikeBotCheck(status: number, title: string): boolean;
}

// ── Origin pinning ───────────────────────────────────────────────────────────

/**
 * The URL to load for `route` on `origin`, or null when the route would leave
 * the origin. Every shot goes through this: a route is a path on the site
 * that asked, never a way to name another one (`//evil.example`, `/\evil`,
 * an absolute URL).
 */
export function pinRoute(origin: string, route: string): string | null {
  if (typeof route !== "string" || !route.startsWith("/") || route.startsWith("//")) return null;
  if (route.includes("\\")) return null;
  let base: URL;
  try {
    base = new URL(origin);
  } catch {
    return null;
  }
  if (base.origin !== origin) return null;
  let url: URL;
  try {
    url = new URL(route, base);
  } catch {
    return null;
  }
  if (url.origin !== base.origin) return null;
  url.hash = "";
  return url.toString();
}

/** Where a page ended up, relative to the origin it was asked to shoot. */
export type Landing =
  | { kind: "origin"; path: string }
  | { kind: "elsewhere"; host: string; vercelLogin: boolean };

/**
 * Classify the page's final URL. Anything off the origin is "elsewhere" —
 * the shot is refused, and the host it went to is reported. Vercel's
 * Deployment Protection is named specifically: its login is the most common
 * reason a preview deployment can't be shot, and it has a specific fix.
 */
export function landingOf(origin: string, finalUrl: string): Landing {
  let url: URL;
  try {
    url = new URL(finalUrl);
  } catch {
    return { kind: "elsewhere", host: "an unreadable URL", vercelLogin: false };
  }
  if (url.origin === origin) return { kind: "origin", path: url.pathname };
  const host = url.host || url.protocol.replace(/:$/, "");
  const vercelLogin =
    (url.hostname === "vercel.com" || url.hostname.endsWith(".vercel.com")) &&
    /^\/(login|sso-api|sso|signup)(\/|$)/.test(url.pathname);
  return { kind: "elsewhere", host, vercelLogin };
}

/**
 * True for a response that is Vercel's Deployment Protection gate rather than
 * the site: a 401 served by Vercel itself. Protection either answers like this
 * or redirects to vercel.com/login (which `landingOf` names).
 */
export function isVercelProtectionResponse(status: number, headers: Record<string, string>): boolean {
  if (status !== 401) return false;
  const server = (headers["server"] ?? "").toLowerCase();
  return server === "vercel" || "x-vercel-id" in headers;
}

/**
 * Run in every captured page before its own scripts (`context.addInitScript`):
 * `navigator.sendBeacon` becomes a no-op that reports success. Analytics —
 * the site's own Polishd beacons, dashboard telemetry, anyone else's — flush
 * with a beacon as the page closes, and a beacon is the one request a
 * request guard never sees, so this is what keeps a capture from ever
 * counting as a visit. Nothing on a page waits on a beacon's result.
 */
export function silenceBeacons(): void {
  try {
    Object.defineProperty(Navigator.prototype, "sendBeacon", {
      configurable: true,
      writable: true,
      value: function sendBeacon() {
        return true;
      },
    });
  } catch {
    // A page that froze Navigator first keeps its beacons; the guard still
    // answers whatever goes through fetch.
  }
}

/**
 * What the context's request guard does with one request:
 * - `continue` let it through (the egress rules still apply to it)
 * - `stay`     answer 204 No Content, which a browser takes as "don't navigate"
 * - `beacon`   answer a Polishd analytics beacon locally
 * - `abort`    refuse it outright
 */
export type RequestAction = "continue" | "stay" | "beacon" | "abort";

/**
 * The request guard both hosts install on every capture context. A top-level
 * navigation off the origin — script-driven, a meta refresh, a link the
 * consent dismisser clicked — is answered with a 204, so the page stays on
 * the site that asked, still shootable (aborting it instead would leave
 * Chromium on its own error page). Polishd's own analytics batches are
 * answered locally: a capture is a measurement, and its page loads would
 * otherwise land in the store as visits. (Batches sent with `sendBeacon`
 * never reach a guard — `silenceBeacons` handles those.) HTTP redirects never reach a request
 * guard (Playwright routes only the first URL of a redirect chain);
 * `landingOf` catches those after the load.
 */
export function requestAction(
  origin: string,
  req: { url: string; method: string; navigation: boolean; mainFrame: boolean; postData: string | null },
): RequestAction {
  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    return "abort";
  }
  if (req.navigation && req.mainFrame && url.origin !== origin) return "stay";
  if (req.method === "POST" && isPolishdBeacon(url.origin === origin, req.postData)) return "beacon";
  return "continue";
}

/**
 * True for a batch Polishd itself would record: the site's own analytics
 * (`{"events":…}`, posted to its ingest route) or dashboard telemetry
 * (`{"sessionId":…,"events":…}`, posted to the telemetry collector — on
 * another origin for every install but the collecting one). A capture that
 * renders the dashboard must report neither.
 */
export function isPolishdBeacon(sameOrigin: boolean, postData: string | null): boolean {
  const body = postData ?? "";
  if (sameOrigin && body.startsWith('{"events":')) return true;
  return /^\{"sessionId":"[^"]{0,200}","events":\[/.test(body);
}

// ── Framing ──────────────────────────────────────────────────────────────────

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Context kept around the element on every side, in CSS px. */
const CONTEXT_PX = 40;
/** Crops come out 16:10 — the hover card's shape — unless the viewport can't fit it. */
const ASPECT = 1.6;
/** Small elements still get a component's worth of surroundings. */
const MIN_WIDTH = 360;

/**
 * The clip to screenshot for an element at `el` (viewport coordinates, after
 * it was scrolled into view): the element plus context, grown to 16:10,
 * centered on the element's visible part and kept inside the viewport.
 * Null when no part of the element is on screen — a drawer parked off-canvas,
 * say — since a crop of whatever sits there instead would be a lie.
 */
export function previewClip(el: Box, viewport: { width: number; height: number }): Box | null {
  const vw = Math.floor(viewport.width);
  const vh = Math.floor(viewport.height);
  if (vw <= 0 || vh <= 0 || el.width <= 0 || el.height <= 0) return null;

  // The part of the element actually on screen.
  const left = Math.max(el.x, 0);
  const top = Math.max(el.y, 0);
  const right = Math.min(el.x + el.width, vw);
  const bottom = Math.min(el.y + el.height, vh);
  if (right <= left || bottom <= top) return null;

  let width = right - left + CONTEXT_PX * 2;
  let height = bottom - top + CONTEXT_PX * 2;
  if (width / height < ASPECT) width = height * ASPECT;
  else height = width / ASPECT;
  if (width < MIN_WIDTH) {
    width = MIN_WIDTH;
    height = MIN_WIDTH / ASPECT;
  }
  width = Math.min(Math.ceil(width), vw);
  height = Math.min(Math.ceil(height), vh);

  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const x = Math.min(Math.max(Math.round(cx - width / 2), 0), vw - width);
  const y = Math.min(Math.max(Math.round(cy - height / 2), 0), vh - height);
  return { x, y, width, height };
}

// ── In-page functions ────────────────────────────────────────────────────────

interface MarkArgs {
  refs: DesignValueRef[];
  attr: string;
  perTarget: number;
}

/**
 * Walk the page with the client scanner's rules (src/client/design-scan.ts —
 * keep the two in step) and tag up to `perTarget` elements carrying each
 * target value. Returns how many were tagged per target.
 */
function markDesignTargets({ refs, attr, perTarget }: MarkArgs): number[] {
  const SKIP_TAGS = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "META", "LINK", "HEAD", "TITLE", "IFRAME", "BR", "WBR",
  ]);
  const INTERACTIVE_TAGS = new Set(["BUTTON", "A", "INPUT", "SELECT", "TEXTAREA", "SUMMARY"]);

  const normalizeColor = (value: string): string | null => {
    const m = value.match(
      /^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/,
    );
    if (!m) return null;
    const to255 = (s: string) => Math.max(0, Math.min(255, Math.round(parseFloat(s))));
    let a = 1;
    if (m[4] !== undefined) a = m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    if (!(a > 0.02)) return null;
    const hex = (n: number) => n.toString(16).padStart(2, "0");
    const rgb = `#${hex(to255(m[1]))}${hex(to255(m[2]))}${hex(to255(m[3]))}`;
    return a >= 0.98 ? rgb : `${rgb}${hex(Math.round(a * 255))}`;
  };
  const primaryFamily = (fontFamily: string): string =>
    (fontFamily.split(",")[0]?.trim() ?? "").replace(/^["']|["']$/g, "").slice(0, 60);
  const hasOwnText = (el: Element): boolean => {
    for (let n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3 && n.textContent && n.textContent.trim().length > 0) return true;
    }
    return false;
  };

  // value → indices of the targets wanting it, per channel the scanner tallies.
  const fonts = new Map<string, number[]>();
  const text = new Map<string, number[]>();
  const bg = new Map<string, number[]>();
  const border = new Map<string, number[]>();
  const radii = new Map<string, number[]>();
  const pad = new Map<string, number[]>();
  const want = (map: Map<string, number[]>, key: string, i: number) => {
    const list = map.get(key);
    if (list) list.push(i);
    else map.set(key, [i]);
  };
  refs.forEach((ref, i) => {
    if (ref.kind === "font") want(fonts, `${ref.family}|${ref.sizePx}|${ref.weight}`, i);
    else if (ref.kind === "radius") want(radii, ref.value, i);
    else if (ref.kind === "spacing") want(pad, String(ref.px), i);
    else {
      const hex = ref.hex.toLowerCase();
      if (ref.roles.length === 0 || ref.roles.includes("text")) want(text, hex.slice(0, 7), i);
      if (ref.roles.length === 0 || ref.roles.includes("background")) want(bg, hex, i);
      if (ref.roles.length === 0 || ref.roles.includes("border")) want(border, hex, i);
    }
  });

  const counts = refs.map(() => 0);
  let unfilled = refs.length;
  const tag = (el: Element, list: number[] | undefined) => {
    if (!list) return;
    for (const i of list) {
      if (counts[i] >= perTarget) continue;
      const tokens = (el.getAttribute(attr) ?? "").split(" ").filter(Boolean);
      if (tokens.includes(String(i))) continue;
      tokens.push(String(i));
      el.setAttribute(attr, tokens.join(" "));
      if (++counts[i] === perTarget) unfilled--;
    }
  };

  // The scanner's transient states (design-declarations.ts `transientReason`):
  // a skeleton or busy region, an unrendered branch, a closed overlay at
  // opacity 0. Their values were never tallied, so they're never pictured.
  const transient = (el: Element): boolean => {
    if (el.getAttribute("aria-busy") === "true") return true;
    const cls = el.getAttribute("class");
    if (cls && cls.split(/\s+/).some((t) => /(?:^|:)animate-pulse$/.test(t) || /skeleton/i.test(t))) return true;
    const cs = getComputedStyle(el);
    if (cs.display === "none") return true;
    return (
      parseFloat(cs.opacity) <= 0.01 &&
      (el.getAttribute("aria-hidden") === "true" || el.getAttribute("inert") !== null || cs.position === "fixed")
    );
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (node) => (transient(node as Element) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  let sampled = 0;
  let visited = 0;
  // Looser bounds than the scanner's: this runs once per capture, and the
  // visitor's DOM may have reached the value later in the walk than ours does.
  for (
    let node = walker.nextNode();
    node && sampled < 5000 && visited < 20000 && unfilled > 0;
    node = walker.nextNode()
  ) {
    visited++;
    const el = node as Element;
    if (SKIP_TAGS.has(el.tagName)) continue;
    if (el.closest("svg") && el.tagName !== "svg") continue;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    sampled++;

    const ownBg = normalizeColor(cs.backgroundColor);
    const hasBorder =
      cs.borderStyle !== "none" &&
      (parseFloat(cs.borderTopWidth) > 0 ||
        parseFloat(cs.borderBottomWidth) > 0 ||
        parseFloat(cs.borderLeftWidth) > 0 ||
        parseFloat(cs.borderRightWidth) > 0);
    const boxy = ownBg !== null || hasBorder || INTERACTIVE_TAGS.has(el.tagName);

    if (hasOwnText(el)) {
      const family = primaryFamily(cs.fontFamily);
      const size = Math.round(parseFloat(cs.fontSize) * 10) / 10;
      const weight = Math.round(parseFloat(cs.fontWeight)) || 400;
      if (family && size > 0) tag(el, fonts.get(`${family}|${size}|${weight}`));
      const fg = normalizeColor(cs.color);
      if (fg) tag(el, text.get(fg.slice(0, 7)));
    }
    if (ownBg) tag(el, bg.get(ownBg));
    if (hasBorder) {
      const bc = normalizeColor(cs.borderTopColor);
      if (bc) tag(el, border.get(bc));
    }
    if (boxy) {
      const rtl = cs.borderTopLeftRadius;
      if (rtl && rtl !== "0px") {
        const corners = [rtl, cs.borderTopRightRadius, cs.borderBottomLeftRadius, cs.borderBottomRightRadius];
        const px = parseFloat(rtl);
        const label =
          rtl.endsWith("%") && px >= 50
            ? "full"
            : px >= Math.min(rect.width, rect.height) / 2
              ? "full"
              : corners.every((c) => c === rtl)
                ? `${Math.round(px)}px`
                : `${Math.round(px)}px (mixed)`;
        tag(el, radii.get(label));
      }
      for (const side of [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft]) {
        const v = Math.round(parseFloat(side));
        if (v > 0) tag(el, pad.get(String(v)));
      }
    }
  }
  return counts;
}

interface FocusArgs {
  attr: string;
  index: number;
  overlayId: string;
  color: string;
}

interface FocusResult {
  x: number;
  y: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
}

/**
 * Scroll the first on-screen candidate for target `index` into view and ring
 * it — an outline in the badge's amber with the rest of the page dimmed, so
 * the eye lands on the element in a crop full of neighbours.
 */
function focusDesignTarget({ attr, index, overlayId, color }: FocusArgs): FocusResult | null {
  document.getElementById(overlayId)?.remove();
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const vh = window.innerHeight;
  for (const el of Array.from(document.querySelectorAll(`[${attr}~="${index}"]`))) {
    el.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    if (r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh) continue;
    const gap = 3;
    const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
    const ring = document.createElement("div");
    ring.id = overlayId;
    Object.assign(ring.style, {
      position: "fixed",
      left: `${r.left - gap}px`,
      top: `${r.top - gap}px`,
      width: `${r.width + gap * 2}px`,
      height: `${r.height + gap * 2}px`,
      boxSizing: "border-box",
      margin: "0",
      border: `2px solid ${color}`,
      borderRadius: `${radius + gap}px`,
      boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.3)",
      pointerEvents: "none",
      zIndex: "2147483647",
    });
    document.documentElement.appendChild(ring);
    return { x: r.left, y: r.top, width: r.width, height: r.height, viewportWidth: vw, viewportHeight: vh };
  }
  return null;
}

function clearDesignFocus(overlayId: string): void {
  document.getElementById(overlayId)?.remove();
}

/** The page's full scroll height, in CSS px. */
function documentHeight(): number {
  const d = document.documentElement;
  return Math.max(d.scrollHeight, d.offsetHeight, document.body ? document.body.scrollHeight : 0);
}

interface EncodeArgs {
  data: string;
  quality: number;
  scale: number;
}

/**
 * Re-encode a PNG (base64) as WebP with the browser's own encoder — run in a
 * blank, offline page, never in the site being shot. Chromium falls back to
 * PNG for images WebP can't hold (over 16383px on a side); the returned type
 * says which it produced.
 */
async function encodeInPage({ data, quality, scale }: EncodeArgs) {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: "image/webp", quality });
  const out = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < out.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, Array.from(out.subarray(i, i + 0x8000)));
  }
  return { type: blob.type, width, height, data: btoa(s) };
}

// ── Encoding ─────────────────────────────────────────────────────────────────

/**
 * Quality steps tried, in order, until the image fits its budget: quality
 * first (cheap to lose), then resolution (a phone shot at 2× halves cleanly).
 */
export const ENCODE_STEPS: readonly { quality: number; scale: number }[] = [
  { quality: 0.82, scale: 1 },
  { quality: 0.65, scale: 1 },
  { quality: 0.5, scale: 1 },
  { quality: 0.6, scale: 0.75 },
  { quality: 0.55, scale: 0.5 },
];

/** Tallest image the core will produce, in device pixels — under WebP's 16383 cap. */
export const MAX_SHOT_PIXEL_HEIGHT = 16_000;

/**
 * Encode a PNG as WebP within `maxBase64Bytes`, or null when even the
 * smallest step doesn't fit. `blank` is a page in its own offline context —
 * the encoder runs there, not in the site.
 */
export async function encodeImage(
  blank: CapturePage,
  png: Uint8Array,
  maxBase64Bytes: number,
): Promise<EncodedImage | null> {
  const data = Buffer.from(png).toString("base64");
  for (const step of ENCODE_STEPS) {
    const out = (await blank.evaluate(encodeInPage, { data, ...step })) as EncodedImage;
    if (out.data.length <= maxBase64Bytes) return out;
  }
  return null;
}

/** A short hash of the rendered pixels — equal light/dark hashes mean no dark mode. */
export async function hashPixels(png: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new Uint8Array(png));
  return Buffer.from(digest).toString("hex").slice(0, 32);
}

// ── The shot ─────────────────────────────────────────────────────────────────

export interface ShootInput {
  /** The site's origin, exactly as `new URL(x).origin` prints it. */
  origin: string;
  route: string;
  device: DeviceSpec;
  theme: SnapshotTheme;
  /** Flagged values to picture, if this rendering shows them. */
  find: FindTarget[];
  navigationTimeoutMs: number;
  /** Time the value-preview pass may add once the shot is taken. */
  previewBudgetMs: number;
  /** Base64 bytes the full shot may take; it's re-encoded smaller to fit. */
  maxImageBytes: number;
}

/** Attribute the locator tags candidate elements with: space-separated target indices. */
const LOCATE_ATTR = "data-polishd-locate";
const OVERLAY_ID = "__polishd_locate_ring";
/** Candidate elements remembered per value — the first may be off-canvas. */
const CANDIDATES_PER_TARGET = 3;
/** Same accent as the dashboard's one-off badges. */
const RING_COLOR = "#f59e0b";
/** Base64 bytes per value preview — a viewport-sized crop at most. */
const MAX_PREVIEW_BYTES = 400_000;

function skip(
  input: ShootInput,
  reason: SkipReason,
  skipped: string,
  extra: Partial<ShotResult> = {},
): ShotResult {
  return {
    route: input.route,
    device: input.device.name as SnapshotDevice,
    theme: input.theme,
    reason,
    skipped,
    previews: [],
    looked: [],
    ...extra,
  };
}

function shortError(message: string): { reason: SkipReason; text: string } {
  // Playwright appends " at <url>"; the caller knows the URL, and it has no
  // business in a stored reason.
  const first = (message.split("\n")[0] ?? message).replace(/^page\.\w+: /, "").replace(/ at \S+$/, "");
  if (/timeout/i.test(first)) return { reason: "timeout", text: "timed out" };
  if (/ERR_HTTP_RESPONSE_CODE_FAILURE/.test(first)) {
    return { reason: "http_error", text: "the server answered with an error and no page" };
  }
  if (/ERR_TUNNEL_CONNECTION_FAILED|ERR_PROXY_CONNECTION_FAILED|ERR_BLOCKED/.test(first)) {
    return { reason: "failed", text: "blocked: the address isn't public" };
  }
  if (/ERR_NAME_NOT_RESOLVED/.test(first)) return { reason: "failed", text: "host not found" };
  if (/ERR_CONNECTION_REFUSED|ECONNREFUSED/.test(first)) {
    return { reason: "failed", text: "connection refused" };
  }
  return { reason: "failed", text: first.length > 80 ? `${first.slice(0, 77)}…` : first };
}

function samePath(a: string, b: string): boolean {
  const norm = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p) || "/";
  return norm(a) === norm(b);
}

/**
 * Shoot one rendering of one route. Never throws: every failure comes back as
 * a skipped cell with its reason, so one bad page can't sink a capture.
 */
export async function shootRendering(
  page: CapturePage,
  blank: CapturePage,
  input: ShootInput,
  deps: ShootDeps,
): Promise<ShotResult> {
  const target = pinRoute(input.origin, input.route);
  if (!target) return skip(input, "failed", "not a path on this site");

  let response: CaptureResponse | null;
  try {
    response = await page.goto(target, {
      waitUntil: "domcontentloaded",
      timeout: input.navigationTimeoutMs,
    });
  } catch (err) {
    const { reason, text } = shortError(err instanceof Error ? err.message : String(err));
    return skip(input, reason, text);
  }

  try {
    await settle(page);
    await deps.preparePage(page);

    const landing = landingOf(input.origin, page.url());
    if (landing.kind === "elsewhere") {
      return landing.vercelLogin
        ? skip(input, "protected", "behind Vercel's login", { redirectedTo: landing.host })
        : skip(input, "off_origin", `redirected to ${landing.host}`, { redirectedTo: landing.host });
    }
    const status = response?.status() ?? 0;
    const headers = response?.headers() ?? {};
    if (isVercelProtectionResponse(status, headers)) {
      return skip(input, "protected", "behind Vercel's login", { status });
    }
    const asked = new URL(target).pathname;
    if (!samePath(landing.path, asked) && deps.looksLikeAuthWall(landing.path)) {
      return skip(input, "auth_wall", `redirected to ${landing.path}`, {
        redirectedTo: landing.path,
        status,
      });
    }
    const title = (await page.title().catch(() => "")).trim();
    if (deps.looksLikeBotCheck(status, title)) {
      return skip(input, "bot_check", "blocked by a bot check", { status });
    }
    if (status >= 400) return skip(input, "http_error", `HTTP ${status}`, { status });

    // Full page, capped below WebP's height limit; a page taller than that
    // keeps its top, which is what the gallery shows anyway.
    const cssCap = Math.floor(MAX_SHOT_PIXEL_HEIGHT / input.device.scale);
    const docHeight = Number(await page.evaluate(documentHeight).catch(() => 0)) || 0;
    const truncated = docHeight > cssCap;
    const png = await page.screenshot({
      fullPage: true,
      animations: "disabled",
      type: "png",
      ...(truncated ? { clip: { x: 0, y: 0, width: input.device.width, height: cssCap } } : {}),
    });
    const hash = await hashPixels(png);
    const image = await encodeImage(blank, png, input.maxImageBytes);
    if (!image) {
      return skip(input, "budget", "too large to send in one response", { status, hash });
    }
    if (truncated) image.truncated = true;

    const pictured = await pictureValues(page, blank, input);
    return {
      route: input.route,
      device: input.device.name as SnapshotDevice,
      theme: input.theme,
      image,
      hash,
      ...(title ? { title: title.slice(0, 200) } : {}),
      status,
      ...(samePath(landing.path, asked) ? {} : { redirectedTo: landing.path }),
      previews: pictured.previews,
      looked: pictured.looked,
    };
  } catch (err) {
    const { reason, text } = shortError(err instanceof Error ? err.message : String(err));
    return skip(input, reason, text);
  }
}

/** Wait for the page to stop moving, without hanging on polling apps. */
async function settle(page: CapturePage): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 1500 }).catch(() => {});
  await page.evaluate("document.fonts && document.fonts.ready").catch(() => {});
  await page.waitForTimeout(90);
}

/**
 * Picture each requested value that this rendering shows: tag its candidate
 * elements with the scanner's rules, scroll the first on-screen one into
 * view, ring it, and screenshot a crop around it. Runs after the full shot on
 * the same page, so it costs no extra load. Best-effort: a value not on
 * screen here is simply not in `previews`, and a failure keeps what was
 * already pictured.
 */
async function pictureValues(
  page: CapturePage,
  blank: CapturePage,
  input: ShootInput,
): Promise<{ previews: ShotPreview[]; looked: string[] }> {
  const previews: ShotPreview[] = [];
  if (input.find.length === 0) return { previews, looked: [] };
  const started = Date.now();
  const looked: string[] = [];
  try {
    const counts = (await page.evaluate(markDesignTargets, {
      refs: input.find.map((t) => t.ref),
      attr: LOCATE_ATTR,
      perTarget: CANDIDATES_PER_TARGET,
    })) as number[];
    for (const [i, target] of input.find.entries()) {
      if (Date.now() - started > input.previewBudgetMs) break;
      looked.push(target.key);
      if (!counts[i]) continue;
      const box = (await page.evaluate(focusDesignTarget, {
        attr: LOCATE_ATTR,
        index: i,
        overlayId: OVERLAY_ID,
        color: RING_COLOR,
      })) as FocusResult | null;
      const clip = box
        ? previewClip(box, { width: box.viewportWidth, height: box.viewportHeight })
        : null;
      if (!clip) continue;
      // One frame for the scroll to paint and anything it lazily revealed.
      await page.waitForTimeout(80);
      const png = await page.screenshot({ clip, animations: "disabled", type: "png" });
      await page.evaluate(clearDesignFocus, OVERLAY_ID);
      const image = await encodeImage(blank, png, MAX_PREVIEW_BYTES);
      if (image) previews.push({ key: target.key, image });
    }
  } catch {
    // The page navigated or crashed mid-pass; keep what was pictured.
  }
  return { previews, looked };
}
