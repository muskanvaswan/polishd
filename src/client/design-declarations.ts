/**
 * Polishd — telling design decisions apart from their copies.
 *
 * The design scan measures rendered elements, but a design review is about
 * decisions. A badge class rendered on each of a table's 38 rows is one
 * decision, not 38; a button-class constant every page shares is one
 * decision. So the scan attributes each measured value to a *declaration*:
 * the class string of the element that set it — or, for an element with no
 * class, its tag path up from the nearest classed ancestor. For the inherited
 * properties (font, text color) that element is not the one carrying the
 * text but the outermost ancestor in the unbroken run rendering the same
 * value: a `<span>` inside `.text-[#555]` inherits that decision rather than
 * making its own.
 *
 * Reading the same class names answers two more questions: whether the site
 * is styled with Tailwind, whose spacing scale has deliberate half steps
 * (2px, 6px, 10px, 14px), and whether a value was hand-typed as an arbitrary
 * value (`text-[#555]`, `p-[13px]`) rather than drawn from the theme.
 *
 * And it decides which subtrees are transient — a loading skeleton, a busy
 * region, an unrendered branch, a closed overlay at opacity 0 — whose colors
 * and sizes are not the design anyone sees once the page has loaded.
 *
 * Pure over a minimal element shape, so the test file needs no DOM.
 */

/** Just what these helpers read off an Element. */
export interface ElementLike {
  tagName: string;
  parentElement: ElementLike | null;
  getAttribute(name: string): string | null;
}

// ── Declarations ─────────────────────────────────────────────────────────────

/** Tokens deduped and sorted, so the order a `cn()` call emits never splits a declaration. */
export function normalizedClass(el: ElementLike): string {
  const raw = el.getAttribute("class");
  if (!raw) return "";
  const tokens = raw.split(/\s+/).filter(Boolean);
  return [...new Set(tokens)].sort().join(" ");
}

/** Hops an unclassed element's path climbs looking for a classed ancestor. */
const STRUCTURAL_DEPTH = 3;

/**
 * A declaration's identity. A classed element is its class string; an
 * unclassed one is its tag path from the nearest classed ancestor within a
 * few hops (`.prose>ul>li`), which is where a tag selector or an inherited
 * style was decided.
 */
export function declarationSignature(el: ElementLike): string {
  const own = normalizedClass(el);
  if (own) return `.${own}`;
  const parts = [el.tagName.toLowerCase()];
  let p = el.parentElement;
  for (let hop = 0; p && hop < STRUCTURAL_DEPTH; hop++, p = p.parentElement) {
    const cls = normalizedClass(p);
    if (cls) {
      parts.unshift(`.${cls}`);
      break;
    }
    parts.unshift(p.tagName.toLowerCase());
  }
  return parts.join(">");
}

/**
 * A short stable id for a signature (FNV-1a, base 36). Declarations cross
 * the wire as ids, so the same class on two pages counts once site-wide.
 */
export function declarationId(signature: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < signature.length; i++) {
    h ^= signature.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * The element that declared an inherited value `el` renders: the outermost
 * ancestor in the unbroken run rendering the same value. `memo` caches the
 * answer per element for one property, so siblings share one walk.
 */
export function inheritedDeclarer(
  el: ElementLike,
  valueOf: (e: ElementLike) => string,
  memo: Map<ElementLike, ElementLike>,
  maxDepth = 32,
): ElementLike {
  const cached = memo.get(el);
  if (cached) return cached;
  const value = valueOf(el);
  const run: ElementLike[] = [el];
  let top = el;
  for (let p = el.parentElement, d = 0; p && d < maxDepth; p = p.parentElement, d++) {
    if (valueOf(p) !== value) break;
    const known = memo.get(p);
    if (known) {
      top = known;
      break;
    }
    top = p;
    run.push(p);
  }
  for (const n of run) memo.set(n, top);
  return top;
}

// ── Tailwind ─────────────────────────────────────────────────────────────────

/** A property a class string can hand-type as an arbitrary value. */
export type ArbitraryProp =
  | "color"
  | "background"
  | "border"
  | "fontSize"
  | "radius"
  | "padTop"
  | "padRight"
  | "padBottom"
  | "padLeft";

export interface ClassReading {
  /** Carries at least one Tailwind-shaped utility. */
  tailwind: boolean;
  /** Properties an applicable arbitrary-value utility sets. */
  arbitrary: Set<ArbitraryProp>;
}

/**
 * Variants that still apply to the state the scan sees — breakpoints, theme,
 * media and container queries. A `hover:` or `group-open:` arbitrary value
 * isn't what's rendering, so it isn't what was measured.
 */
const STANDING_VARIANT =
  /^(?:sm|md|lg|xl|2xl|max-[\w[\]-]+|min-[\w[\]-]+|dark|light|print|portrait|landscape|motion-safe|motion-reduce|contrast-more|contrast-less|ltr|rtl|supports-[\w[\]()-]+|@[\w[\]-]*)$/;

/** Variants that only Tailwind (or its look-alikes) writes — evidence on their own. */
const TAILWIND_VARIANT =
  /^(?:sm|md|lg|xl|2xl|hover|focus|focus-visible|focus-within|active|disabled|dark|group-[\w[\].-]+|peer-[\w[\].-]+|aria-[\w[\]=-]+|data-[\w[\]=-]+|first|last|odd|even|placeholder|motion-safe|motion-reduce|max-[\w[\]-]+|min-[\w[\]-]+)$/;

const PALETTE =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";

/** Utilities shaped the way Tailwind names them. */
const TAILWIND_UTILITY = new RegExp(
  "^(?:" +
    [
      "[a-z][a-z0-9-]*-\\[.+\\]",
      `(?:text|bg|border|ring|fill|stroke|from|via|to|divide|outline|decoration|accent|caret|placeholder)-(?:${PALETTE})-\\d{2,3}(?:\\/\\d+)?`,
      "text-(?:xs|sm|base|lg|[2-9]?xl)",
      "font-(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black)",
      "items-(?:start|end|center|baseline|stretch)",
      "justify-(?:start|end|center|between|around|evenly)",
      "rounded(?:-[trblse]{1,2})?(?:-(?:none|xs|sm|md|lg|xl|2xl|3xl|full))?",
      "[pm][xytrblse]?-(?:\\d+(?:\\.5)?|px)",
      "(?:gap|space)-(?:[xy]-)?(?:\\d+(?:\\.5)?|px)",
      "(?:w|h|size)-(?:\\d+(?:\\.5)?|px|full|screen|auto|fit|min|max)",
      "(?:tracking|leading)-[\\w.]+",
    ].join("|") +
    ")$",
);

/** Split a token at its top-level colons: `md:hover:bg-[url(a:b)]` → variants + utility. */
function splitVariants(token: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < token.length; i++) {
    const ch = token[i];
    if (ch === "[" || ch === "(") depth++;
    else if (ch === "]" || ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === ":" && depth === 0) {
      parts.push(token.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(token.slice(start));
  return parts;
}

/** An arbitrary value that is a literal color, not a reference to a token. */
const COLOR_VALUE = /^(?:color:)?(?:#[0-9a-f]{3,8}|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\()/i;
/** A literal length (or a fluid formula of them), not a reference to a token. */
const LENGTH_VALUE = /^(?:length:)?(?:-?\d*\.?\d+(?:px|rem|em|pt|vw|vh|vmin|vmax|dvh|svh|lvh|ch|ex|%)?|(?:clamp|calc|min|max)\()/i;

const PAD_SIDES: Record<string, ArbitraryProp[]> = {
  p: ["padTop", "padRight", "padBottom", "padLeft"],
  px: ["padRight", "padLeft"],
  py: ["padTop", "padBottom"],
  pt: ["padTop"],
  pr: ["padRight"],
  pb: ["padBottom"],
  pl: ["padLeft"],
  ps: ["padLeft"],
  pe: ["padRight"],
};

/** What one arbitrary-value utility (`name-[value]`) hand-types. */
function arbitraryProps(name: string, value: string): ArbitraryProp[] {
  // A `var(--…)` or theme() reference draws on a token; that's the opposite of hand-typed.
  if (/^(?:[\w-]+:)?(?:var|theme)\(/i.test(value) || value.startsWith("--")) return [];
  if (name === "text") {
    if (COLOR_VALUE.test(value)) return ["color"];
    return LENGTH_VALUE.test(value) ? ["fontSize"] : [];
  }
  if (name === "bg") return COLOR_VALUE.test(value) ? ["background"] : [];
  if (/^border(?:-[xytrblse])?$/.test(name)) return COLOR_VALUE.test(value) ? ["border"] : [];
  if (/^rounded(?:-(?:[trbl]|[se]|tl|tr|br|bl|ss|se|es|ee))?$/.test(name)) return ["radius"];
  return PAD_SIDES[name] ?? [];
}

/** Read a class string for Tailwind evidence and hand-typed values. */
export function readClassString(cls: string): ClassReading {
  const reading: ClassReading = { tailwind: false, arbitrary: new Set() };
  for (const token of cls.split(/\s+/)) {
    if (!token) continue;
    const parts = splitVariants(token);
    const variants = parts.slice(0, -1);
    const utility = parts[parts.length - 1].replace(/^!|!$/g, "").replace(/^-/, "");
    if (
      !reading.tailwind &&
      (TAILWIND_UTILITY.test(utility) || variants.some((v) => TAILWIND_VARIANT.test(v)))
    ) {
      reading.tailwind = true;
    }
    if (!variants.every((v) => STANDING_VARIANT.test(v))) continue;
    const m = utility.match(/^([a-z][a-z0-9-]*?)-\[(.+)\]$/);
    if (!m) continue;
    for (const prop of arbitraryProps(m[1], m[2])) reading.arbitrary.add(prop);
  }
  return reading;
}

// ── Transient states ─────────────────────────────────────────────────────────

/**
 * Loading states visible anywhere on the page, for the scheduler to wait
 * out. Matches `motion-safe:animate-pulse` as well as the bare utility.
 */
export const TRANSIENT_SELECTOR = '[aria-busy="true"], [class*="animate-pulse"], [class*="skeleton" i]';

export type TransientReason = "busy" | "skeleton" | "unrendered" | "invisible";

/**
 * Why a subtree isn't part of the design right now, or null when it is.
 * Busy regions and skeletons are loading states; `display: none` renders
 * nothing beneath it; an overlay at opacity 0 that the page marks hidden
 * (aria-hidden, inert) or pins in place is a closed backdrop or menu.
 * Opacity 0 alone isn't enough — scroll-reveal sections wait at 0 and are
 * very much the design. The capture-time marker in capture/core.ts repeats
 * these rules inline (it runs in the page, so it can't import them).
 */
export function transientReason(
  el: ElementLike,
  style: { display: string; opacity: string; position: string },
): TransientReason | null {
  if (el.getAttribute("aria-busy") === "true") return "busy";
  const cls = el.getAttribute("class");
  if (cls) {
    for (const token of cls.split(/\s+/)) {
      if (/(?:^|:)animate-pulse$/.test(token) || /skeleton/i.test(token)) return "skeleton";
    }
  }
  if (style.display === "none") return "unrendered";
  if (
    parseFloat(style.opacity) <= 0.01 &&
    (el.getAttribute("aria-hidden") === "true" ||
      el.getAttribute("inert") !== null ||
      style.position === "fixed")
  ) {
    return "invisible";
  }
  return null;
}
