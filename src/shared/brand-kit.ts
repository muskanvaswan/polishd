/**
 * Polishd — a brand kit, curated out of the measured design system.
 *
 * The Design tab shows everything the site renders, drift included. A brand
 * kit is the other reading of the same data: only the values that make up the
 * system, named and ordered the way a guideline would present them. So this
 * curates rather than copies:
 *
 *   • **One-offs are left out.** Anything the Design tab badges one-off, plus
 *     the spacing values that would earn the badge (padding has no badge of
 *     its own — off-grid is a different question, and a value used all over
 *     the site is part of the system whatever grid it sits on).
 *   • **Near-duplicate colors fold together.** `#fefefe` beside `#ffffff` is
 *     one token drawn twice; the kit keeps the one used more.
 *   • **Fluid sizes snap to whole pixels**, so a heading at 30px and 30.4px
 *     is one type style.
 *
 * Everything is named: colors by hue and lightness (`Red 600`, `Neutral 900`)
 * with the most used chromatic ones as Primary / Secondary, type styles by
 * their step on the scale (`Heading 1`, `Body`, `Caption`), radii and spacing
 * as ordered scales. The same names become CSS custom properties, so the kit
 * can be pasted into a stylesheet as well as read.
 *
 * Pure: no DOM, no store, no React — the test file pins the edge cases. It
 * runs on the server render and its result is handed to the browser as data.
 */
import type { PolishdDesignData } from "../server/design";

// ── The kit ──────────────────────────────────────────────────────────────────

export type BrandKitColorRole = "text" | "background" | "border";

export interface BrandKitColor {
  /** `#rrggbb`, or `#rrggbbaa` for a translucent value. */
  hex: string;
  /** "Red 600", "Neutral 100", "White", "Black 12%". */
  name: string;
  /** The custom-property suffix: `--color-${token}`. */
  token: string;
  /** Chromatic colors carry the brand; neutrals are the grays around them. */
  group: "brand" | "neutral";
  /** Primary / Secondary / Accent for brand colors, by how much they're used. */
  rank: "Primary" | "Secondary" | "Accent" | null;
  /** What the color paints, most used first. */
  roles: BrandKitColorRole[];
  /** Share of every color tally on the site, 0–100. */
  pct: number;
  pages: number;
  /** 0–1; 1 for an opaque color. */
  alpha: number;
}

export interface BrandKitPairing {
  fg: string;
  bg: string;
  /** WCAG 2.x contrast ratio. */
  ratio: number;
  /** "AAA", "AA", or "AA Large" — which text the pairing is safe for. */
  level: "AAA" | "AA" | "AA Large";
  count: number;
}

export type BrandKitTypefaceRole = "Primary" | "Display" | "Secondary" | "Monospace";

export interface BrandKitTypeface {
  /** The family as CSS names it — what to render the specimen in. */
  family: string;
  /** The family as a person names it: `__Inter_d65c78` reads as "Inter". */
  name: string;
  role: BrandKitTypefaceRole;
  /** `--font-${token}`. */
  token: string;
  /** Weights in use, ascending. */
  weights: number[];
  /** Share of the kit's text set in this family, 0–100. */
  pct: number;
  /** A CSS generic or system alias (`system-ui`), not a font anyone ships. */
  generic: boolean;
  /** Real text the site sets in it. */
  sample: string | null;
}

export interface BrandKitTypeStyle {
  /** "Heading 1", "Body", "Body · SemiBold", "Caption". */
  name: string;
  /** The step on the scale the style belongs to: "Body" for "Body · SemiBold". */
  step: string;
  /** `--text-${token}` — one per step, shared by the step's styles. */
  token: string;
  /** The step's most used style; its siblings vary its weight or family. */
  lead: boolean;
  family: string;
  familyName: string;
  sizePx: number;
  weight: number;
  sample: string | null;
  /** Tags seen carrying the style (h1, p, button…). */
  tags: string[];
  count: number;
  pages: number;
}

export interface BrandKitRadius {
  /** "sm", "md", "full". */
  name: string;
  /** `--radius-${token}`. */
  token: string;
  /** Pixels; null for a fully rounded pill. */
  px: number | null;
  count: number;
}

export interface BrandKitSpacing {
  /** `--space-${token}`, counting up from the smallest step. */
  token: string;
  px: number;
  count: number;
}

/** A value the kit left out, for the colophon to own up to. */
export interface BrandKitOmission {
  kind: "type" | "color" | "radius" | "spacing";
  label: string;
}

export interface BrandKit {
  /** Pages the kit was measured from, newest scan first. */
  pages: string[];
  /** Newest scan the kit reflects, ms since epoch. */
  measuredAt: number;
  colors: BrandKitColor[];
  pairings: BrandKitPairing[];
  typefaces: BrandKitTypeface[];
  typeScale: BrandKitTypeStyle[];
  radii: BrandKitRadius[];
  spacing: BrandKitSpacing[];
  /**
   * The spacing grid most padding lands on (8, 4 or 2px), and the share that
   * does — or null when no grid accounts for most of it.
   */
  grid: { unit: number; pct: number } | null;
  /**
   * The site's own page: the opaque color painting the most backgrounds, and
   * the one setting the most text — what the kit's cover is drawn in.
   */
  surface: { background: string | null; text: string | null };
  /** One-offs left out, every kind. */
  omitted: BrandKitOmission[];
  /** Near-duplicate colors folded into the token they drift from. */
  folded: { from: string; into: string }[];
}

// ── Color math ───────────────────────────────────────────────────────────────

function rgbOf(hex: string): [number, number, number] | null {
  const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  if (!m) return null;
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function alphaOf(hex: string): number {
  return hex.length === 9 ? Math.round((parseInt(hex.slice(7, 9), 16) / 255) * 100) / 100 : 1;
}

/** WCAG 2.x relative luminance of the color's opaque part. */
export function relativeLuminance(hex: string): number {
  const rgb = rgbOf(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastBetween(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

/** CIE L*, 0–100: lightness as the eye reads it. */
function perceivedLightness(hex: string): number {
  const y = relativeLuminance(hex);
  const f = y > 216 / 24389 ? Math.cbrt(y) : (24389 / 27) * y / 116 + 16 / 116;
  return Math.max(0, Math.min(100, 116 * f - 16));
}

/** Chroma as a 0–1 share of the RGB range — how far from gray. */
function chroma(hex: string): number {
  const rgb = rgbOf(hex);
  if (!rgb) return 0;
  return (Math.max(...rgb) - Math.min(...rgb)) / 255;
}

/** HSL hue in degrees. */
function hue(hex: string): number {
  const rgb = rgbOf(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((v) => v / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

function colorDistance(a: string, b: string): number {
  const ra = rgbOf(a);
  const rb = rgbOf(b);
  if (!ra || !rb) return Infinity;
  return Math.sqrt((ra[0] - rb[0]) ** 2 + (ra[1] - rb[1]) ** 2 + (ra[2] - rb[2]) ** 2);
}

/** Below this chroma a color reads as gray, however warm or cool. */
const NEUTRAL_CHROMA = 0.14;
/** The Design tab calls colors closer than this "likely meant to be the same token". */
const NEAR_DUPLICATE = 10;

const HUES: [number, string][] = [
  [15, "Red"],
  [40, "Orange"],
  [50, "Amber"],
  [65, "Yellow"],
  [85, "Lime"],
  [150, "Green"],
  [175, "Teal"],
  [195, "Cyan"],
  [210, "Sky"],
  [240, "Blue"],
  [255, "Indigo"],
  [275, "Violet"],
  [295, "Purple"],
  [320, "Fuchsia"],
  [345, "Pink"],
  [360, "Red"],
];

function hueName(hex: string): string {
  const h = hue(hex);
  return HUES.find(([limit]) => h < limit)?.[1] ?? "Red";
}

/**
 * The familiar 50–950 steps and the lightness (L*) each sits at, read off
 * Tailwind's palettes so a name means what a designer expects: grays follow
 * its neutral scales, hues the average of its chromatic ones (which run
 * darker at the light end and lighter at the dark end than grays do).
 */
const NEUTRAL_STEPS: [number, number][] = [
  [50, 98],
  [100, 96],
  [200, 91],
  [300, 84],
  [400, 67],
  [500, 48],
  [600, 36],
  [700, 27],
  [800, 16],
  [900, 9],
  [950, 3],
];
const HUE_STEPS: [number, number][] = [
  [50, 97],
  [100, 94],
  [200, 88],
  [300, 80],
  [400, 69],
  [500, 58],
  [600, 49],
  [700, 41],
  [800, 34],
  [900, 28],
  [950, 17],
];

/** The step whose lightness is nearest, skipping steps already taken. */
function stepFor(hex: string, taken: Set<number>, neutral: boolean): number | null {
  const l = perceivedLightness(hex);
  const free = (neutral ? NEUTRAL_STEPS : HUE_STEPS).filter(([step]) => !taken.has(step));
  if (free.length === 0) return null;
  return free.reduce((best, s) => (Math.abs(s[1] - l) < Math.abs(best[1] - l) ? s : best))[0];
}

// ── Typeface names ───────────────────────────────────────────────────────────

const GENERIC_NAMES: Record<string, string> = {
  "system-ui": "System UI",
  "-apple-system": "System UI",
  blinkmacsystemfont: "System UI",
  "ui-sans-serif": "System sans-serif",
  "ui-serif": "System serif",
  "ui-monospace": "System monospace",
  "ui-rounded": "System rounded",
  "sans-serif": "Sans-serif",
  serif: "Serif",
  monospace: "Monospace",
  cursive: "Cursive",
};

const MONO = /mono|courier|consolas|menlo|code/i;

/**
 * The family as a person would name it. `next/font` registers faces under a
 * hashed alias (`__Inter_d65c78`, `__Inter_Fallback_d65c78`), which is what a
 * computed style reports; the kit names the font, and keeps the alias only to
 * render it.
 */
export function typefaceName(family: string): string {
  const generic = GENERIC_NAMES[family.toLowerCase()];
  if (generic) return generic;
  const hashed = family.match(/^__(.+?)(?:_Fallback)?_[0-9a-f]{6,}$/i);
  if (hashed) return hashed[1].replace(/_/g, " ");
  return family;
}

const WEIGHT_NAMES: Record<number, string> = {
  100: "Thin",
  200: "ExtraLight",
  300: "Light",
  400: "Regular",
  500: "Medium",
  600: "SemiBold",
  700: "Bold",
  800: "ExtraBold",
  900: "Black",
};

export function weightName(weight: number): string {
  return WEIGHT_NAMES[Math.round(weight / 100) * 100] ?? String(weight);
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// ── Curation ─────────────────────────────────────────────────────────────────

/**
 * Padding has no one-off badge on the Design tab, so the kit applies the same
 * test the other sections do: a sliver of the tallies, on one page only, once
 * there is enough measured to tell a sliver from a small site.
 */
function spacingOneOffs(data: PolishdDesignData): Set<number> {
  const total = data.spacing.reduce((s, v) => s + v.count, 0);
  const out = new Set<number>();
  if (total < 40) return out;
  for (const s of data.spacing) {
    if (s.count <= Math.max(2, total * 0.02) && s.pages.length === 1) out.add(s.px);
  }
  return out;
}

interface ColorAcc {
  hex: string;
  count: number;
  roles: Record<BrandKitColorRole, number>;
  pages: Set<string>;
  pct: number;
}

function curateColors(data: PolishdDesignData) {
  const omitted: BrandKitOmission[] = [];
  const folded: { from: string; into: string }[] = [];
  const kept: ColorAcc[] = [];
  /** Every measured hex the kit knows, mapped to the token it became. */
  const alias = new Map<string, string>();

  for (const c of data.colors) {
    if (c.outlier) {
      omitted.push({ kind: "color", label: c.hex });
      continue;
    }
    // Most used first, so a near-duplicate always folds into the dominant one.
    // Translucent values only fold into the same tint at the same opacity.
    const into = kept.find(
      (k) => k.hex.length === c.hex.length &&
        k.hex.slice(7) === c.hex.slice(7) &&
        colorDistance(k.hex, c.hex) < NEAR_DUPLICATE,
    );
    if (into) {
      into.count += c.count;
      into.pct += c.pct;
      for (const r of ["text", "background", "border"] as const) into.roles[r] += c.roles[r];
      for (const p of c.pages) into.pages.add(p);
      alias.set(c.hex, into.hex);
      folded.push({ from: c.hex, into: into.hex });
      continue;
    }
    kept.push({ hex: c.hex, count: c.count, roles: { ...c.roles }, pages: new Set(c.pages), pct: c.pct });
    alias.set(c.hex, c.hex);
  }

  // Brand colors are named and ranked by use; neutrals run light to dark.
  const isNeutral = (hex: string) => chroma(hex) < NEUTRAL_CHROMA;
  const brand = kept.filter((c) => !isNeutral(c.hex)).sort((a, b) => b.count - a.count);
  const neutral = kept
    .filter((c) => isNeutral(c.hex))
    .sort((a, b) => perceivedLightness(b.hex) - perceivedLightness(a.hex) || b.count - a.count);

  const takenSteps = new Map<string, Set<number>>();
  const usedTokens = new Set<string>();
  const uniqueToken = (base: string) => {
    let token = base;
    for (let n = 2; usedTokens.has(token); n++) token = `${base}-${n}`;
    usedTokens.add(token);
    return token;
  };

  const named = (c: ColorAcc, group: "brand" | "neutral", rank: BrandKitColor["rank"]): BrandKitColor => {
    const opaque = c.hex.slice(0, 7);
    const alpha = alphaOf(c.hex);
    let base: string;
    if (opaque === "#ffffff") base = "White";
    else if (opaque === "#000000") base = "Black";
    else {
      const family = group === "neutral" ? "Neutral" : hueName(opaque);
      // Translucent tints share the opaque scale's steps without claiming them.
      const taken = alpha < 1 ? new Set<number>() : (takenSteps.get(family) ?? new Set<number>());
      const step = stepFor(opaque, taken, group === "neutral");
      if (alpha === 1 && step !== null) {
        taken.add(step);
        takenSteps.set(family, taken);
      }
      base = step === null ? family : `${family} ${step}`;
    }
    const pctLabel = alpha < 1 ? ` ${Math.round(alpha * 100)}%` : "";
    const roles = (["text", "background", "border"] as const)
      .filter((r) => c.roles[r] > 0)
      .sort((a, b) => c.roles[b] - c.roles[a]);
    return {
      hex: c.hex,
      name: `${base}${pctLabel}`,
      token: uniqueToken(slug(`${base}${alpha < 1 ? ` a${Math.round(alpha * 100)}` : ""}`)),
      group,
      rank,
      roles,
      pct: Math.round(c.pct * 10) / 10,
      pages: c.pages.size,
      alpha,
    };
  };

  // Primary and Secondary go to the two most used opaque brand colors; a
  // translucent tint is always an accent on something else.
  let opaqueRank = 0;
  const rankOf = (c: ColorAcc): BrandKitColor["rank"] => {
    if (c.hex.length === 9) return "Accent";
    opaqueRank++;
    return opaqueRank === 1 ? "Primary" : opaqueRank === 2 ? "Secondary" : "Accent";
  };
  // Opaque colors claim their steps before translucent ones are named.
  const byOpacity = (a: ColorAcc, b: ColorAcc) => a.hex.length - b.hex.length;
  const names = new Map<ColorAcc, BrandKitColor>();
  for (const c of [...brand].sort(byOpacity)) names.set(c, named(c, "brand", rankOf(c)));
  for (const c of [...neutral].sort(byOpacity)) names.set(c, named(c, "neutral", null));
  const colors: BrandKitColor[] = [...brand, ...neutral].map((c) => names.get(c)!);

  const most = (role: BrandKitColorRole) =>
    kept
      .filter((c) => c.hex.length === 7 && c.roles[role] > 0)
      .sort((a, b) => b.roles[role] - a.roles[role])[0]?.hex ?? null;
  const surface = { background: most("background"), text: most("text") };

  return { colors, omitted, folded, alias, surface };
}

function curatePairings(
  data: PolishdDesignData,
  alias: Map<string, string>,
  colors: BrandKitColor[],
): BrandKitPairing[] {
  const inKit = new Set(colors.map((c) => c.hex));
  const merged = new Map<string, BrandKitPairing & { minSizePx: number }>();
  for (const p of data.contrast) {
    const fg = alias.get(p.fg);
    const bg = alias.get(p.bg);
    if (!fg || !bg || fg === bg || !inKit.has(fg) || !inKit.has(bg)) continue;
    const key = `${fg}|${bg}`;
    const prev = merged.get(key);
    if (prev) {
      prev.count += p.count;
      prev.minSizePx = Math.min(prev.minSizePx, p.minSizePx);
      continue;
    }
    merged.set(key, { fg, bg, ratio: contrastBetween(fg, bg), level: "AA", count: p.count, minSizePx: p.minSizePx });
  }
  const out: BrandKitPairing[] = [];
  for (const p of merged.values()) {
    // Only pairings the site uses *and* that pass belong in a guideline; a
    // 3:1 pair the site only sets large is safe for exactly that.
    const large = p.minSizePx >= 24;
    if (p.ratio < (large ? 3 : 4.5)) continue;
    const level = p.ratio >= 7 ? "AAA" : p.ratio >= 4.5 ? "AA" : "AA Large";
    out.push({ fg: p.fg, bg: p.bg, ratio: p.ratio, level, count: p.count });
  }
  return out.sort((a, b) => b.count - a.count).slice(0, 10);
}

interface StyleAcc {
  family: string;
  sizePx: number;
  weight: number;
  count: number;
  sample: string | null;
  tags: Set<string>;
  pages: Set<string>;
}

/** Sizes this close are one step drawn twice — fluid type lands on 30 and 30.7. */
const SAME_SIZE = 0.04;
/** Above this multiple of body a size is a heading; below it, larger body text. */
const HEADING_RATIO = 1.25;
/** And above this, display type — if there are headings under it too. */
const DISPLAY_RATIO = 2.4;

/**
 * Name every size on the scale, outward from body text: display and headings
 * above (largest first), larger body text just above body, small print below.
 * Rank alone would call a 16px label "Heading 9" on a site with many sizes;
 * the ratio to body keeps names meaning what they say.
 */
function nameSizes(sizes: number[], body: number): Map<number, string> {
  const names = new Map<number, string>([[body, "Body"]]);
  const headings = sizes.filter((s) => s >= body * HEADING_RATIO).sort((a, b) => b - a);
  const display = headings.length >= 3 && headings[0] >= body * DISPLAY_RATIO;
  headings.forEach((size, i) => {
    names.set(size, display && i === 0 ? "Display" : `Heading ${display ? i : i + 1}`);
  });
  const large = sizes.filter((s) => s > body && s < body * HEADING_RATIO).sort((a, b) => a - b);
  large.forEach((size, i) => names.set(size, `Body ${i === 0 ? "L" : i === 1 ? "XL" : `${i}XL`}`));
  const small = sizes.filter((s) => s < body).sort((a, b) => b - a);
  const smallNames = ["Body S", "Caption", "Micro"];
  small.forEach((size, i) => names.set(size, smallNames[i] ?? `Micro ${i - smallNames.length + 2}`));
  return names;
}

function curateType(data: PolishdDesignData) {
  const omitted: BrandKitOmission[] = [];
  const fonts = data.fonts.filter((f) => {
    if (!f.outlier) return true;
    omitted.push({
      kind: "type",
      label: `${typefaceName(f.family)} ${f.sizePx}px ${weightName(f.weight)}`,
    });
    return false;
  });

  // Snap sizes to whole pixels, then fold each into a more used size within
  // a few percent of it. Leaders are chosen by use, so the fold never chains
  // a run of 1px-apart sizes into one.
  const sizeUse = new Map<number, number>();
  for (const f of fonts) {
    const px = Math.round(f.sizePx);
    sizeUse.set(px, (sizeUse.get(px) ?? 0) + f.count);
  }
  const sizeOf = new Map<number, number>();
  const kept: number[] = [];
  for (const [px] of [...sizeUse.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])) {
    const into = kept.find((k) => Math.abs(k - px) / Math.max(k, px) <= SAME_SIZE);
    if (into === undefined) kept.push(px);
    sizeOf.set(px, into ?? px);
  }

  const styles = new Map<string, StyleAcc>();
  for (const f of fonts) {
    const sizePx = sizeOf.get(Math.round(f.sizePx))!;
    const key = `${f.family}|${sizePx}|${f.weight}`;
    let s = styles.get(key);
    if (!s) {
      styles.set(key, (s = { family: f.family, sizePx, weight: f.weight, count: 0, sample: null, tags: new Set(), pages: new Set() }));
    }
    s.count += f.count;
    if (!s.sample && f.sample) s.sample = f.sample;
    for (const t of f.tags) if (s.tags.size < 6) s.tags.add(t);
    for (const p of f.pages) s.pages.add(p);
  }
  const list = [...styles.values()].sort((a, b) => b.sizePx - a.sizePx || b.count - a.count);
  if (list.length === 0) return { typefaces: [], typeScale: [], omitted };

  // Body is the most used text size in reading range.
  const byUse = [...list].sort((a, b) => b.count - a.count);
  const body = (byUse.find((s) => s.sizePx >= 12 && s.sizePx <= 20) ?? byUse[0]).sizePx;
  const stepName = nameSizes([...new Set(list.map((s) => s.sizePx))], body);

  // Typefaces, and which role each plays.
  const familyAcc = new Map<string, { count: number; weights: Set<number>; sizeSum: number; sample: string | null }>();
  for (const s of list) {
    let f = familyAcc.get(s.family);
    if (!f) familyAcc.set(s.family, (f = { count: 0, weights: new Set(), sizeSum: 0, sample: null }));
    f.count += s.count;
    f.weights.add(s.weight);
    f.sizeSum += s.sizePx * s.count;
    if (!f.sample && s.sample && s.sizePx >= body) f.sample = s.sample;
  }
  const totalText = [...familyAcc.values()].reduce((sum, f) => sum + f.count, 0);
  const families = [...familyAcc.entries()].sort((a, b) => b[1].count - a[1].count);
  const usedFontTokens = new Set<string>();
  let primarySeen = false;
  const typefaces: BrandKitTypeface[] = families.map(([family, f]) => {
    const name = typefaceName(family);
    let role: BrandKitTypefaceRole;
    if (MONO.test(name)) role = "Monospace";
    else if (!primarySeen) {
      role = "Primary";
      primarySeen = true;
    } else role = f.sizeSum / f.count > body ? "Display" : "Secondary";
    const serif = /serif/i.test(name) && !/sans/i.test(name);
    const base =
      role === "Monospace" ? "mono" : role === "Primary" ? (serif ? "serif" : "sans") : role === "Display" ? "display" : "secondary";
    let token = base;
    for (let n = 2; usedFontTokens.has(token); n++) token = `${base}-${n}`;
    usedFontTokens.add(token);
    return {
      family,
      name,
      role,
      token,
      weights: [...f.weights].sort((a, b) => a - b),
      pct: totalText > 0 ? Math.round((f.count / totalText) * 1000) / 10 : 0,
      generic: family.toLowerCase() in GENERIC_NAMES,
      sample: f.sample,
    };
  });
  // One name per style: the most used style at a size takes the step's name,
  // its siblings say how they differ — the family when it isn't the size's
  // main one, otherwise the weight.
  const leaders = new Map<number, StyleAcc>();
  for (const s of byUse) if (!leaders.has(s.sizePx)) leaders.set(s.sizePx, s);
  const typeScale: BrandKitTypeStyle[] = list.map((s) => {
    const step = stepName.get(s.sizePx) ?? `${s.sizePx}px`;
    const leader = leaders.get(s.sizePx)!;
    const name =
      leader === s
        ? step
        : s.family !== leader.family
          ? `${step} · ${typefaceName(s.family)}`
          : `${step} · ${weightName(s.weight)}`;
    return {
      name,
      step,
      token: slug(step),
      lead: leader === s,
      family: s.family,
      familyName: typefaceName(s.family),
      sizePx: s.sizePx,
      weight: s.weight,
      sample: s.sample,
      tags: [...s.tags],
      count: s.count,
      pages: s.pages.size,
    };
  });

  return { typefaces, typeScale, omitted };
}

const RADIUS_NAMES = ["xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl"];

function curateRadii(data: PolishdDesignData) {
  const omitted: BrandKitOmission[] = [];
  const byPx = new Map<number, number>();
  let full = 0;
  for (const r of data.radii) {
    if (r.outlier) {
      omitted.push({ kind: "radius", label: r.value });
      continue;
    }
    if (r.value === "full") {
      full += r.count;
      continue;
    }
    // A box rounded on some corners only (tabs, joined buttons) still uses
    // the system's radius — it counts toward that step.
    const px = parseFloat(r.value);
    if (!Number.isFinite(px) || px <= 0) continue;
    byPx.set(px, (byPx.get(px) ?? 0) + r.count);
  }
  const steps = [...byPx.entries()].sort((a, b) => a[0] - b[0]);
  // Small scales start at "sm" so a lone radius isn't called extra-small.
  const offset = steps.length <= 4 ? 1 : 0;
  const radii: BrandKitRadius[] = steps.map(([px, count], i) => {
    const name = RADIUS_NAMES[i + offset] ?? `${i + offset - RADIUS_NAMES.length + 5}xl`;
    return { name, token: name, px, count };
  });
  if (full > 0) radii.push({ name: "full", token: "full", px: null, count: full });
  return { radii, omitted };
}

function curateSpacing(data: PolishdDesignData) {
  const oneOffs = spacingOneOffs(data);
  const omitted: BrandKitOmission[] = [];
  const kept: { px: number; count: number }[] = [];
  for (const s of data.spacing) {
    if (oneOffs.has(s.px)) omitted.push({ kind: "spacing", label: `${s.px}px` });
    else kept.push({ px: s.px, count: s.count });
  }
  kept.sort((a, b) => a.px - b.px);
  const spacing: BrandKitSpacing[] = kept.map((s, i) => ({ token: String(i + 1), px: s.px, count: s.count }));

  const total = kept.reduce((sum, s) => sum + s.count, 0);
  let grid: BrandKit["grid"] = null;
  if (total > 0) {
    for (const unit of [8, 4, 2]) {
      const on = kept.filter((s) => s.px % unit === 0).reduce((sum, s) => sum + s.count, 0) / total;
      if (on >= 0.8) {
        grid = { unit, pct: Math.round(on * 100) };
        break;
      }
    }
  }
  return { spacing, grid, omitted };
}

/** Curate the measured design system into a kit. Empty lists when nothing's scanned. */
export function buildBrandKit(data: PolishdDesignData): BrandKit {
  const color = curateColors(data);
  const type = curateType(data);
  const radius = curateRadii(data);
  const space = curateSpacing(data);
  return {
    pages: data.pages.map((p) => p.path),
    measuredAt: data.pages.reduce((max, p) => Math.max(max, p.scannedAt), 0),
    colors: color.colors,
    pairings: curatePairings(data, color.alias, color.colors),
    typefaces: type.typefaces,
    typeScale: type.typeScale,
    radii: radius.radii,
    spacing: space.spacing,
    grid: space.grid,
    surface: color.surface,
    omitted: [...type.omitted, ...color.omitted, ...radius.omitted, ...space.omitted],
    folded: color.folded,
  };
}

// ── As code ──────────────────────────────────────────────────────────────────

/** The typeface as a CSS `font-family` value: the family, then a fitting generic fallback. */
export function cssFamily(t: BrandKitTypeface): string {
  const generic = t.generic ? t.family : `"${t.family.replace(/"/g, '\\"')}"`;
  const fallback = t.role === "Monospace" ? "ui-monospace, monospace" : /serif/i.test(t.name) && !/sans/i.test(t.name) ? "ui-serif, serif" : "ui-sans-serif, system-ui, sans-serif";
  return t.generic ? generic : `${generic}, ${fallback}`;
}

function rem(px: number): string {
  return `${Math.round((px / 16) * 1000) / 1000}rem`;
}

/**
 * The kit as CSS custom properties, grouped and commented. Colors, typefaces,
 * type sizes and radii use Tailwind v4's theme namespaces, so the same lines
 * also work inside `@theme { }`.
 */
export function brandKitCss(kit: BrandKit, name: string, opts: { comments?: boolean } = {}): string {
  const comments = opts.comments ?? true;
  const lines: string[] = comments
    ? [`/* ${name} — brand tokens, generated by Polishd from the live site */`, ":root {"]
    : [":root {"];
  const group = (title: string, entries: [string, string, string?][]) => {
    if (entries.length === 0) return;
    lines.push(`  /* ${title} */`);
    for (const [prop, value, note] of entries) {
      lines.push(`  ${prop}: ${value};${note && comments ? ` /* ${note} */` : ""}`);
    }
    lines.push("");
  };
  const ranked = kit.colors.filter((c) => c.rank === "Primary" || c.rank === "Secondary");
  group("Color", [
    ...kit.colors.map((c): [string, string, string?] => [`--color-${c.token}`, c.hex, c.name]),
    ...ranked.map((c): [string, string] => [`--color-${c.rank!.toLowerCase()}`, `var(--color-${c.token})`]),
  ]);
  group(
    "Typefaces",
    kit.typefaces.map((t) => [`--font-${t.token}`, cssFamily(t), `${t.role.toLowerCase()} — ${t.name}`]),
  );
  group(
    "Type scale",
    kit.typeScale
      .filter((s) => s.lead)
      .map((s) => [`--text-${s.token}`, rem(s.sizePx), `${s.sizePx}px — ${s.familyName} ${weightName(s.weight)}`]),
  );
  group(
    "Radius",
    kit.radii.map((r) => [`--radius-${r.token}`, r.px === null ? "9999px" : `${r.px}px`]),
  );
  group(
    "Spacing",
    kit.spacing.map((s) => [`--space-${s.token}`, `${s.px}px`]),
  );
  while (lines[lines.length - 1] === "") lines.pop();
  lines.push("}");
  return lines.join("\n") + "\n";
}
