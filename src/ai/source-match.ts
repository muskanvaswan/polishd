/**
 * Polishd — match a loss's evidence to a source file (pure).
 *
 * A loss cites one identifier from the analytics: a page path, an element's
 * label or selector, a component name, an error message. Matching it to the
 * file that renders it is what lets the dashboard say "verified", so a wrong
 * match is worse than none — it sends whoever fixes the bug to the wrong file
 * with a green tick on it.
 *
 * The old matcher kept any token of four characters or more and returned the
 * first file containing any of them. Selectors are mostly Tailwind utilities
 * (`div.fixed`, `div.text-white`), so it "verified" a backdrop against
 * whichever file the walk reached first that said `fixed`. This one only
 * searches for things an author chose, each in the place it would be written:
 *
 *   - component: a `data-component` / `<PolishdMonitor name>` value — found
 *     where it's defined, not merely mentioned.
 *   - route: a page path, mapped onto `app/…/page.tsx` or `pages/…` by the
 *     file tree alone (route groups, slots and dynamic segments understood).
 *   - identifier: an element id or a custom class from a selector (inside a
 *     string literal), or a PascalCase/camelCase name (as a whole word).
 *   - label: visible text or an aria-label, matched as written in JSX or a
 *     string — with numbers allowed to be `{expressions}`, since "Show 9 more"
 *     is `Show {hidden.length} more` in the source.
 *
 * Utility classes, tag names and CSS fragments never become needles. And when
 * the evidence matches several files equally well, nothing is picked: the
 * files come back as candidates and the loss stays unverified.
 *
 * Pure, no I/O: the caller supplies the file list and a reader (disk or the
 * connected GitHub repo — see scan.ts).
 */

import type { FrictionIndex } from "../server/friction";
import type { PolishdDashboardData } from "../server/queries";
import type { PolishdProjectProfile } from "./types";

export type NeedleKind = "component" | "route" | "identifier" | "label";

export interface Needle {
  kind: NeedleKind;
  value: string;
  /**
   * For identifiers: `literal` ones (ids, classes) are matched inside a
   * string literal; `word` ones (PascalCase/camelCase names) anywhere as a
   * whole word.
   */
  form?: "literal" | "word";
  /**
   * Context, not identity: an id or class on an *ancestor* of the clicked
   * element (`div.app-shell>…>div.absolute`). It can narrow a match the
   * clicked element's own needles made, never make one — the page root's
   * class says nothing about which of its descendants was clicked.
   */
  narrowOnly?: boolean;
  /**
   * A name found *inside* a longer citation rather than the citation itself:
   * the known label "Export" in the citation "Export CSV". It is only
   * consulted when nothing the citation names outright matched, and then
   * yields candidates at most — a shorter name it happens to contain must
   * never verify the citation.
   */
  contained?: boolean;
}

/** Names the analytics (and the profile) already know, to recognize evidence by. */
export interface KnownNames {
  /** `data-component` / PolishdMonitor names. */
  components: string[];
  /** Visible labels of clicked elements (sample text). */
  labels: string[];
  /** Page paths seen in the data. */
  paths: string[];
}

/**
 * Everything the data and the profile name, for recognizing what a citation
 * refers to. Component names come from monitored components, clicked
 * components and the profile's scanned identifiers; labels from the clicked
 * elements' text.
 */
export function knownNames(
  data: Pick<PolishdDashboardData, "elements" | "monitored" | "topUsed" | "pages">,
  profile: Pick<PolishdProjectProfile, "coveredIdentifiers"> | null,
  friction?: Pick<FrictionIndex, "clicks" | "pages">,
): KnownNames {
  const components = new Set<string>(profile?.coveredIdentifiers ?? []);
  for (const m of data.monitored) components.add(m.name);
  for (const t of data.topUsed) if (t.isComponent) components.add(t.label);
  const labels = new Set<string>();
  for (const e of data.elements) if (e.sampleText?.trim()) labels.add(e.sampleText.trim());
  for (const c of friction?.clicks ?? []) {
    if (c.by === "component") components.add(c.key);
    if (c.text?.trim()) labels.add(c.text.trim());
  }
  const paths = new Set<string>(data.pages.map((p) => p.path));
  for (const p of friction?.pages ?? []) paths.add(p.path);
  return { components: [...components], labels: [...labels], paths: [...paths] };
}

export interface SourceMatch {
  /** The one file the evidence matched, when exactly one did. */
  location?: string;
  /** Several files matched equally well — none was picked. */
  candidates?: string[];
  /** The needle that decided the match. */
  needle?: Needle;
}

/** How many candidates an ambiguous match lists. */
export const MAX_CANDIDATES = 5;

// ── What is (not) a needle ───────────────────────────────────────────────────

const HTML_TAGS = new Set(
  (
    "a abbr address area article aside audio b bdi bdo blockquote body br button canvas caption " +
    "cite code col colgroup data datalist dd del details dfn dialog div dl dt em embed fieldset " +
    "figcaption figure footer form h1 h2 h3 h4 h5 h6 head header hgroup hr html i iframe img input " +
    "ins kbd label legend li link main map mark menu meta meter nav noscript object ol optgroup " +
    "option output p param picture pre progress q rp rt ruby s samp script search section select " +
    "slot small source span strong style sub summary sup svg table tbody td template textarea " +
    "tfoot th thead time title tr track u ul var video wbr path g circle rect line polyline " +
    "polygon use defs symbol mask"
  ).split(" "),
);

/** Bare utility classes (Tailwind and friends) and variant names. */
const UTILITY_WORDS = new Set(
  (
    "flex grid block inline inline-block inline-flex inline-grid hidden fixed absolute relative " +
    "sticky static contents container truncate underline overline line-through no-underline " +
    "italic not-italic uppercase lowercase capitalize normal-case rounded border shadow outline " +
    "ring transition transform grow shrink visible invisible collapse isolate antialiased " +
    "subpixel-antialiased sr-only not-sr-only prose group peer table flow-root list-item " +
    "dark light hover focus active disabled visited checked first last odd even group-hover " +
    "sm md lg xl 2xl print motion-safe motion-reduce rtl ltr placeholder file marker selection " +
    "backdrop before after open clearfix active show fade collapsed closed " +
    "tabular-nums lining-nums oldstyle-nums proportional-nums slashed-zero ordinal " +
    "diagonal-fractions stacked-fractions no-scrollbar scrollbar-hide scrollbar-none " +
    "animate-in animate-out focus-visible focus-within forced-colors " +
    // Bootstrap's component classes — framework names, not the author's
    "nav nav-link nav-item nav-tabs nav-pills nav-fill nav-justified card card-body " +
    "card-title card-text card-header card-footer card-img-top form-control form-group " +
    "form-label form-check form-select form-text modal modal-dialog modal-content " +
    "modal-header modal-body modal-footer modal-title modal-backdrop"
  ).split(" "),
);

/** Utility-class shapes: a known prefix and a dash, optionally negated or variant-prefixed. */
const UTILITY_PREFIX = new RegExp(
  "^-?(?:" +
    [
      // spacing & sizing
      "m[trblxyse]?", "p[trblxyse]?", "space-[xy]", "gap(?:-[xy])?", "w", "h", "min-w", "min-h",
      "max-w", "max-h", "size", "inset(?:-[xy])?", "top", "right", "bottom", "left", "start", "end",
      // layout
      "z", "order", "col(?:-span|-start|-end)?", "row(?:-span|-start|-end)?", "basis", "flex",
      "grid(?:-cols|-rows|-flow)?", "auto-cols", "auto-rows", "items", "justify(?:-items|-self)?",
      "content", "self", "place(?:-content|-items|-self)?", "overflow(?:-[xy])?",
      "overscroll(?:-[xy])?", "object", "float", "clear", "box", "columns", "aspect", "display",
      "visibility", "align",
      // typography & color
      "text", "font", "leading", "tracking", "line-clamp", "whitespace", "break", "indent",
      "decoration", "underline-offset", "list", "bg", "from", "via", "to", "fill", "stroke",
      "accent", "caret", "placeholder", "opacity",
      // borders & effects
      "border(?:-[trblxyse])?", "rounded(?:-[trblse]{1,2})?", "divide(?:-[xy])?", "outline",
      "ring(?:-offset)?", "shadow", "drop-shadow", "blur", "brightness", "contrast", "grayscale",
      "hue-rotate", "invert", "saturate", "sepia", "backdrop", "mix-blend", "bg-blend",
      // motion & interaction
      "transition", "duration", "ease", "delay", "animate", "scale(?:-[xy])?", "rotate",
      "translate-[xy]", "skew-[xy]", "origin", "cursor", "select", "pointer-events", "resize",
      "scroll(?:-[mp][trblxyse]?)?", "snap", "touch", "will-change", "appearance", "sr",
      // Bootstrap & co. — framework classes, not the author's names
      "d", "mx", "my", "px", "py", "fs", "fw", "lh", "btn", "navbar", "input-group", "badge",
      "alert", "dropdown", "offcanvas", "list-group", "table", "bg-gradient",
      // plugin utilities (variant prefixes cut off at their `:` are dropped by
      // context in selectorNeedles, not here — `data-table` is an author's name)
      "contrast", "prose", "fade-in", "fade-out", "zoom-in", "zoom-out", "slide-in", "slide-out",
      "spin-in", "spin-out", "scrollbar", "transform", "backface", "perspective",
      "line", "normal", "ordinal", "tabular", "forced-color", "print", "portrait", "landscape",
    ].join("|") +
    ")-",
);

/** Is this class name a styling utility rather than a name the author chose? */
export function isUtilityClass(token: string): boolean {
  // Variants (`hover:`, `peer-checked:`, `data-[state=open]:`), then `!important`.
  const t = token.replace(/^(?:[^:\s]+:)+/, "").replace(/^!/, "");
  if (!t) return true;
  if (UTILITY_WORDS.has(t)) return true;
  if (UTILITY_PREFIX.test(t)) return true;
  if (/^-?\d/.test(t) || /[[\]/:%]/.test(t)) return true; // numbers, arbitrary values, fractions
  return false;
}

/** Ids frameworks generate (`:r1:`, `radix-…`, `headlessui-…`) — never in source. */
function isGeneratedId(id: string): boolean {
  return (
    id.includes(":") ||
    /^(?:radix|headlessui|react-aria|mui|chakra|mantine|rc|downshift|floating-ui)[-_]/i.test(id) ||
    /^\d+$/.test(id)
  );
}

/**
 * A class or id an author chose, distinctive enough to search for: compound
 * (`nav-drawer`, `heroCta`) and not a utility or tag. A lone word — `drawer`,
 * `overlay` — is too likely to turn up in any string in any file.
 */
function isDistinctiveName(token: string): boolean {
  if (token.length < 4 || HTML_TAGS.has(token.toLowerCase())) return false;
  if (isUtilityClass(token)) return false;
  return /[a-z0-9][-_][a-z0-9]/i.test(token) || /[a-z][A-Z]/.test(token);
}

/** Names that look like code identifiers but are just words in a citation. */
const NOT_IDENTIFIERS = new Set([
  "JavaScript", "TypeScript", "GitHub", "NextJs", "YouTube", "LinkedIn", "PayPal", "WordPress",
  "TypeError", "ReferenceError", "SyntaxError", "RangeError", "EvalError", "URIError",
  "AggregateError", "ChunkLoadError", "AbortError", "NetworkError", "DOMException",
  "NotFoundError", "SecurityError", "QuotaExceededError", "TimeoutError", "ResizeObserver",
  "IntersectionObserver", "MutationObserver", "addEventListener", "querySelector",
  "getElementById", "setTimeout", "setInterval", "innerHTML", "onClick", "onChange",
  "onSubmit", "useState", "useEffect", "useRef", "useMemo", "useCallback",
]);

/** PascalCase with two humps or more, or camelCase — a code identifier. */
const CODE_IDENTIFIER = /^(?:[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+|[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+)$/;

const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[`"'“”‘’]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** Strip the quotes/backticks a model tends to wrap a citation in. */
function unwrap(evidence: string): string {
  return evidence
    .trim()
    .replace(/^[`"'“”‘’]+|[`"'“”‘’]+$/g, "")
    .trim();
}

/** A selector-looking evidence string: `tag.class`, `tag#id`, `a>b`. */
function looksLikeSelector(s: string): boolean {
  return /^[a-z][a-z0-9-]*(?:[.#][\w-]+|\[[^\]]*\])+(?:\s*>\s*|$)/i.test(s) || /\S>\S/.test(s);
}

/**
 * Needles from one selector path: a `[data-component="…"]` anchor, ids and
 * custom classes — never tags or utilities. A data-component anchor decides
 * wherever it sits (it's the component the source names, at most a few
 * levels up); otherwise only the clicked element's own step (the last) can
 * decide a match, and its ancestors' steps only narrow one.
 */
export function selectorNeedles(selector: string): Needle[] {
  const out: Needle[] = [];
  const segs = selector.split(">").map((s) => s.trim()).filter(Boolean);
  segs.forEach((seg, i) => {
    const narrowOnly = i < segs.length - 1 ? { narrowOnly: true } : {};
    for (const m of seg.matchAll(/\[data-component\s*=\s*["']?([^"'\]]+)["']?\]/g)) {
      out.push({ kind: "component", value: m[1].trim() });
    }
    // Attribute values aren't classes — but a bracket glued to a class is an
    // arbitrary variant, so keep it visible to the variant check below.
    const bare = seg.replace(/(^|[^\w-])\[[^\]]*\]/g, "$1");
    for (const m of bare.matchAll(/#([\w-]+)/g)) {
      if (!isGeneratedId(m[1]) && m[1].length >= 4) {
        out.push({ kind: "identifier", value: m[1], form: "literal", ...narrowOnly });
      }
    }
    // A class followed by `:` or `[` is a variant cut off at its prefix
    // (`aria-expanded:rotate-180`, `data-[state=open]:flex`), not a name.
    for (const m of bare.matchAll(/\.([\w-]+)(?![\w-]*[:[])/g)) {
      if (isDistinctiveName(m[1])) {
        out.push({ kind: "identifier", value: m[1], form: "literal", ...narrowOnly });
      }
    }
    for (const m of seg.matchAll(/\[(?:aria-label|title|alt)\s*=\s*["']?([^"'\]]+)["']?\]/g)) {
      out.push({ kind: "label", value: m[1].trim(), ...narrowOnly });
    }
  });
  return out;
}

/** A plain phrase that reads like visible text rather than an identifier. */
function looksLikePhrase(s: string): boolean {
  if (s.startsWith("/") || looksLikeSelector(s)) return false;
  const words = s.split(/\s+/);
  return words.length >= 2 && words.length <= 8 && s.length <= 60 && /[a-z]/i.test(s);
}

/**
 * The needles worth searching the source for, strongest first. Empty when
 * the evidence holds nothing an author chose — a bare utility selector like
 * `div.fixed>div.absolute` matches no file, by design.
 */
export function sourceNeedles(
  evidence: string,
  known: KnownNames,
  opts: { handle?: string } = {},
): Needle[] {
  const e = unwrap(evidence);
  if (!e) return [];
  const ne = norm(e);
  const out: Needle[] = [];
  // A cited page path is the route's file. A component that happens to share
  // a path segment (`data-component="pricing"` for `/pricing`) can narrow
  // that, never stand in for it — and a label that happens to be a segment
  // (`/settings/export` → "Export") isn't searched at all.
  const isPath = e.startsWith("/");
  // The digest prints an element as `label <tag.class>`; cited that way, both
  // halves are named outright.
  const printed = isPath ? null : e.match(/^(.+?)\s+<([^<>]+)>$/);
  const isSelector = !isPath && !printed && looksLikeSelector(e);
  const contained = { contained: true } as const;

  // Components the analytics know, cited outright or inside a longer string.
  for (const c of known.components) {
    if (!c || c.length < 2) continue;
    const whole = new RegExp(`(?<![\\w-])${escapeRegExp(c)}(?![\\w-])`);
    if (norm(c) === ne) out.push({ kind: "component", value: c });
    else if (c.length >= 4 && whole.test(e)) {
      out.push({ kind: "component", value: c, ...(isPath ? { narrowOnly: true } : contained) });
    }
  }

  // Page paths: the citation itself, or one known path inside it.
  if (isPath) {
    const path = e.split(/\s+/)[0].replace(/[?#].*$/, "").replace(/[),.;:]+$/, "");
    if (/^\/[\w\-./[\]%~@]*$/.test(path)) {
      out.push({ kind: "route", value: path, ...(path === e ? {} : contained) });
    }
  } else {
    const inside = e.split(/\s+/).find((t) => t.startsWith("/") && known.paths.includes(t));
    if (inside) out.push({ kind: "route", value: inside, ...contained });
  }

  if (!isPath && !isSelector) {
    const label = printed ? printed[1].trim() : e;
    // Labels the analytics recorded: the citation's own label outright, or
    // (weaker) a known label inside it. The digest clips labels to 40
    // characters, so the clipped form counts too.
    for (const known_ of known.labels) {
      for (const form of new Set([known_, known_.replace(/\s+/g, " ").trim().slice(0, 40)])) {
        const nl = norm(form);
        const value = form.replace(/\s+/g, " ").trim();
        if (nl.length >= 3 && nl === norm(label)) out.push({ kind: "label", value });
        else if (nl.length >= 4 && ne.includes(nl)) out.push({ kind: "label", value, ...contained });
      }
    }
    // Quoted text inside the citation: `button "Show 9 more"`, aria-label="Close".
    for (const m of e.matchAll(/["“]([^"”]{2,80})["”]|=\s*'([^']{2,80})'/g)) {
      out.push({ kind: "label", value: (m[1] ?? m[2]).trim(), ...contained });
    }
  }

  if (isPath) {
    // A path is all it says; its words aren't identifiers or text.
  } else if (isSelector) {
    out.push(...selectorNeedles(e));
  } else if (printed) {
    out.push(...selectorNeedles(printed[2]));
    if (!out.some((n) => n.kind === "label" && !n.contained)) {
      out.push({ kind: "label", value: printed[1].trim() });
    }
  } else {
    for (const tok of e.match(/[A-Za-z_$][\w$-]*/g) ?? []) {
      const whole = tok === e ? {} : contained;
      if (CODE_IDENTIFIER.test(tok) && tok.length >= 6 && !NOT_IDENTIFIERS.has(tok)) {
        out.push({ kind: "identifier", value: tok, form: "word", ...whole });
      } else if (/[-_]/.test(tok) && tok.length >= 6 && isDistinctiveName(tok)) {
        out.push({ kind: "identifier", value: tok, form: "literal", ...whole });
      }
    }
    // The whole citation as visible text, unless a known label already is.
    // A single short word ("OK") gets no needle at all: too common to search.
    if (looksLikePhrase(e) && !out.some((n) => n.kind === "label" && !n.contained)) {
      out.push({ kind: "label", value: e });
    }
  }

  // The greppable path capture recorded for the cited target, when it did:
  // the same kind of needles a cited selector gives. The target was matched
  // exactly (see digest.ts), so its handle names it outright.
  if (opts.handle) out.push(...selectorNeedles(opts.handle));

  return dedupe(out).sort(
    (a, b) =>
      Number(!!a.contained) - Number(!!b.contained) ||
      KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
      b.value.length - a.value.length,
  );
}

const KIND_RANK: Record<NeedleKind, number> = { component: 0, route: 1, identifier: 2, label: 3 };

function dedupe(needles: Needle[]): Needle[] {
  const seen = new Set<string>();
  const outright = [...needles].sort((a, b) => Number(!!a.contained) - Number(!!b.contained));
  return outright.filter((n) => {
    // An outright needle beats the same needle found inside the citation.
    const k = `${n.kind}:${n.form ?? ""}:${n.narrowOnly ? "~" : ""}${n.value.toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

// ── Routes ───────────────────────────────────────────────────────────────────

const PAGE_FILE = /^page\.(?:tsx|ts|jsx|js|mdx|md)$/;
const PAGES_FILE = /^(.+)\.(?:tsx|ts|jsx|js|mdx|md)$/;

/**
 * The URL pattern a file serves, or null when it isn't a page. App Router:
 * `…/app/<segments>/page.tsx`, with `(groups)` and `@slots` dropped.
 * Pages Router: `…/pages/<segments>/<name>.tsx`, minus `_app`/`api`.
 */
export function routeSegments(file: string): string[] | null {
  const parts = file.split("/");
  const name = parts[parts.length - 1];
  const appAt = parts.indexOf("app");
  const pagesAt = parts.indexOf("pages");
  if (appAt >= 0 && (pagesAt < 0 || appAt < pagesAt)) {
    if (!PAGE_FILE.test(name)) return null;
    const segs = parts.slice(appAt + 1, -1);
    if (segs.some((s) => s.startsWith("(.") || s.startsWith("_"))) return null; // intercepting, private
    return segs.filter((s) => !/^\(.*\)$/.test(s) && !s.startsWith("@"));
  }
  if (pagesAt >= 0) {
    const m = name.match(PAGES_FILE);
    if (!m) return null;
    const segs = parts.slice(pagesAt + 1, -1);
    if (m[1].startsWith("_") || segs[0] === "api" || (segs.length === 0 && m[1] === "api")) {
      return null;
    }
    return m[1] === "index" ? segs : [...segs, m[1]];
  }
  return null;
}

/**
 * How well a route pattern serves a URL path, -1 when it doesn't. Static
 * segments count most, so `/blog/new` prefers `blog/new/page.tsx` over
 * `blog/[slug]/page.tsx`, and any exact pattern beats a catch-all — `/`
 * is `app/page.tsx`, not `app/[[...slug]]/page.tsx`.
 */
export function routeScore(pattern: string[], url: string[]): number {
  let score = 100;
  for (let i = 0; i < pattern.length; i++) {
    const seg = pattern[i];
    const last = i === pattern.length - 1;
    if (/^\[\[\.\.\..+\]\]$/.test(seg)) return last ? score - 50 : -1;
    if (/^\[\.\.\..+\]$/.test(seg)) return last && url.length > i ? score - 50 : -1;
    if (i >= url.length) return -1;
    if (/^\[.+\]$/.test(seg)) score += 1;
    else if (seg === url[i]) score += 10;
    else return -1;
  }
  return pattern.length === url.length ? score : -1;
}

function urlSegments(path: string): string[] {
  return path
    .split("/")
    .filter(Boolean)
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });
}

/** The page files serving a path — the best-scoring ones, which is usually one. */
export function routeFiles(path: string, files: string[]): string[] {
  const url = urlSegments(path);
  let best = -1;
  let out: string[] = [];
  for (const f of files) {
    const segs = routeSegments(f);
    if (!segs) continue;
    const score = routeScore(segs, url);
    if (score < 0) continue;
    if (score > best) {
      best = score;
      out = [f];
    } else if (score === best) {
      out.push(f);
    }
  }
  return out;
}

// ── Content patterns ─────────────────────────────────────────────────────────

/**
 * A number in rendered text may be any expression in the source. Capture
 * folds digit runs to `#` in click labels ("Show # more"), so `#` is one too.
 */
const DYNAMIC = String.raw`(?:\d+|\{[^{}]{1,80}\}|\$\{[^{}]{1,80}\})`;

/** JSX text: between a tag (or an expression) and the next one. */
const JSX_OPEN = String.raw`(?:>|\})\s*`;
const JSX_CLOSE = String.raw`\s*(?:<|\{)`;

/**
 * A string literal — but not an attribute value that names rather than
 * says something (`id="pricing"`, `className="…"`, `href="#…"`).
 */
const LITERAL_OPEN = String.raw`(?<!\b(?:id|className|class|key|href|src|name|type|role|htmlFor|for|rel|target|method|action|as|ref|variant|size|data-[\w-]+)\s*=\s*\{?\s*)(["'\x60])\s*`;
const LITERAL_CLOSE = String.raw`\s*\1`;

/** A label with no word of four letters or more: "Log in", "Buy now", "Pay", "OK". */
export function isShortLabel(label: string): boolean {
  return !label.split(/\s+/).some((w) => w.replace(/[^\p{L}]/gu, "").length >= 4);
}

/**
 * The ways visible text can be written in the source. Rendered text can be
 * upper-cased by CSS, so JSX text matches in any case; a string literal must
 * match case and mustn't be an id or class value, or the label "Pricing"
 * finds every `id="pricing"`.
 *
 * `whole` anchors the label at both ends — it's the element's entire text, so
 * `Show 9 more` shouldn't find `Show {n} more {label}`. A short label is only
 * ever matched whole and as JSX text: "Pay" in a string is anybody's word.
 */
export function labelPatterns(label: string, whole = false): RegExp[] {
  const words = label.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!words.length) return [];
  if (!words.some((w) => /[\p{L}]/u.test(w))) return []; // "#", "2/3": no text to find
  const parts = words.map((w) =>
    w
      .split(/(\d+|#+)/)
      .map((piece, i) => (i % 2 ? DYNAMIC : escapeRegExp(piece)))
      .join(""),
  );
  const body = parts.join(String.raw`\s+`);
  const jsx = new RegExp(`${JSX_OPEN}${body}${JSX_CLOSE}`, "i");
  // A short label ("Log in", "Pay") is only ever its whole JSX text. ("OK"
  // never gets this far: sourceNeedles doesn't search two-letter labels.)
  if (isShortLabel(label)) return [jsx];
  const literal = new RegExp(`${LITERAL_OPEN}${body}${LITERAL_CLOSE}`);
  if (words.length === 1 || whole) return [jsx, literal];
  // Part of a longer text: still inside JSX text or a string — never an
  // attribute value that names rather than says, and case-sensitive in one.
  return [
    new RegExp(String.raw`(?:>|\})[^<>{}]*?${body}`, "i"),
    new RegExp(String.raw`${LITERAL_OPEN.replace(String.raw`(["'\x60])\s*`, String.raw`(["'\x60])`)}[^"'\x60\n]*?${body}[^"'\x60\n]*?\1`),
  ];
}

/** Does any way of writing the label occur in the text? */
export function labelMatches(label: string, text: string, whole = false): boolean {
  return labelPatterns(label, whole).some((re) => re.test(text));
}

function componentDefinition(name: string): RegExp {
  const v = escapeRegExp(name);
  return new RegExp(
    String.raw`(?:data-component\s*=\s*\{?\s*|<PolishdMonitor\b[^>]*?\bname\s*=\s*\{?\s*)["'\x60]${v}["'\x60]`,
  );
}

function literalPattern(value: string): RegExp {
  // Inside a string literal, as a whole class/id token.
  return new RegExp(
    String.raw`["'\x60][^"'\x60\n]*(?<![\w-])${escapeRegExp(value)}(?![\w-])[^"'\x60\n]*["'\x60]|styles\.${escapeRegExp(value)}\b`,
  );
}

function wordPattern(value: string): RegExp {
  return new RegExp(String.raw`(?<![\w$])${escapeRegExp(value)}(?![\w$])`);
}

const baseName = (file: string): string =>
  (file.split("/").pop() ?? "").replace(/\.(?:module\.)?[a-z]+$/i, "").toLowerCase();

/** The files one needle matches, already narrowed by its own tie-break. */
function filesFor(
  needle: Needle,
  files: string[],
  read: (path: string) => string | null,
): string[] {
  if (needle.kind === "route") return routeFiles(needle.value, files);

  const search = (re: RegExp | ((text: string) => boolean)) =>
    files.filter((f) => {
      const text = read(f);
      return text !== null && (typeof re === "function" ? re(text) : re.test(text));
    });

  if (needle.kind === "component") {
    const defining = search(componentDefinition(needle.value));
    if (defining.length) return defining;
    // Not defined literally (a computed name) — fall back to where it's quoted.
    return search(new RegExp(String.raw`["'\x60]${escapeRegExp(needle.value)}["'\x60]`));
  }

  if (needle.kind === "label") {
    // The label as the element's whole text first; as part of a longer
    // string only when nothing renders it whole.
    const hits = search((text) => labelMatches(needle.value, text, true));
    if (hits.length) return hits;
    return search((text) => labelMatches(needle.value, text));
  }

  const hits = search(needle.form === "word" ? wordPattern(needle.value) : literalPattern(needle.value));
  if (hits.length > 1) {
    // `SignupForm` is used in three files and defined in one: the definition.
    const named = hits.filter((f) => baseName(f) === needle.value.toLowerCase());
    if (named.length === 1) return named;
  }
  return hits;
}

/**
 * Source with its comments blanked out: a label or class quoted in a comment
 * (`// the "Show 9 more" toggle lives in features.tsx`) is talk about the
 * element, not the element. Rough by design — a `//` inside a string ends
 * that line early — which only ever costs a match, never invents one.
 */
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:\\"'\x60])\/\/.*$/gm, "$1");
}

/**
 * Match evidence needles against the source. The strongest needle the
 * citation names outright that matches anything sets the candidates; the
 * others (and ancestor context) can only narrow them. Exactly one file left
 * → that's the location. More than one → candidates, and no location:
 * picking one would be a guess dressed as a verification.
 *
 * Needles found *inside* the citation (`contained`) are only consulted when
 * nothing named outright matched, and then give candidates, never a location.
 *
 * `partial` says some files couldn't be read (over budget, a failed or timed
 * out request). Then one hit among what was read isn't proof it's the only
 * one, so a content match comes back as a candidate, never a location. A
 * route still verifies — it's decided from the file listing — unless
 * `truncated` says the listing itself is incomplete, when nothing verifies.
 */
export function matchSource(
  needles: Needle[],
  files: string[],
  read: (path: string) => string | null,
  opts: { partial?: boolean; truncated?: boolean } = {},
): SourceMatch {
  if (!needles.length || !files.length) return {};
  const stripped = new Map<string, string | null>();
  const code = (path: string): string | null => {
    if (!stripped.has(path)) {
      const raw = read(path);
      stripped.set(path, raw === null ? null : stripComments(raw));
    }
    return stripped.get(path)!;
  };
  const rank = (n: Needle) => KIND_RANK[n.kind];
  const outright = needles
    .filter((n) => !n.narrowOnly && !n.contained)
    .sort((a, b) => rank(a) - rank(b) || b.value.length - a.value.length);
  const context = needles.filter((n) => n.narrowOnly);
  const inside = needles
    .filter((n) => n.contained && !n.narrowOnly)
    .sort((a, b) => rank(a) - rank(b) || b.value.length - a.value.length);

  const hitsOf = (n: Needle) => [...new Set(filesFor(n, files, code))];
  const candidatesOnly = (needle: Needle, hits: string[]): SourceMatch => ({
    candidates: [...hits].sort().slice(0, MAX_CANDIDATES),
    needle,
  });

  let decided: { needle: Needle; files: string[] } | null = null;
  for (const needle of outright) {
    const hits = hitsOf(needle);
    if (hits.length) {
      decided = { needle, files: hits };
      break;
    }
  }
  if (!decided) {
    for (const needle of inside) {
      const hits = hitsOf(needle);
      if (hits.length) return candidatesOnly(needle, hits);
    }
    return {};
  }

  let candidates = decided.files;
  for (const needle of [...outright, ...context]) {
    if (candidates.length === 1) break;
    if (needle === decided.needle) continue;
    const hits = hitsOf(needle);
    const narrowed = candidates.filter((f) => hits.includes(f));
    if (narrowed.length) candidates = narrowed;
  }
  const verifiable =
    !opts.truncated && (!opts.partial || decided.needle.kind === "route");
  if (candidates.length === 1 && verifiable) {
    return { location: candidates[0], needle: decided.needle };
  }
  return candidatesOnly(decided.needle, candidates);
}
