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
 *     strengths is withheld, with the reason. "Clearly" means it replaces the
 *     value with a different value of the same kind ("collapse 22px into
 *     20px"), drops it outright ("drop 22px"), or proposes a scale that spans
 *     the value but skips it (12/14/16/20/24px has no room for a praised
 *     22px). A praised value that's only the subject of another change — its
 *     color, its line-height, its margin, its unit, a token in place of a
 *     literal — is left alone, even when the new value is in px too. Nothing
 *     else is withheld.
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

/**
 * Verbs whose object can be replaced by another value: "collapse 15px into
 * 16px", "replace #222 with #111". Their object only goes away when a
 * different value of the same kind follows — "change the 16px body text color
 * to #a3a3a3" and "convert 16px text to rem" keep 16px.
 */
const CHANGE_VERB =
  /\b(collapse|merge|consolidate|fold|move|shift|snap|round|change|convert|replace|swap|reduce|bump|nudge|unify|normali[sz]e|standardi[sz]e)\b/gi;
/** Verbs whose object goes away with or without a replacement: "drop 22px". */
const DROP_VERB = /\b(retire|drop|remove|eliminate|delete|phase out|get rid of)\b/gi;
/** Where the value going away ends and the one replacing it begins. */
const TARGET_MARKER = /\b(into|onto|to|on|with|for|becom(?:e|es|ing)|in favou?r of|and (?:re)?use)\b|→|->|=>/i;
/** An arrow on its own is a replacement too: "headings: 22px → 24px". */
const ARROW = /→|->|=>/g;
/** Phrases whose object is the value going away: "use 24px instead of 22px". */
const SOURCE_AFTER = /\b(instead of|rather than|in place of)\b/gi;
/** Clause ends: a full stop that isn't a decimal point, a semicolon, a line break. */
const CLAUSE = /(?<!\d)\.(?!\d)|;|\n/g;

type Range = [number, number];

/** One "this value goes, that one comes" in a suggestion. */
interface Removal {
  /** Where the values going away are written. */
  source: Range;
  /** Where the replacing values are written, if anywhere. */
  target: Range | null;
  /** True when the source goes away even with no replacement named: "drop 22px". */
  drops: boolean;
}

function removals(text: string): Removal[] {
  const ends = [...text.matchAll(CLAUSE)].map((m) => m.index ?? 0);
  const clauseEnd = (at: number) => ends.find((e) => e >= at) ?? text.length;
  const clauseStart = (at: number) => {
    const before = ends.filter((e) => e < at);
    return before.length ? before[before.length - 1] + 1 : 0;
  };
  const out: Removal[] = [];
  const after = (from: number, drops: boolean) => {
    const end = clauseEnd(from);
    const marker = text.slice(from, end).match(TARGET_MARKER);
    if (!marker || marker.index === undefined) {
      out.push({ source: [from, end], target: null, drops });
      return;
    }
    const at = from + marker.index;
    out.push({ source: [from, at], target: [at + marker[0].length, end], drops: false });
  };
  for (const m of text.matchAll(CHANGE_VERB)) after((m.index ?? 0) + m[0].length, false);
  for (const m of text.matchAll(DROP_VERB)) after((m.index ?? 0) + m[0].length, true);
  for (const m of text.matchAll(SOURCE_AFTER)) {
    const at = m.index ?? 0;
    const from = at + m[0].length;
    const end = clauseEnd(from);
    const marker = text.slice(from, end).search(TARGET_MARKER);
    // "Use 24px instead of 22px": the replacement is what came before.
    out.push({ source: [from, marker >= 0 ? from + marker : end], target: [clauseStart(at), at], drops: false });
  }
  for (const m of text.matchAll(ARROW)) {
    const at = m.index ?? 0;
    const start = clauseStart(at);
    // A verb earlier in the clause already claimed this arrow as its marker.
    if (out.some((r) => r.source[0] >= start && r.source[0] < at)) continue;
    out.push({ source: [start, at], target: [at + m[0].length, clauseEnd(at)], drops: false });
  }
  return out;
}

/**
 * Properties a px value can belong to, tagged with the kind of value each is
 * itself. A change that names one of them about the praised value is about
 * that property: "bump the line-height of 16px body text to 24px" sets a
 * line-height and keeps the 16px size. Naming the value's own property
 * ("the 28px heading's size", "the 8px card radius") is the same property, so
 * that change still counts.
 */
const PROPERTY_WORDS: [DesignValueKind | null, RegExp][] = [
  ["type", /(?<![\w-])(sizes?|font-sizes?|font sizes?|type sizes?|text sizes?)(?![\w-])/gi],
  ["spacing", /(?<![\w-])(margins?|padding|paddings|gaps?|spacing|gutters?|insets?)(?![\w-])/gi],
  ["radius", /(?<![\w-])(radius|radii|corners?|rounded|rounding)(?![\w-])/gi],
  [
    null,
    /(?<![\w-])(line-heights?|leading|letter-spacing|tracking|word-spacing|weights?|font-weight|colou?rs?|opacity|shadows?|borders?|border-width|outlines?|widths?|heights?|max-width|min-width|offsets?|blur)(?![\w-])/gi,
  ],
];

/** "the line-height of [the] 16px…": a property, then "of", then the value. */
const ATTACHED_BEFORE = /^\s+of\s+(?:(?:the|a|an|its|their|this|that|all)\s+)?(?:[\w-]+\s+){0,2}$/i;
/**
 * "16px body text's letter-spacing", "28px heading margin": the value, a few
 * plain words naming the element, then the property. A preposition or a
 * conjunction in between ("22px headings with a border") means the property
 * belongs to something else.
 */
const ATTACHED_AFTER =
  /^(?:\s+(?!(?:with|without|on|in|for|to|into|onto|at|and|or|by|from|under|over|than|plus|via|inside|beside|near)\b)[\w-]+(?:['’]s)?){0,3}\s+$/i;

/**
 * Whether a change to the praised value `m` is to some other property of it.
 * Only a property word attached to the value counts. If its own property is
 * named, the change is to the value itself, whatever else is named with it.
 */
function changesOtherProperty(text: string, m: ValueMention, kind: DesignValueKind | null): boolean {
  const ends = [...text.matchAll(CLAUSE)].map((c) => c.index ?? 0);
  const start = Math.max(0, ...ends.filter((e) => e < m.start).map((e) => e + 1));
  const end = ends.find((e) => e >= m.end) ?? text.length;
  let other = false;
  for (const [own, re] of PROPERTY_WORDS) {
    for (const w of text.slice(start, end).matchAll(re)) {
      const at = start + (w.index ?? 0);
      const attached =
        at + w[0].length <= m.start
          ? ATTACHED_BEFORE.test(text.slice(at + w[0].length, m.start))
          : at >= m.end && ATTACHED_AFTER.test(text.slice(m.end, at));
      if (!attached) continue;
      if (own !== null && own === kind) return false;
      other = true;
    }
  }
  return other;
}

const within = (m: ValueMention, [a, b]: Range) => m.start >= a && m.start < b;

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
  const moves = removals(suggestion);
  const isSource = (m: ValueMention) => moves.some((r) => within(m, r.source));
  const sentenceKind = kindOf(suggestion) ?? kindOf(issue);
  const kindFor = (m: ValueMention): DesignValueKind | null =>
    m.unit === "hex" ? null : (sentenceKind ?? measuredKind(m.key, known));

  // 1. A praised value replaced by a different value of the same kind, or
  //    dropped outright — and not also kept ("unify 22px and 23px on 22px").
  //    A praised value that's only the subject of some other change (its
  //    color, its line-height, its unit) is untouched.
  const kept = new Set(mentions.filter((m) => !isSource(m)).map((m) => m.key));
  for (const r of moves) {
    for (const m of mentions) {
      if (!within(m, r.source) || kept.has(m.key)) continue;
      const kind = kindFor(m);
      const p = praised.find((q) => samePraised(q, m.unit, m.key, kind));
      if (!p) continue;
      // The words attached to a px value say which of its properties changes.
      if (m.unit === "px" && changesOtherProperty(suggestion, m, p.kind)) continue;
      if (r.drops) return { withheld: `it would drop ${m.key}, which this review lists as a strength` };
      const replacement = r.target
        ? mentions.find((t) => {
            if (!within(t, r.target!) || t.unit !== m.unit || t.key === m.key) return false;
            const k = kindFor(t);
            return t.unit === "hex" || k === null || k === p.kind;
          })
        : undefined;
      if (replacement) {
        return {
          withheld: `it would replace ${m.key} with ${replacement.key}, and this review lists ${m.key} as a strength`,
        };
      }
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

// ── Recognising a dismissed issue ────────────────────────────────────────────
//
// Policy, for everything below and for the strength check above: when it's
// uncertain, don't hide a finding and don't withhold a suggestion. A
// dismissed finding that resurfaces is a nuisance the owner can dismiss
// again; a real problem hidden, or a fix withheld, is the failure this module
// exists to remove. So every rule here errs toward "not the same issue" and
// toward "keep the suggestion".
//
// Known residuals, each a consequence of that policy:
//   - "Swap 22px for 24px" with no kind named anywhere and 24px measured only
//     as padding is kept: nothing says the 24px is a type size.
//   - A property word is only read when it's attached to the praised value
//     (adjacent, or "the X of …"); phrasing that separates them further
//     ("…and, for the 16px body text, raise the line-height to 24px") is
//     read as a change to the value and withheld.
//   - A dismissal resurfaces when a regenerate adds or drops what tells
//     issues apart: an explicit category word, or a color's role (a role on
//     one side and none on the other is a non-match). A contrast pair's
//     sizes are the exception: a rewording that drops them still matches,
//     but when both list sizes, the sets must be the same.
//   - Two current issues with identical evidence matching one dismissal: only
//     the one whose wording is closest to the dismissed issue is hidden (word
//     overlap; a tie hides the first).

/** What a design issue is about. Part of what makes two issues the same one. */
export type DesignIssueCategory =
  | "contrast"
  | "palette"
  | "type"
  | "radius"
  | "spacing"
  /** px values the design data can't place. */
  | "size"
  /** No values at all: matched on its text. */
  | "other";

/** Two colors joined the way a text/background pair is written. */
const PAIR = /#[0-9a-f]{3,8}\b[^#]{0,60}?\b(on|over|under|against|atop|behind)\b[^#]{0,30}?#[0-9a-f]{3,8}\b/i;
/** A contrast ratio or the word, in the evidence itself. */
const RATIO = /\bcontrast\b|\d+(?:\.\d+)?\s*:\s*1\b/i;

/**
 * Words that name a category outright. When the evidence or the issue uses
 * one (evidence first), it decides, over what the design data would say.
 */
const EXPLICIT_CATEGORY: [DesignIssueCategory, RegExp][] = [
  ["contrast", /\b(contrast|wcag)\b/i],
  ["radius", /\b(radius|radii|corners?|rounded|rounding)\b/i],
  ["spacing", /\b(padding|paddings|spacing|gaps?|margins?|gutters?)\b/i],
  ["type", /\b(fonts?|font-sizes?|typograph\w*|type(?:\s+(?:sizes?|scale|styles?))?|text sizes?)\b/i],
];

/** The one category a sentence names outright, among `allowed`, or null. */
function explicitCategory(text: string, allowed: DesignIssueCategory[]): DesignIssueCategory | null {
  const named = EXPLICIT_CATEGORY.filter(([c, re]) => allowed.includes(c) && re.test(text)).map(([c]) => c);
  return named.length === 1 ? named[0] : null;
}

const ROLE_WORDS: [string, RegExp][] = [
  ["background", /\b(backgrounds?|bg|surfaces?|fills?)\b/i],
  ["border", /\b(borders?|outlines?|dividers?|strokes?|rules?|hairlines?)\b/i],
  ["text", /\b(text|copy|fonts?|foreground|headings?|links?|labels?)\b/i],
];

/** The one color role a sentence names, or null when it names none or several. */
function roleOf(text: string): string | null {
  const roles = ROLE_WORDS.filter(([, re]) => re.test(text)).map(([r]) => r);
  return roles.length === 1 ? roles[0] : null;
}

/**
 * What makes two design issues the same one, however the model words them.
 * Every field must agree (see sameDesignIssue).
 */
export interface DesignIssueSignature {
  category: DesignIssueCategory;
  /** The colors (contrast, palette) or px values cited, normalized and sorted; for "other", the text. */
  values: string;
  /** A contrast issue's text sizes, sorted. */
  sizes: string[];
  /** The role a palette issue's color plays, when its evidence or wording says. */
  role: string | null;
}

/**
 * Which section of the measured design a set of px values belongs to: the
 * one holding all of them, or failing that most of them, with descriptive
 * wording ("headings", "card") breaking a tie.
 */
function pxCategory(keys: string[], issue: string, evidence: string, known: KnownDesignValues): DesignIssueCategory {
  const kinds: DesignValueKind[] = ["type", "radius", "spacing"];
  const held = kinds.map((k) => ({ k, n: keys.filter((key) => known[k].has(key)).length }));
  const best = Math.max(...held.map((h) => h.n));
  const candidates = best === 0 ? kinds : held.filter((h) => h.n === best).map((h) => h.k);
  if (candidates.length === 1) return candidates[0];
  const worded = kindOf(evidence) ?? kindOf(issue);
  if (worded && candidates.includes(worded)) return worded;
  return "size";
}

/** An issue's signature, read against the current design data. */
export function designIssueSignature(
  issue: string,
  evidence: string,
  known: KnownDesignValues,
): DesignIssueSignature {
  const mentions = valueMentions(evidence);
  const colors = [...new Set(mentions.filter((m) => m.unit === "hex").map((m) => m.key))].sort();
  const px = [...new Set(mentions.filter((m) => m.unit === "px").map((m) => m.key))].sort();

  if (colors.length > 0) {
    const named = explicitCategory(evidence, ["contrast"]) ?? explicitCategory(issue, ["contrast"]);
    const contrast = named === "contrast" || (colors.length >= 2 && (PAIR.test(evidence) || RATIO.test(evidence)));
    return contrast
      ? { category: "contrast", values: colors.join(" "), sizes: px, role: null }
      : { category: "palette", values: colors.join(" "), sizes: [], role: roleOf(evidence) ?? roleOf(issue) };
  }
  if (px.length > 0) {
    const allowed: DesignIssueCategory[] = ["type", "radius", "spacing"];
    const category =
      explicitCategory(evidence, allowed) ?? explicitCategory(issue, allowed) ?? pxCategory(px, issue, evidence, known);
    return { category, values: px.join(" "), sizes: [], role: null };
  }
  return { category: "other", values: evidence.replace(/\s+/g, " ").trim().toLowerCase(), sizes: [], role: null };
}

/**
 * Whether two signatures are one issue. Strict on purpose (see the policy
 * above): the same category and values; the same role, where no role only
 * matches no role; and, when both list sizes, the same sizes. A size dropped
 * by a rewording still matches: "#888 on #0a0a0a" is the 11px failure
 * reworded, while "at 11px and 12px" and "at 12px and 16px" are two failures.
 */
export function sameDesignIssue(a: DesignIssueSignature, b: DesignIssueSignature): boolean {
  if (a.category !== b.category || a.values !== b.values || a.role !== b.role) return false;
  return a.sizes.length === 0 || b.sizes.length === 0 || a.sizes.join(" ") === b.sizes.join(" ");
}

/** A dismissed design issue: its wording, and its signature. */
export interface DismissedDesignIssue {
  issue: string;
  signature: DesignIssueSignature;
}

const words = (s: string): Set<string> => new Set(s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);

/** Shared words, the measure of which current issue a dismissal was about. */
function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n;
}

/**
 * Which current issues the dismissals hide, by index. Each dismissal hides at
 * most one issue: the closest in wording among those it matches and no other
 * dismissal has claimed. So two current issues citing identical evidence
 * ("#888888 on #0a0a0a" for captions, and for placeholders) are only both
 * hidden when both were dismissed.
 */
export function dismissedIndexes(
  current: readonly { issue: string; evidence: string }[],
  dismissed: readonly DismissedDesignIssue[],
  known: KnownDesignValues,
): Set<number> {
  const hidden = new Set<number>();
  if (dismissed.length === 0 || current.length === 0) return hidden;
  const signatures = current.map((c) => designIssueSignature(c.issue, c.evidence, known));
  const currentWords = current.map((c) => words(c.issue));
  for (const d of dismissed) {
    const dWords = words(d.issue);
    let best = -1;
    let bestScore = -1;
    signatures.forEach((sig, i) => {
      if (hidden.has(i) || !sameDesignIssue(sig, d.signature)) return;
      const score = overlap(dWords, currentWords[i]);
      if (score > bestScore) {
        best = i;
        bestScore = score;
      }
    });
    if (best >= 0) hidden.add(best);
  }
  return hidden;
}
