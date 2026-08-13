/**
 * Polishd — client design scanner.
 *
 * Samples the *rendered* page — computed styles, not source CSS — and reduces
 * it to compact tallies: which font family/size/weight combinations actually
 * appear, which colors paint text/backgrounds/borders, which text-on-background
 * pairs exist (for contrast checking), and which radii and paddings the page
 * really uses. This is the deterministic half of the dashboard's Design tab:
 * reverse-engineering the design system out of the built site.
 *
 * Deliberately tally-based: a page emits one `design_scan` event of a few KB,
 * never per-element rows. Scanning runs once per session per path, after the
 * page has settled, and only when the tab is visible (a background prerender
 * has no layout worth measuring).
 */
import type {
  DesignColorTuple,
  DesignFontTuple,
  DesignPadTuple,
  DesignPairTuple,
  DesignRadiusTuple,
  PolishdDesignScanPayload,
} from "../shared/types";

/** Hard bound on elements measured, so a huge DOM can't stall the main thread. */
const MAX_ELEMENTS = 1500;
/** Per-list caps applied before serializing — one page stays a few KB. */
const CAPS = { fonts: 60, colors: 48, pairs: 60, radii: 24, pad: 40 };
/** Keep the serialized payload under ingest's acceptance cap with headroom. */
const MAX_PAYLOAD_CHARS = 28_000;

/** Tags that never carry visual design signal. */
const SKIP_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEMPLATE",
  "META",
  "LINK",
  "HEAD",
  "TITLE",
  "IFRAME",
  "BR",
  "WBR",
]);

const INTERACTIVE_TAGS = new Set(["BUTTON", "A", "INPUT", "SELECT", "TEXTAREA", "SUMMARY"]);

/**
 * Parse a computed color into `#rrggbb` / `#rrggbbaa`, or null when fully
 * transparent or in a syntax we don't recognize (rare wide-gamut outputs are
 * skipped rather than guessed at).
 */
export function normalizeColor(value: string): string | null {
  const m = value.match(
    /^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/,
  );
  if (!m) return null;
  const to255 = (s: string) => Math.max(0, Math.min(255, Math.round(parseFloat(s))));
  const r = to255(m[1]);
  const g = to255(m[2]);
  const b = to255(m[3]);
  let a = 1;
  if (m[4] !== undefined) {
    a = m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  }
  if (!(a > 0.02)) return null; // effectively invisible
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  const rgb = `#${hex(r)}${hex(g)}${hex(b)}`;
  return a >= 0.98 ? rgb : `${rgb}${hex(Math.round(a * 255))}`;
}

/** First font family in the computed list, unquoted. */
function primaryFamily(fontFamily: string): string {
  const first = fontFamily.split(",")[0]?.trim() ?? "";
  return first.replace(/^["']|["']$/g, "").slice(0, 60);
}

/** Whether the element has a direct (non-whitespace) text child. */
function hasOwnText(el: Element): boolean {
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 3 && n.textContent && n.textContent.trim().length > 0) return true;
  }
  return false;
}

function ownText(el: Element): string {
  let out = "";
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 3 && n.textContent) out += n.textContent;
    if (out.length > 80) break;
  }
  return out.replace(/\s+/g, " ").trim().slice(0, 48);
}

interface FontAcc {
  count: number;
  sample: string;
  tags: Set<string>;
}

class Tally {
  map = new Map<string, number>();
  add(key: string, n = 1) {
    this.map.set(key, (this.map.get(key) ?? 0) + n);
  }
  top(cap: number): [string, number][] {
    return [...this.map.entries()].sort((a, b) => b[1] - a[1]).slice(0, cap);
  }
}

/**
 * Walk the page and reduce it to design tallies. Pure DOM reads — call it when
 * the page has settled. Returns null when there is nothing measurable.
 */
export function collectDesignScan(root: Element = document.body): PolishdDesignScanPayload | null {
  if (!root) return null;

  const fonts = new Map<string, FontAcc>();
  const text = new Tally();
  const bg = new Tally();
  const border = new Tally();
  const radii = new Tally();
  const pad = new Tally();
  const pairs = new Map<string, { count: number; minSize: number; boldAtMin: boolean }>();

  // Effective background of an element: its own, or the nearest ancestor with
  // a non-transparent one. Cached per element so shared ancestors are cheap.
  const bgCache = new Map<Element, string | null>();
  const effectiveBg = (el: Element): string | null => {
    let node: Element | null = el;
    const chain: Element[] = [];
    let found: string | null = null;
    for (let depth = 0; node && depth < 16; depth++, node = node.parentElement) {
      const cached = bgCache.get(node);
      if (cached !== undefined) {
        found = cached;
        break;
      }
      chain.push(node);
      const c = normalizeColor(getComputedStyle(node).backgroundColor);
      if (c && c.length === 7) {
        // Only opaque backgrounds count as "the" background — a translucent
        // overlay's real color depends on what's beneath it.
        found = c;
        break;
      }
    }
    for (const n of chain) bgCache.set(n, found);
    return found;
  };

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let sampled = 0;
  let visited = 0;

  for (let node = walker.nextNode(); node && sampled < MAX_ELEMENTS && visited < 6000; node = walker.nextNode()) {
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

    // Typography + text color + contrast pair — only where text actually is.
    if (hasOwnText(el)) {
      const family = primaryFamily(cs.fontFamily);
      const size = Math.round(parseFloat(cs.fontSize) * 10) / 10;
      const weight = Math.round(parseFloat(cs.fontWeight)) || 400;
      if (family && size > 0) {
        const key = `${family}|${size}|${weight}`;
        let acc = fonts.get(key);
        if (!acc) fonts.set(key, (acc = { count: 0, sample: "", tags: new Set() }));
        acc.count++;
        if (acc.tags.size < 4) acc.tags.add(el.tagName.toLowerCase());
        if (!acc.sample || (acc.sample.length < 12 && ownText(el).length > acc.sample.length)) {
          acc.sample = ownText(el);
        }
      }

      const fg = normalizeColor(cs.color);
      if (fg) {
        text.add(fg.slice(0, 7));
        const behind = effectiveBg(el);
        if (behind && fg.length === 7 && fg !== behind) {
          const pkey = `${fg}|${behind}`;
          const bold = weight >= 700;
          const p = pairs.get(pkey);
          if (!p) pairs.set(pkey, { count: 1, minSize: size, boldAtMin: bold });
          else {
            p.count++;
            if (size < p.minSize) {
              p.minSize = size;
              p.boldAtMin = bold;
            }
          }
        }
      }
    }

    if (ownBg) bg.add(ownBg);
    if (hasBorder) {
      const bc = normalizeColor(cs.borderTopColor);
      if (bc) border.add(bc);
    }

    // Radius is only a design token where you can see it.
    if (boxy) {
      const rtl = cs.borderTopLeftRadius;
      if (rtl && rtl !== "0px") {
        const corners = [rtl, cs.borderTopRightRadius, cs.borderBottomLeftRadius, cs.borderBottomRightRadius];
        const uniform = corners.every((c) => c === rtl);
        const px = parseFloat(rtl);
        // Anything at or beyond half the box reads as "fully rounded" — pills
        // and circles — whatever literal value produced it.
        const label =
          rtl.endsWith("%") && px >= 50
            ? "full"
            : px >= Math.min(rect.width, rect.height) / 2
              ? "full"
              : uniform
                ? `${Math.round(px)}px`
                : `${Math.round(px)}px (mixed)`;
        radii.add(label);
      }

      for (const side of [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft]) {
        const v = Math.round(parseFloat(side));
        if (v > 0) pad.add(String(v));
      }
    }
  }

  if (sampled === 0 || fonts.size === 0) return null;

  const fontTuples: DesignFontTuple[] = [...fonts.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, CAPS.fonts)
    .map(([key, acc]) => {
      const [family, size, weight] = key.split("|");
      return [family, Number(size), Number(weight), acc.count, acc.sample, [...acc.tags].join(",")];
    });

  const colorTuples = (t: Tally): DesignColorTuple[] => t.top(CAPS.colors);
  const pairTuples: DesignPairTuple[] = [...pairs.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, CAPS.pairs)
    .map(([key, p]) => {
      const [fg, behind] = key.split("|");
      return [fg, behind, p.count, p.minSize, p.boldAtMin ? 1 : 0];
    });
  const radiusTuples: DesignRadiusTuple[] = radii.top(CAPS.radii);
  const padTuples: DesignPadTuple[] = pad
    .top(CAPS.pad)
    .map(([px, count]): DesignPadTuple => [Number(px), count]);

  return {
    v: 1,
    el: sampled,
    fonts: fontTuples,
    text: colorTuples(text),
    bg: colorTuples(bg),
    border: colorTuples(border),
    pairs: pairTuples,
    radii: radiusTuples,
    pad: padTuples,
  };
}

/** Serialize, shrinking the longest lists if a pathological page overflows. */
export function serializeDesignScan(payload: PolishdDesignScanPayload): string {
  let out = JSON.stringify(payload);
  if (out.length <= MAX_PAYLOAD_CHARS) return out;
  const shrunk: PolishdDesignScanPayload = {
    ...payload,
    fonts: payload.fonts.slice(0, 30),
    text: payload.text.slice(0, 24),
    bg: payload.bg.slice(0, 24),
    border: payload.border.slice(0, 16),
    pairs: payload.pairs.slice(0, 30),
    radii: payload.radii.slice(0, 16),
    pad: payload.pad.slice(0, 24),
  };
  out = JSON.stringify(shrunk);
  return out.length <= MAX_PAYLOAD_CHARS ? out : "";
}

const SCANNED_PREFIX = "polishd_ds:";

/**
 * Scan `path` once per session, after the page settles, and hand the payload
 * to `emit`. Skips silently when the tab is hidden at fire time (layout of a
 * backgrounded prerender isn't the design anyone sees) — a later visit to the
 * same path in this session will still be un-scanned and retry.
 */
export function scheduleDesignScan(
  path: string,
  emit: (payloadJson: string, elements: number) => void,
  delayMs = 1500,
): void {
  let done = false;
  try {
    if (sessionStorage.getItem(SCANNED_PREFIX + path)) return;
  } catch {
    /* storage blocked — scan anyway, worst case is a duplicate tally */
  }

  const run = () => {
    if (done) return;
    done = true;
    // The page navigated on while we waited — that path's own scan will fire.
    if (location.pathname !== path) return;
    if (document.visibilityState === "hidden") return;
    // The dashboard styles itself; measuring it would report Polishd's design
    // as the site's. The path check upstream normally catches this, but it
    // only knows the configured route — this recognizes the dashboard by its
    // own scope root, so a dashboard mounted anywhere is never scanned.
    if (document.querySelector(".polishd-root")) return;
    try {
      const payload = collectDesignScan();
      if (!payload) return;
      const json = serializeDesignScan(payload);
      if (!json) return;
      try {
        sessionStorage.setItem(SCANNED_PREFIX + path, "1");
      } catch {
        /* fine */
      }
      emit(json, payload.el);
    } catch {
      // A scan must never break the host page.
    }
  };

  const idle = () => {
    if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 2000 });
    else setTimeout(run, 250);
  };

  if (document.readyState === "complete") setTimeout(idle, delayMs);
  else {
    addEventListener("load", () => setTimeout(idle, delayMs), { once: true });
    // Soft navigations never fire `load` again — fall back to a plain delay.
    setTimeout(idle, delayMs + 2500);
  }
}
