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
 *
 * Each value is tallied twice over: the elements rendering it (uses), and the
 * declarations behind them (design-declarations.ts) — so a badge repeated
 * down a table reads as one decision. Backgrounds painted on controls are
 * tallied once more on their own: that is where a site shows its action
 * color, which the dashboard's brand board leads with. Loading skeletons, busy regions and
 * closed overlays are left out: they are states the page passes through,
 * not its design.
 */
import type {
  DesignColorTuple,
  DesignDeclTail,
  DesignFontTuple,
  DesignPadTuple,
  DesignPairTuple,
  DesignRadiusTuple,
  PolishdDesignScanPayload,
} from "../shared/types";
import {
  declarationId,
  declarationSignature,
  inheritedDeclarer,
  isHandTyped,
  loadingReason,
  readElementClasses,
  TRANSIENT_SELECTOR,
  transientReason,
  type ArbitraryProp,
  type ClassReading,
  type ElementLike,
} from "./design-declarations";
import { serializeDesignScan } from "./design-payload";

export { serializeDesignScan };

/** Hard bound on elements measured, so a huge DOM can't stall the main thread. */
const MAX_ELEMENTS = 1500;
/** Per-list caps applied before serializing — one page stays a few KB. */
const CAPS = { fonts: 60, colors: 48, controls: 12, pairs: 60, radii: 24, pad: 40 };
/** Declaration ids sent per value — enough to dedupe the rare ones across pages. */
const DECL_IDS = 5;

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

const SVG_NS = "http://www.w3.org/2000/svg";

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

/** Declaration id → whether that declaration hand-typed the value. */
type Decls = Map<string, boolean>;

function addDecl(decls: Decls, id: string, handTyped: boolean) {
  decls.set(id, handTyped || decls.get(id) === true);
}

function declTail(decls: Decls): DesignDeclTail {
  let hand = 0;
  const ids: string[] = [];
  for (const [id, h] of decls) {
    if (h) hand++;
    if (ids.length < DECL_IDS) ids.push(h ? `!${id}` : id);
  }
  return [decls.size, hand, ids.join(" ")];
}

interface FontAcc {
  count: number;
  sample: string;
  tags: Set<string>;
  decls: Decls;
}

class Tally {
  map = new Map<string, { count: number; decls: Decls }>();
  add(key: string, decl: string, handTyped: boolean) {
    let v = this.map.get(key);
    if (!v) this.map.set(key, (v = { count: 0, decls: new Map() }));
    v.count++;
    addDecl(v.decls, decl, handTyped);
  }
  top(cap: number): [string, number, ...DesignDeclTail][] {
    return [...this.map.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, cap)
      .map(([key, v]) => [key, v.count, ...declTail(v.decls)]);
  }
}

/** The padding side each computed value belongs to, in the order they're read. */
const PAD_SIDES: ArbitraryProp[] = ["padTop", "padRight", "padBottom", "padLeft"];

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
  const controls = new Tally();
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

  // Declarations: who decided each value, and whether they hand-typed it.
  const signatures = new Map<ElementLike, string>();
  const declOf = (el: ElementLike): string => {
    let id = signatures.get(el);
    if (id === undefined) signatures.set(el, (id = declarationId(declarationSignature(el))));
    return id;
  };
  // Class strings seen, and whether each reads as Tailwind — the reading is
  // per string, so a class repeated down a table is parsed once.
  const readings = new Map<string, ClassReading>();
  const readingOf = (el: ElementLike) => readElementClasses(el, readings);
  // Whether `el` hand-typed the value it renders — only an arbitrary class
  // whose literal is what's showing counts, so `sm:p-[13px]` below `sm` doesn't.
  const remPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const handTyped = (el: ElementLike, prop: ArbitraryProp, rendered: string | number) =>
    isHandTyped(readingOf(el), prop, rendered, remPx);
  // Inherited values are declared where the run of equal values starts.
  const styleOf = (el: ElementLike) => getComputedStyle(el as Element);
  const fontKeyOf = (el: ElementLike) => {
    const cs = styleOf(el);
    return `${primaryFamily(cs.fontFamily)}|${cs.fontSize}|${cs.fontWeight}`;
  };
  const fontSizeOf = (el: ElementLike) => styleOf(el).fontSize;
  const colorOf = (el: ElementLike) => styleOf(el).color;
  const fontDeclarers = new Map<ElementLike, ElementLike>();
  const sizeDeclarers = new Map<ElementLike, ElementLike>();
  const colorDeclarers = new Map<ElementLike, ElementLike>();

  // Subtrees with no design signal are rejected whole — tags that never
  // render, an icon's SVG internals, transient states — so their children
  // never reach the tallies or the walk's budget. The cheap checks run first;
  // only what survives them pays for a computed style.
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (node) => {
      const el = node as Element;
      if (SKIP_TAGS.has(el.tagName)) return NodeFilter.FILTER_REJECT;
      if (el.namespaceURI === SVG_NS && el.localName !== "svg") return NodeFilter.FILTER_REJECT;
      return transientReason(el, getComputedStyle(el)) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  let sampled = 0;
  let visited = 0;

  for (let node = walker.nextNode(); node && sampled < MAX_ELEMENTS && visited < 6000; node = walker.nextNode()) {
    visited++;
    const el = node as Element;

    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    sampled++;
    readingOf(el);

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
        if (!acc) fonts.set(key, (acc = { count: 0, sample: "", tags: new Set(), decls: new Map() }));
        acc.count++;
        if (acc.tags.size < 4) acc.tags.add(el.tagName.toLowerCase());
        if (!acc.sample || (acc.sample.length < 12 && ownText(el).length > acc.sample.length)) {
          acc.sample = ownText(el);
        }
        addDecl(
          acc.decls,
          declOf(inheritedDeclarer(el, fontKeyOf, fontDeclarers)),
          handTyped(inheritedDeclarer(el, fontSizeOf, sizeDeclarers), "fontSize", parseFloat(cs.fontSize)),
        );
      }

      const fg = normalizeColor(cs.color);
      if (fg) {
        const declarer = inheritedDeclarer(el, colorOf, colorDeclarers);
        text.add(fg.slice(0, 7), declOf(declarer), handTyped(declarer, "color", fg));
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

    if (ownBg) {
      bg.add(ownBg, declOf(el), handTyped(el, "background", ownBg));
      // A painted control — a button, a link styled as one, an input — is
      // where a site shows its action color.
      if (INTERACTIVE_TAGS.has(el.tagName) || el.getAttribute("role") === "button") {
        controls.add(ownBg, declOf(el), handTyped(el, "background", ownBg));
      }
    }
    if (hasBorder) {
      const bc = normalizeColor(cs.borderTopColor);
      if (bc) border.add(bc, declOf(el), handTyped(el, "border", bc));
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
        radii.add(label, declOf(el), handTyped(el, "radius", rtl.endsWith("%") ? rtl : px));
      }

      [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].forEach((side, i) => {
        const v = Math.round(parseFloat(side));
        if (v > 0) pad.add(String(v), declOf(el), handTyped(el, PAD_SIDES[i], parseFloat(side)));
      });
    }
  }

  if (sampled === 0 || fonts.size === 0) return null;

  const fontTuples: DesignFontTuple[] = [...fonts.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, CAPS.fonts)
    .map(([key, acc]) => {
      const [family, size, weight] = key.split("|");
      return [
        family,
        Number(size),
        Number(weight),
        acc.count,
        acc.sample,
        [...acc.tags].join(","),
        ...declTail(acc.decls),
      ];
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
    .map(([px, ...rest]): DesignPadTuple => [Number(px), ...rest]);

  let tailwind = 0;
  for (const r of readings.values()) if (r.tailwind) tailwind++;

  return {
    v: 1,
    el: sampled,
    fonts: fontTuples,
    text: colorTuples(text),
    bg: colorTuples(bg),
    border: colorTuples(border),
    ctl: controls.top(CAPS.controls),
    pairs: pairTuples,
    radii: radiusTuples,
    pad: padTuples,
    tw: [tailwind, readings.size],
    rem: Math.round(remPx * 10) / 10,
  };
}

const SCANNED_PREFIX = "polishd_ds:";
/** Waits for visible loading states to clear before scanning around them. */
const TRANSIENT_WAITS = 3;
const TRANSIENT_WAIT_MS = 1500;

/** Whether a skeleton or busy region is on screen right now. */
function loadingVisible(): boolean {
  try {
    for (const el of document.querySelectorAll(TRANSIENT_SELECTOR)) {
      if (loadingReason(el, getComputedStyle(el).animationName) && el.getClientRects().length > 0) return true;
    }
  } catch {
    /* a selector this browser can't parse — scan without waiting */
  }
  return false;
}

export interface DesignScanOptions {
  delayMs?: number;
  /**
   * The build the page was served from. Part of the once-per-session key, so
   * a page revisited after a deploy is scanned again: its design may have
   * changed, and the Design tab wants the newest build's picture of it.
   */
  build?: string | null;
  /**
   * Scan a path once per session (the default). False scans on every call —
   * development, where the page's design changes between reloads.
   */
  once?: boolean;
  /**
   * Replaces the default `location.pathname === path` staleness check — for
   * callers whose `path` is a namespaced label rather than a URL (the
   * dashboard telemetry emitter labels its scans `/~polishd/<tab>`). Return
   * false to drop a scan whose moment has passed.
   */
  stillCurrent?: () => boolean;
  /**
   * Scan even though the page is the dashboard. Only the telemetry emitter
   * passes this: measuring the dashboard *is* its job, whereas for a host
   * site's capture the dashboard must never count as the site's design.
   */
  scanDashboard?: boolean;
}

/**
 * Scan `path` once per session (and per build), after the page settles, and
 * hand the payload to `emit`. Skips silently when the tab is hidden at fire
 * time (layout of a backgrounded prerender isn't the design anyone sees) — a
 * later visit to the same path in this session will still be un-scanned and
 * retry. While a Suspense skeleton or busy region is still on screen it waits
 * a few beats for the real content, then scans around whatever is still
 * loading.
 */
export function scheduleDesignScan(
  path: string,
  emit: (payloadJson: string, elements: number) => void,
  options: number | DesignScanOptions = 1500,
): void {
  // The third argument was a bare delayMs before options existed.
  const opts: DesignScanOptions = typeof options === "number" ? { delayMs: options } : options;
  const delayMs = opts.delayMs ?? 1500;
  const once = opts.once !== false;
  // Keyed by build as well as path, so a new deploy's pages scan afresh.
  // Scans from before builds were tracked used the bare path; a key with an
  // empty build segment is distinct from that, which only costs one extra
  // scan per path on the first session after upgrading.
  const scannedKey = `${SCANNED_PREFIX}${opts.build ?? ""}:${path}`;

  let done = false;
  let waits = 0;
  let waiting = false;
  if (once) {
    try {
      if (sessionStorage.getItem(scannedKey)) return;
    } catch {
      /* storage blocked — scan anyway, worst case is a duplicate tally */
    }
  }

  const run = () => {
    if (done || waiting) return;
    // The page navigated on while we waited — that path's own scan will fire.
    if (opts.stillCurrent ? !opts.stillCurrent() : location.pathname !== path) {
      done = true;
      return;
    }
    if (waits < TRANSIENT_WAITS && loadingVisible()) {
      waits++;
      waiting = true;
      setTimeout(() => {
        waiting = false;
        idle();
      }, TRANSIENT_WAIT_MS);
      return;
    }
    done = true;
    if (document.visibilityState === "hidden") return;
    // The dashboard styles itself; measuring it would report Polishd's design
    // as the site's. The path check upstream normally catches this, but it
    // only knows the configured route — this recognizes the dashboard by its
    // own scope root, so a dashboard mounted anywhere is never scanned.
    // (Unless the caller is the telemetry emitter, whose target it is.)
    if (!opts.scanDashboard && document.querySelector(".polishd-root")) return;
    try {
      const payload = collectDesignScan();
      if (!payload) return;
      const json = serializeDesignScan(payload);
      if (!json) return;
      if (once) {
        try {
          sessionStorage.setItem(scannedKey, "1");
        } catch {
          /* fine */
        }
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
