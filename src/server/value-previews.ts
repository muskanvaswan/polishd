/**
 * Polishd — pictures of where a flagged design value renders (server only).
 *
 * The Design tab knows a one-off 17px type style exists and which page it was
 * measured on; this finds the element that carries it and photographs it in
 * place. It runs inside a snapshot capture, right after a route's full shots,
 * on the browser that capture already launched: load the route, find each
 * target value's element with the same rules the client scanner tallies by,
 * scroll it into view, ring it, and screenshot a crop around it.
 *
 * Matching is by value, not by selector. The visitor's scan never recorded
 * *which* element carried a value — only that one did — and a selector shot
 * at a different viewport would often point at nothing anyway. Re-measuring
 * the page as the capture browser renders it means every picture shows the
 * value genuinely there, at the size and theme it was shot in.
 *
 * Best-effort throughout: a value that never turns up (only shown after a
 * click, only at a width we don't shoot) is reported as missed, and any
 * failure ends the pass with whatever was already pictured. The route's full
 * shots never depend on it.
 */
import type { Browser, Page } from "playwright-core";

import { previewClip, type DesignPreviewTarget, type DesignValueRef } from "../shared/design-values";

/** One rendering a pass can look in: an allpages device name and a theme. */
export interface PreviewRendering {
  device: string;
  theme: "light" | "dark";
}

export interface ValuePreviewCrop {
  key: string;
  device: string;
  theme: string;
  bytes: Buffer;
}

export interface ValuePreviewResult {
  crops: ValuePreviewCrop[];
  /** Keys looked for in every rendering and not found on screen in any. */
  missed: string[];
}

/** Attribute the locator tags candidate elements with: space-separated target indices. */
const LOCATE_ATTR = "data-polishd-locate";
const OVERLAY_ID = "__polishd_locate_ring";
/** Candidate elements remembered per value — the first may be off-canvas. */
const CANDIDATES_PER_TARGET = 3;
/** Same accent as the dashboard's one-off badges. */
const RING_COLOR = "#f59e0b";

// ── In-page functions ────────────────────────────────────────────────────────
//
// These run in the captured page via `page.evaluate`, which serializes the
// function's source — so each must be self-contained: no imports, nothing from
// module scope, constants passed in as arguments.

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

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  let sampled = 0;
  let visited = 0;
  // Looser bounds than the scanner's: this runs once, server-side, and the
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

// ── The pass ─────────────────────────────────────────────────────────────────

/**
 * Load the route as the snapshot shot it — same viewport, scale, theme and
 * user agent, same consent-dismissal pass — and leave it ready to measure.
 * Polishd's own beacons are answered locally: this is a measurement, and the
 * page stays open long enough that its design scan would otherwise land in
 * the store as a visit.
 */
async function openRendering(
  browser: Browser,
  origin: string,
  route: string,
  rendering: PreviewRendering,
): Promise<{ page: Page; close: () => Promise<void> } | null> {
  const { DEVICES, preparePage, userAgentFor } = await import("allpages");
  const device = DEVICES[rendering.device];
  if (!device) return null;
  const ctx = await browser.newContext({
    viewport: { width: device.width, height: device.height },
    deviceScaleFactor: device.scale,
    isMobile: device.mobile,
    hasTouch: device.mobile,
    colorScheme: rendering.theme,
    reducedMotion: "reduce",
    // A service worker would answer requests before the beacon route below sees them.
    serviceWorkers: "block",
    userAgent: userAgentFor(device, browser.version()),
    locale: "en-US",
    extraHTTPHeaders: { "accept-language": "en-US,en;q=0.9" },
  });
  const close = () => ctx.close().catch(() => {});
  try {
    const site = new URL(origin).origin;
    await ctx.route(
      (url) => url.origin === site && !url.pathname.startsWith("/_next/"),
      (r) => {
        const req = r.request();
        if (req.method() === "POST" && (req.postData() ?? "").startsWith('{"events":')) {
          return r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true,"stored":0}' });
        }
        return r.continue();
      },
    );
    const page = await ctx.newPage();
    await page.goto(new URL(route, origin).toString(), { waitUntil: "domcontentloaded", timeout: 15_000 });
    await page.waitForLoadState("networkidle", { timeout: 1500 }).catch(() => {});
    await page.evaluate("document.fonts && document.fonts.ready").catch(() => {});
    await preparePage(page, { hide: [], delayMs: 0, lazyLoad: true, dismissBanners: true });
    return { page, close };
  } catch {
    await close();
    return null;
  }
}

/**
 * Picture each target on one route. Renderings are tried in order — the
 * gallery's default view first — and a value found in an earlier one isn't
 * looked for again, so the usual cost is a single extra page load. Stops early
 * when `budgetMs` runs out, reporting the rest as neither found nor missed.
 */
export async function captureValuePreviews(
  browser: Browser,
  origin: string,
  route: string,
  targets: DesignPreviewTarget[],
  renderings: PreviewRendering[],
  budgetMs: number,
): Promise<ValuePreviewResult> {
  const started = Date.now();
  const crops: ValuePreviewCrop[] = [];
  let pending = targets;
  let exhausted = true;

  for (const rendering of renderings) {
    if (pending.length === 0) break;
    if (Date.now() - started > budgetMs) {
      exhausted = false;
      break;
    }
    const opened = await openRendering(browser, origin, route, rendering);
    if (!opened) {
      exhausted = false;
      continue;
    }
    const { page, close } = opened;
    const found = new Set<string>();
    try {
      const counts = await page.evaluate(markDesignTargets, {
        refs: pending.map((t) => t.ref),
        attr: LOCATE_ATTR,
        perTarget: CANDIDATES_PER_TARGET,
      });
      for (const [i, target] of pending.entries()) {
        if (!counts[i]) continue;
        if (Date.now() - started > budgetMs) {
          exhausted = false;
          break;
        }
        const box = await page.evaluate(focusDesignTarget, {
          attr: LOCATE_ATTR,
          index: i,
          overlayId: OVERLAY_ID,
          color: RING_COLOR,
        });
        const clip = box
          ? previewClip(box, { width: box.viewportWidth, height: box.viewportHeight })
          : null;
        if (!clip) continue;
        // One frame for the scroll to paint and anything it lazily revealed.
        await page.waitForTimeout(80);
        const bytes = await page.screenshot({ clip, animations: "disabled", type: "png" });
        await page.evaluate(clearDesignFocus, OVERLAY_ID);
        crops.push({ key: target.key, device: rendering.device, theme: rendering.theme, bytes });
        found.add(target.key);
      }
    } catch {
      // The page navigated or crashed mid-pass; keep what was pictured.
      exhausted = false;
    } finally {
      await close();
    }
    pending = pending.filter((t) => !found.has(t.key));
  }

  return { crops, missed: exhausted ? pending.map((t) => t.key) : [] };
}
