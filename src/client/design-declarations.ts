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
 * value (`text-[#555]`, `p-[13px]`) rather than drawn from the theme. The
 * scan measures rendered state, so an arbitrary class counts only when it is
 * what renders: `hover:text-[#fff]` never does at rest, and `sm:p-[13px]`
 * does only when the element really renders 13px. Inline `style=""` values
 * don't count: at runtime `style={{ color: theme.fg }}` and
 * `style={{ color: "#555" }}` are the same literal, so the DOM can't tell a
 * token from a hand-typed value there the way a class name can.
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

/** One arbitrary-value utility, as written. */
export interface ArbitraryValue {
  /** The bracketed literal: `#555`, `13px`, `clamp(1rem,2vw,2rem)`. */
  literal: string;
  /** Behind a breakpoint, theme or media variant (`sm:`, `dark:`), so it may not be what renders. */
  variant: boolean;
}

export interface ClassReading {
  /** Carries at least one Tailwind-shaped utility. */
  tailwind: boolean;
  /** Arbitrary values per property, from utilities that can apply at rest. */
  arbitrary: Map<ArbitraryProp, ArbitraryValue[]>;
}

/**
 * Variants that can apply to the state the scan sees — breakpoints, theme,
 * media and container queries. Interaction and state variants (`hover:`,
 * `focus:`, `group-open:`, `aria-*:`, `data-*:`) describe a state the page
 * isn't in when it's measured at rest, so their arbitrary values never count.
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
  // A value built on a token — `var(--x)`, `hsl(var(--card))`,
  // `calc(var(--radius)-4px)`, `calc(2rem-var(--gutter))`, `theme(spacing.4)`
  // — draws on the theme; that's the opposite of hand-typed, wherever in the
  // value the call sits and whatever operator precedes it. Only a longer
  // identifier (`myvar(`) isn't the call.
  if (/(?:^|[^a-z0-9_])(?:var|theme)\(/i.test(value) || value.startsWith("--")) return [];
  if (name === "text") {
    if (COLOR_VALUE.test(value)) return ["color"];
    return LENGTH_VALUE.test(value) ? ["fontSize"] : [];
  }
  if (name === "bg") return COLOR_VALUE.test(value) ? ["background"] : [];
  if (/^border(?:-[xytrblse])?$/.test(name)) return COLOR_VALUE.test(value) ? ["border"] : [];
  if (/^rounded(?:-(?:[trbl]|[se]|tl|tr|br|bl|ss|se|es|ee))?$/.test(name)) return ["radius"];
  return PAD_SIDES[name] ?? [];
}

/** Read a class string for Tailwind evidence and arbitrary values. */
export function readClassString(cls: string): ClassReading {
  const reading: ClassReading = { tailwind: false, arbitrary: new Map() };
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
    // `bg-[#111]/80` carries an opacity modifier after the bracket.
    const m = utility.match(/^([a-z][a-z0-9-]*?)-\[(.+)\](?:\/[\w.%[\]]+)?$/);
    if (!m) continue;
    for (const prop of arbitraryProps(m[1], m[2])) {
      const list = reading.arbitrary.get(prop) ?? [];
      list.push({ literal: m[2], variant: variants.length > 0 });
      reading.arbitrary.set(prop, list);
    }
  }
  return reading;
}

/**
 * The reading for an element: its class attribute and nothing else. Inline
 * `style` is deliberately never read (see the header) — a literal there may
 * just as well have come from a theme object. `cache` holds readings per
 * normalized class string, so a class repeated down a table is parsed once.
 */
export function readElementClasses(el: ElementLike, cache?: Map<string, ClassReading>): ClassReading | null {
  const cls = normalizedClass(el);
  if (!cls) return null;
  let reading = cache?.get(cls);
  if (!reading) {
    reading = readClassString(cls);
    cache?.set(cls, reading);
  }
  return reading;
}

const COLOR_PROPS = new Set<ArbitraryProp>(["color", "background", "border"]);

/** A hex literal as the scan normalizes colors (`#555` → `#555555`), rgb part only. */
function literalHex(literal: string): string | null {
  const m = literal.replace(/^color:/i, "").match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (!m) return null;
  const h = m[1].toLowerCase();
  const full = h.length <= 4 ? [...h].map((c) => c + c).join("") : h;
  return `#${full.slice(0, 6)}`;
}

/** A px or rem literal in pixels, or null for anything relative or computed. */
function literalPx(literal: string, remPx: number): number | null {
  const m = literal.replace(/^length:/i, "").match(/^(-?\d*\.?\d+)(px|rem)?$/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return m[2]?.toLowerCase() === "rem" ? n * remPx : n;
}

/**
 * Whether an arbitrary value is the one rendering: true or false when its
 * literal can be compared with what was measured, null when it can't
 * (`rgb(…)`, `clamp(…)`, `50%`).
 */
function rendersAs(literal: string, prop: ArbitraryProp, rendered: string | number, remPx: number): boolean | null {
  if (COLOR_PROPS.has(prop)) {
    const hex = literalHex(literal);
    return hex === null || typeof rendered !== "string" ? null : hex === rendered.slice(0, 7).toLowerCase();
  }
  const px = literalPx(literal, remPx);
  return px === null || typeof rendered !== "number" ? null : Math.abs(px - rendered) < 0.5;
}

/**
 * Whether a declaration hand-typed the value it rendered for `prop`: one of
 * its arbitrary values is what's showing. A literal that matches counts,
 * variant or not; one that doesn't match is a different state's value. One
 * that can't be compared counts only unprefixed — then nothing else applies.
 */
export function isHandTyped(
  reading: ClassReading | null,
  prop: ArbitraryProp,
  rendered: string | number,
  remPx = 16,
): boolean {
  const values = reading?.arbitrary.get(prop);
  if (!values) return false;
  return values.some((v) => {
    const match = rendersAs(v.literal, prop, rendered, remPx);
    return match === true || (match === null && !v.variant);
  });
}

// ── Transient states ─────────────────────────────────────────────────────────

/**
 * A coarse net for loading states anywhere on the page — candidates only;
 * `loadingReason` decides which really are.
 */
export const TRANSIENT_SELECTOR = '[aria-busy="true"], [class*="animate-pulse"], [class*="skeleton" i]';

export type TransientReason = "busy" | "skeleton" | "unrendered" | "invisible";

/**
 * A skeleton's class name: `skeleton` itself, or as a whole segment at
 * either end — `skeleton-line`, `react-loading-skeleton`, a component's
 * `MuiSkeleton-root` or `Skeleton_root__x1`. Not any token that happens to
 * contain the word (`no-skeleton-here`).
 */
function isSkeletonClass(utility: string): boolean {
  return (
    /^skeleton(?:[-_]|$)/i.test(utility) ||
    /[-_]skeleton$/i.test(utility) ||
    /^(?:[A-Z][a-z0-9]*)+Skeleton(?:[-_]|$)/.test(utility)
  );
}

/**
 * Whether an element is a loading state at rest: busy, a skeleton class, or
 * pulsing. Bare `animate-pulse` always pulses. Behind a variant that can
 * hold at rest (`motion-safe:`, a breakpoint, `dark:`, `print:`) it counts
 * only when the computed `animationName` confirms the pulse is running here
 * — `print:animate-pulse` doesn't on screen. Behind `hover:` or
 * `group-hover:` it never counts: nothing pulses until someone points at it.
 */
export function loadingReason(el: ElementLike, animationName?: string): "busy" | "skeleton" | null {
  if (el.getAttribute("aria-busy") === "true") return "busy";
  const cls = el.getAttribute("class");
  if (!cls) return null;
  for (const token of cls.split(/\s+/)) {
    if (!token) continue;
    const parts = splitVariants(token);
    const utility = parts[parts.length - 1].replace(/^!|!$/g, "");
    const variants = parts.slice(0, -1);
    if (!variants.every((v) => STANDING_VARIANT.test(v))) continue;
    if (isSkeletonClass(utility)) return "skeleton";
    if (utility !== "animate-pulse") continue;
    if (variants.length === 0 || /\bpulse\b/.test(animationName ?? "")) return "skeleton";
  }
  return null;
}

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
  style: { display: string; opacity: string; position: string; animationName?: string },
): TransientReason | null {
  const loading = loadingReason(el, style.animationName);
  if (loading) return loading;
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
