/**
 * Polishd — holding the design review's suggestions to the system it praised.
 *
 * The review is asked to fix outliers with values the site already uses, and
 * never to redesign. Models drift from both. A review that lists "22px and
 * 28px headings, used consistently" as a strength will go on to suggest
 * "adopt a 12/14/16/20/24 type scale": a fix that deletes the values it just
 * praised, which a coding agent will then carry out faithfully. The prompt
 * asks for better; this checks the reply once it's parsed:
 *
 *   - A suggestion that clearly removes a value the same review lists under
 *     strengths is withheld, with the reason. "Clearly" means it names the
 *     value as the thing to collapse, replace or drop, or proposes a scale
 *     that spans the value but skips it (12/14/16/20/24px has no room for a
 *     praised 22px), and the strength and the suggestion are about the same
 *     kind of value. Nothing else is withheld.
 *   - Any value a kept suggestion names that the metrics don't contain is
 *     reported as new, so no one mistakes it for a value the site already
 *     has. A suggestion that's mostly new values reads as the redesign it is.
 *
 * Extraction from strengths is conservative: only values written with a unit
 * or a `#` count, since a strength is prose and a stray number in it is not a
 * value the review praised. The issue survives a withheld suggestion: the
 * problem can be real when the fix isn't.
 *
 * Pure, with type-only imports, so the tests exercise it directly.
 */
import type { PolishdDesignData } from "../server/design";

/** What a px value is for. Hex values are always colors. */
export type DesignValueKind = "type" | "radius" | "spacing";

/** The values the metrics say the site renders, as `16px` / `#1a1a1a` keys. */
export interface KnownDesignValues {
  type: ReadonlySet<string>;
  radius: ReadonlySet<string>;
  spacing: ReadonlySet<string>;
  color: ReadonlySet<string>;
}

const pxKey = (n: number): string => `${Math.round(n * 100) / 100}px`;

/** Lowercase, with the 3- and 4-digit shorthands spelled out. */
function hexKey(raw: string): string {
  const h = raw.toLowerCase();
  if (h.length === 4 || h.length === 5) {
    return `#${[...h.slice(1)].map((c) => c + c).join("")}`;
  }
  return h;
}

export function knownDesignValues(
  data: Pick<PolishdDesignData, "fonts" | "colors" | "contrast" | "radii" | "spacing">,
): KnownDesignValues {
  const radius = new Set<string>();
  for (const r of data.radii) {
    // "8px", or "9999px (full)".
    const n = parseFloat(r.value);
    if (Number.isFinite(n)) radius.add(pxKey(n));
  }
  const color = new Set<string>();
  for (const c of data.colors) color.add(hexKey(c.hex));
  for (const p of data.contrast) {
    color.add(hexKey(p.fg));
    color.add(hexKey(p.bg));
  }
  return {
    type: new Set(data.fonts.map((f) => pxKey(f.sizePx))),
    radius,
    spacing: new Set(data.spacing.map((s) => pxKey(s.px))),
    color,
  };
}

// ── Reading values out of prose ──────────────────────────────────────────────

/** One value named in a sentence, and which list of values it was part of. */
export interface ValueMention {
  /** `16px` or `#1a1a1a`. */
  key: string;
  unit: "px" | "hex";
  start: number;
  end: number;
  /** Mentions sharing a list id were written as one list: `12/14/16px`, `#111, #222`. */
  list: number;
}

const TOKEN = /#[0-9a-fA-F]{3,8}\b|(?<![\w.#-])(\d+(?:\.\d+)?)(px)?(?![\w%]|\.\d)/g;

/** What may sit between two members of one list. Dashes read as ranges, not lists. */
const LIST_SEPARATOR = /^\s*(?:\/|,|&|\+|,?\s*and|,?\s*or)\s*$/i;

interface RawToken {
  hex: boolean;
  text: string;
  value: number;
  px: boolean;
  start: number;
  end: number;
}

/**
 * Every px and hex value in `text`. A unit written once at the end of a list
 * covers the list (`12/14/16px` is three px values), but not anything after
 * it (`16px/400` is a size and a weight). With `bareScales`, a list with no
 * unit at all counts as px when it looks like a scale: three or more whole
 * numbers between 4 and 200 that aren't all font weights.
 */
export function valueMentions(text: string, { bareScales = true } = {}): ValueMention[] {
  const tokens: RawToken[] = [];
  for (const m of text.matchAll(TOKEN)) {
    const start = m.index ?? 0;
    const raw = m[0];
    if (raw.startsWith("#")) {
      if (![4, 5, 7, 9].includes(raw.length)) continue;
      tokens.push({ hex: true, text: raw, value: 0, px: false, start, end: start + raw.length });
    } else {
      tokens.push({
        hex: false,
        text: raw,
        value: Number(m[1]),
        px: m[2] !== undefined,
        start,
        end: start + raw.length,
      });
    }
  }

  // Group adjacent tokens of one kind into lists.
  const lists: RawToken[][] = [];
  for (const t of tokens) {
    const current = lists[lists.length - 1];
    const prev = current?.[current.length - 1];
    if (prev && prev.hex === t.hex && LIST_SEPARATOR.test(text.slice(prev.end, t.start))) {
      current.push(t);
    } else {
      lists.push([t]);
    }
  }

  const out: ValueMention[] = [];
  lists.forEach((list, id) => {
    if (list[0].hex) {
      for (const t of list) {
        out.push({ key: hexKey(t.text), unit: "hex", start: t.start, end: t.end, list: id });
      }
      return;
    }
    let lastPx = -1;
    list.forEach((t, i) => {
      if (t.px) lastPx = i;
    });
    let members: RawToken[];
    if (lastPx >= 0) {
      members = list.slice(0, lastPx + 1);
    } else {
      const scaleLike =
        bareScales &&
        list.length >= 3 &&
        list.every((t) => Number.isInteger(t.value) && t.value >= 4 && t.value <= 200) &&
        !list.every((t) => t.value % 100 === 0);
      members = scaleLike ? list : [];
    }
    for (const t of members) {
      out.push({ key: pxKey(t.value), unit: "px", start: t.start, end: t.end, list: id });
    }
  });
  return out;
}

const KIND_WORDS: [DesignValueKind, RegExp][] = [
  [
    "type",
    /\b(type|typograph\w*|fonts?|text|headings?|headlines?|headers?|titles?|body|captions?|display|leading|line-height)\b/i,
  ],
  ["radius", /\b(radius|radii|corners?|rounded|rounding|pills?)\b/i],
  ["spacing", /\b(padding|spacing|gaps?|margins?|gutters?|grid|insets?|whitespace|rhythm)\b/i],
];

/** The one kind of px value a sentence talks about, or null when it names none or several. */
export function kindOf(text: string): DesignValueKind | null {
  const kinds = KIND_WORDS.filter(([, re]) => re.test(text)).map(([k]) => k);
  return kinds.length === 1 ? kinds[0] : null;
}

/** The one kind the site uses a px value as, or null when it's several or none. */
function measuredKind(key: string, known: KnownDesignValues): DesignValueKind | null {
  const kinds = (["type", "radius", "spacing"] as const).filter((k) => known[k].has(key));
  return kinds.length === 1 ? kinds[0] : null;
}

function isKnown(m: ValueMention, kind: DesignValueKind | null, known: KnownDesignValues): boolean {
  if (m.unit === "hex") return known.color.has(m.key);
  if (kind) return known[kind].has(m.key);
  return known.type.has(m.key) || known.radius.has(m.key) || known.spacing.has(m.key);
}

// ── Which values a suggestion takes away ─────────────────────────────────────

/** Verbs whose object is the value going away: "collapse 15px into…", "drop #222". */
const REMOVE_VERB =
  /\b(collapse|merge|consolidate|fold|move|shift|snap|round|change|convert|replace|swap|reduce|bump|nudge|unify|retire|drop|remove|eliminate|delete|phase out|get rid of|normali[sz]e|standardi[sz]e)\b/gi;
/** Where the value going away ends and the one replacing it begins. */
const TARGET_MARKER = /\b(into|onto|to|on|with|in favou?r of)\b|→|->|=>/i;
/** Phrases whose object is the value going away: "use 24px instead of 22px". */
const SOURCE_AFTER = /\b(instead of|rather than|in place of)\b/gi;
/** Clause ends: a full stop that isn't a decimal point, a semicolon, a line break. */
const CLAUSE = /(?<!\d)\.(?!\d)|;|\n/g;

/** The character ranges of `text` holding values the suggestion would remove. */
function sourceSpans(text: string): [number, number][] {
  const ends = [...text.matchAll(CLAUSE)].map((m) => m.index ?? 0);
  const clauseEnd = (at: number) => ends.find((e) => e >= at) ?? text.length;
  const spans: [number, number][] = [];
  const spanFrom = (from: number) => {
    const end = clauseEnd(from);
    const marker = text.slice(from, end).search(TARGET_MARKER);
    spans.push([from, marker >= 0 ? from + marker : end]);
  };
  for (const m of text.matchAll(REMOVE_VERB)) spanFrom((m.index ?? 0) + m[0].length);
  for (const m of text.matchAll(SOURCE_AFTER)) spanFrom((m.index ?? 0) + m[0].length);
  return spans;
}

// ── The check ────────────────────────────────────────────────────────────────

export interface CheckedSuggestion {
  /** The suggestion, unless it was withheld. */
  suggestion?: string;
  /** Values the kept suggestion names that the site doesn't render yet. */
  newValues?: string[];
  /** Why the suggestion was withheld. */
  withheld?: string;
}

/** A strength's values, each with the kind the strength talks about it as. */
interface Praised {
  key: string;
  unit: "px" | "hex";
  kind: DesignValueKind | null;
}

function praisedValues(strengths: string[], known: KnownDesignValues): Praised[] {
  const out: Praised[] = [];
  for (const s of strengths) {
    const sentenceKind = kindOf(s);
    for (const m of valueMentions(s, { bareScales: false })) {
      out.push({
        key: m.key,
        unit: m.unit,
        kind: m.unit === "hex" ? null : (sentenceKind ?? measuredKind(m.key, known)),
      });
    }
  }
  return out;
}

/** Same value, and — for px — the same job, known on both sides. */
function samePraised(p: Praised, unit: "px" | "hex", key: string, kind: DesignValueKind | null) {
  if (p.unit !== unit || p.key !== key) return false;
  return unit === "hex" || (p.kind !== null && p.kind === kind);
}

const listText = (members: ValueMention[]): string =>
  members[0].unit === "hex"
    ? members.map((m) => m.key).join(", ")
    : `${members.map((m) => m.key.slice(0, -2)).join("/")}px`;

/**
 * Check one suggestion against the review's own strengths and the measured
 * values. `issue` is read only for what kind of value the problem is about.
 */
export function checkSuggestion(
  issue: string,
  suggestion: string,
  strengths: string[],
  known: KnownDesignValues,
): CheckedSuggestion {
  const mentions = valueMentions(suggestion);
  if (mentions.length === 0) return { suggestion };

  const praised = praisedValues(strengths, known);
  const spans = sourceSpans(suggestion);
  const isSource = (m: ValueMention) => spans.some(([a, b]) => m.start >= a && m.start < b);
  const sentenceKind = kindOf(suggestion) ?? kindOf(issue);
  const kindFor = (m: ValueMention): DesignValueKind | null =>
    m.unit === "hex" ? null : (sentenceKind ?? measuredKind(m.key, known));

  // 1. Naming a praised value as the one to collapse, replace or drop — and
  //    not also as the value to keep ("unify 22px and 23px on 22px").
  const targets = new Set(mentions.filter((m) => !isSource(m)).map((m) => m.key));
  for (const m of mentions) {
    if (!isSource(m) || targets.has(m.key)) continue;
    const kind = kindFor(m);
    if (praised.some((p) => samePraised(p, m.unit, m.key, kind))) {
      return { withheld: `it would replace ${m.key}, which this review lists as a strength` };
    }
  }

  // 2. Proposing a scale that skips a praised value inside its own range.
  //    Only a px scale can skip a value — colors have no order, and a list of
  //    text colors that leaves out the praised background isn't removing it.
  const byList = new Map<number, ValueMention[]>();
  for (const m of mentions) {
    if (isSource(m)) continue;
    byList.set(m.list, [...(byList.get(m.list) ?? []), m]);
  }
  for (const members of byList.values()) {
    if (members.length < 3) continue;
    const unit = members[0].unit;
    // A scale is one kind of value: the sentence's, or failing that, the one
    // most of its members are measured as.
    let kind: DesignValueKind | null = unit === "hex" ? null : sentenceKind;
    if (unit === "px" && !kind) {
      const tally = new Map<DesignValueKind, number>();
      for (const m of members) {
        const k = measuredKind(m.key, known);
        if (k) tally.set(k, (tally.get(k) ?? 0) + 1);
      }
      const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
      if (top && top[1] * 2 > members.length) kind = top[0];
    }
    const keys = new Set(members.map((m) => m.key));
    const values = members.map((m) => parseFloat(m.key));
    const [lo, hi] = [Math.min(...values), Math.max(...values)];
    const left =
      unit === "px"
        ? praised.find((p) => {
            const v = parseFloat(p.key);
            return p.unit === "px" && p.kind !== null && p.kind === kind && !keys.has(p.key) && v > lo && v < hi;
          })
        : undefined;
    if (left) {
      return {
        withheld: `it proposes ${listText(members)} and leaves out ${left.key}, which this review lists as a strength`,
      };
    }
  }

  // 3. Kept: say which values it would introduce.
  const newValues: string[] = [];
  for (const m of mentions) {
    if (isSource(m) || isKnown(m, kindFor(m), known) || newValues.includes(m.key)) continue;
    newValues.push(m.key);
  }
  return newValues.length ? { suggestion, newValues } : { suggestion };
}

// ── Dismissal keys ───────────────────────────────────────────────────────────

const PATH = /(?<![\w/])\/[\w\-./[\]]*/g;

/**
 * The key a dismissed design issue is filed under. Design evidence is free
 * text the model rewrites on every regenerate — "#444444 on #0a0a0a (2.03:1
 * contrast at 11px)" comes back as "low-contrast #444 text on #0A0A0A" — so
 * the key is the set of values it cites, not its wording.
 *
 * Which values: the colors, when it cites any, since a color issue is about
 * its colors and the size or page it mentions in passing comes and goes
 * between rewrites. Otherwise its px values; otherwise its page paths;
 * otherwise, with nothing to normalize, the text itself. Ratios and counts
 * never count: they're derived, and reworded freely.
 */
export function designEvidenceKey(evidence: string): string {
  const mentions = valueMentions(evidence);
  const colors = new Set(mentions.filter((m) => m.unit === "hex").map((m) => m.key));
  if (colors.size) return [...colors].sort().join(" ");
  const sizes = new Set(mentions.filter((m) => m.unit === "px").map((m) => m.key));
  if (sizes.size) return [...sizes].sort().join(" ");
  const paths = new Set<string>();
  for (const m of evidence.matchAll(PATH)) {
    const path = m[0].replace(/[.,]+$/, "");
    if (path.length > 1 || evidence.trim() === "/") paths.add(path.toLowerCase());
  }
  if (paths.size) return [...paths].sort().join(" ");
  return evidence.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Whether a design issue was already dismissed, under any rewording of its evidence. */
export function isDismissedDesignIssue(evidence: string, dismissedKeys: ReadonlySet<string>): boolean {
  return dismissedKeys.size > 0 && dismissedKeys.has(designEvidenceKey(evidence));
}
