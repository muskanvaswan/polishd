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
  data: Pick<PolishdDashboardData, "elements" | "monitored" | "topUsed" | "pages" | "friction">,
  profile: Pick<PolishdProjectProfile, "coveredIdentifiers"> | null,
): KnownNames {
  const components = new Set<string>(profile?.coveredIdentifiers ?? []);
  for (const m of data.monitored) components.add(m.name);
  for (const t of data.topUsed) if (t.isComponent) components.add(t.label);
  const labels = new Set<string>();
  for (const e of data.elements) if (e.sampleText?.trim()) labels.add(e.sampleText.trim());
  for (const c of data.friction?.clicks ?? []) {
    if (c.by === "component") components.add(c.key);
    if (c.text?.trim()) labels.add(c.text.trim());
  }
  const paths = new Set<string>(data.pages.map((p) => p.path));
  for (const p of data.friction?.pages ?? []) paths.add(p.path);
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
    "backdrop before after open clearfix active show fade collapsed " +
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
    ].join("|") +
    ")-",
);

/** Is this class name a styling utility rather than a name the author chose? */
export function isUtilityClass(token: string): boolean {
  const t = token.replace(/^(?:[\w-]+:)+/, "").replace(/^!/, ""); // variants, !important
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
 * Needles from one selector: ids and custom classes, never tags or
 * utilities. Only the clicked element's own step (the last one) can decide a
 * match; its ancestors' only narrow one.
 */
function selectorNeedles(selector: string): Needle[] {
  const out: Needle[] = [];
  const segs = selector.split(/\s*>\s*|\s+/).filter(Boolean);
  segs.forEach((seg, i) => {
    const narrowOnly = i < segs.length - 1 ? { narrowOnly: true } : {};
    for (const m of seg.matchAll(/#([\w-]+)/g)) {
      if (!isGeneratedId(m[1]) && m[1].length >= 4) {
        out.push({ kind: "identifier", value: m[1], form: "literal", ...narrowOnly });
      }
    }
    for (const m of seg.matchAll(/\.([\w-]+)/g)) {
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
export function sourceNeedles(evidence: string, known: KnownNames): Needle[] {
  const e = unwrap(evidence);
  if (!e) return [];
  const ne = norm(e);
  const out: Needle[] = [];

  // Components the analytics know, cited outright or inside a longer string.
  for (const c of known.components) {
    if (!c || c.length < 2) continue;
    const whole = new RegExp(`(?<![\\w-])${escapeRegExp(c)}(?![\\w-])`);
    if (norm(c) === ne || (c.length >= 4 && whole.test(e))) {
      out.push({ kind: "component", value: c });
    }
  }

  // Page paths.
  const pathToken = e.split(/\s+/).find((t) => t.startsWith("/"));
  if (pathToken && (e.startsWith("/") || known.paths.includes(pathToken))) {
    const path = pathToken.replace(/[?#].*$/, "").replace(/[),.;:]+$/, "");
    if (/^\/[\w\-./[\]%~@]*$/.test(path)) out.push({ kind: "route", value: path });
  }

  // Quoted text inside the citation: `button "Show 9 more"`, aria-label="Close".
  for (const m of e.matchAll(/["“]([^"”]{2,80})["”]|=\s*'([^']{2,80})'/g)) {
    out.push({ kind: "label", value: (m[1] ?? m[2]).trim() });
  }

  // Labels the analytics recorded, cited outright or inside the citation. The
  // digest clips labels to 40 characters, so the clipped form counts too.
  for (const label of known.labels) {
    for (const form of new Set([label, label.replace(/\s+/g, " ").trim().slice(0, 40)])) {
      const nl = norm(form);
      if (nl.length >= 3 && (nl === ne || (nl.length >= 4 && ne.includes(nl)))) {
        out.push({ kind: "label", value: form.replace(/\s+/g, " ").trim() });
      }
    }
  }

  if (looksLikeSelector(e)) {
    out.push(...selectorNeedles(e));
  } else {
    for (const tok of e.match(/[A-Za-z_$][\w$-]*/g) ?? []) {
      if (CODE_IDENTIFIER.test(tok) && tok.length >= 6 && !NOT_IDENTIFIERS.has(tok)) {
        out.push({ kind: "identifier", value: tok, form: "word" });
      } else if (/[-_]/.test(tok) && tok.length >= 6 && isDistinctiveName(tok)) {
        out.push({ kind: "identifier", value: tok, form: "literal" });
      }
    }
    if (looksLikePhrase(e) && !out.some((n) => n.kind === "label")) {
      out.push({ kind: "label", value: e });
    }
  }

  return dedupe(out).sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind]);
}

const KIND_RANK: Record<NeedleKind, number> = { component: 0, route: 1, identifier: 2, label: 3 };

function dedupe(needles: Needle[]): Needle[] {
  const seen = new Set<string>();
  return needles.filter((n) => {
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

/** A number in rendered text may be any expression in the source. */
const DYNAMIC = String.raw`(?:\d+|\{[^{}]{1,80}\}|\$\{[^{}]{1,80}\})`;

/** Where written text starts and ends: a tag boundary, a quote, an expression brace. */
const TEXT_OPEN = String.raw`(?:>|["'\x60]|\})\s*`;
const TEXT_CLOSE = String.raw`\s*(?:<|["'\x60]|\{)`;

/**
 * Visible text as it would be written in JSX or a string. `whole` anchors it
 * at both ends — the label is the element's entire text, so `Show 9 more`
 * shouldn't find `Show {n} more {label}` — which one word always needs, or
 * "Save" would match every file with a save function.
 */
export function labelPattern(label: string, whole = false): RegExp | null {
  const words = label.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!words.length) return null;
  const parts = words.map((w) =>
    w
      .split(/(\d+)/)
      .map((piece, i) => (i % 2 ? DYNAMIC : escapeRegExp(piece)))
      .join(""),
  );
  if (words.length === 1) {
    const w = words[0];
    if (w.length < 3 || /^\d+$/.test(w)) return null;
    return new RegExp(`${TEXT_OPEN}${parts[0]}${TEXT_CLOSE}`, "i");
  }
  const body = parts.join(String.raw`\s+`);
  return new RegExp(whole ? `${TEXT_OPEN}${body}${TEXT_CLOSE}` : body, "i");
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

  const search = (re: RegExp) =>
    files.filter((f) => {
      const text = read(f);
      return text !== null && re.test(text);
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
    const whole = labelPattern(needle.value, true);
    const hits = whole ? search(whole) : [];
    if (hits.length) return hits;
    const part = labelPattern(needle.value);
    return part ? search(part) : [];
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
 * Match evidence needles against the source. The strongest needle that
 * matches anything sets the candidates; the others can only narrow them.
 * Exactly one file left → that's the location. More than one → candidates,
 * and no location: picking one would be a guess dressed as a verification.
 */
export function matchSource(
  needles: Needle[],
  files: string[],
  read: (path: string) => string | null,
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
  const ordered = [...needles].sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind]);
  let decided: { needle: Needle; files: string[] } | null = null;
  const others: string[][] = [];
  for (const needle of ordered) {
    const hits = [...new Set(filesFor(needle, files, code))];
    if (!hits.length) continue;
    if (!decided && !needle.narrowOnly) decided = { needle, files: hits };
    else others.push(hits);
  }
  if (!decided) return {};

  let candidates = decided.files;
  for (const hits of others) {
    if (candidates.length === 1) break;
    const narrowed = candidates.filter((f) => hits.includes(f));
    if (narrowed.length) candidates = narrowed;
  }
  if (candidates.length === 1) return { location: candidates[0], needle: decided.needle };
  return {
    candidates: [...candidates].sort().slice(0, MAX_CANDIDATES),
    needle: decided.needle,
  };
}
