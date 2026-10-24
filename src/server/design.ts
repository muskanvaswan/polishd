/**
 * Polishd — design metrics aggregation (server only).
 *
 * Merges the latest `design_scan` per page into one site-wide picture: the
 * typography actually in use, the color palette as rendered, the radius and
 * spacing scales — a brand guideline reverse-engineered from the built site.
 *
 * The merged data then gets a deterministic review (design-flags.ts):
 * rule-based checks against widely accepted UI practice (a bounded type
 * scale, one or two families, a palette without near-duplicates, WCAG
 * contrast, spacing on a grid, values drawn from a theme). These produce
 * `flags` — no model involved — and both the metrics and the flags feed the
 * AI design review in ai/design.ts.
 *
 * Every value carries two counts: uses (elements rendering it) and
 * declarations (the distinct class strings behind them), so a component
 * repeated forty times reads as the one decision it is. One-off status is
 * judged on declarations (shared/design-values.ts), and so is the share of
 * spacing off the grid; uses still say how much of the UI a value covers.
 */
import {
  isOffGrid,
  isOneOff,
  mergeDeclarations,
  ONE_OFF_RULES,
  sectionTotals,
  type DeclarationPart,
} from "../shared/design-values";
import type {
  DesignColorTuple,
  DesignDeclTail,
  PolishdDesignScanPayload,
} from "../shared/types";
import { buildDesignFlags } from "./design-flags";
import { polishdEventsSource } from "./queries";
import { parseMeta, query, storeReady } from "./store";

export { buildDesignFlags };

// ── Aggregated shapes (what the Design tab renders) ──────────────────────────

/**
 * How a value was decided. Both are absent when any page's scan predates
 * declaration counting.
 */
export interface DesignDeclarations {
  /**
   * Distinct declarations rendering the value site-wide: class strings, or
   * for an unclassed element its tag path. A component rendered on every row
   * is one declaration.
   */
  declarations?: number;
  /** Of those, declarations that hand-typed it as an arbitrary value (`text-[#555]`). */
  handTyped?: number;
}

export interface DesignFontUsage extends DesignDeclarations {
  family: string;
  sizePx: number;
  weight: number;
  /** Elements across all pages rendering this exact combination. */
  count: number;
  /** Real text sampled from the site in this style. */
  sample: string | null;
  /** Tag names seen carrying it (h1, p, button…). */
  tags: string[];
  pages: string[];
  /** True when this looks like a one-off rather than part of the type scale. */
  outlier: boolean;
}

export type DesignColorRole = "text" | "background" | "border";

export interface DesignColorUsage extends DesignDeclarations {
  hex: string;
  /** Total tallies across roles. */
  count: number;
  roles: Record<DesignColorRole, number>;
  pages: string[];
  /** Share of all color tallies, 0–100. */
  pct: number;
  outlier: boolean;
}

export interface DesignContrastPair {
  fg: string;
  bg: string;
  count: number;
  /** Smallest font size this pair was seen at, px. */
  minSizePx: number;
  /** WCAG 2.x contrast ratio, e.g. 4.53. */
  ratio: number;
  /** The AA threshold that applies at `minSizePx` (3 for large text, else 4.5). */
  required: number;
  passes: boolean;
  pages: string[];
}

export interface DesignRadiusUsage extends DesignDeclarations {
  /** "8px", "9999px (full)" style label. */
  value: string;
  count: number;
  pages: string[];
  outlier: boolean;
}

export interface DesignSpacingUsage extends DesignDeclarations {
  px: number;
  count: number;
  pages: string[];
  /**
   * True when the value sits off the 4px grid — and, on a Tailwind site, off
   * Tailwind's default spacing scale too.
   */
  offGrid: boolean;
  /**
   * True when the value passes the one-off test the other sections badge.
   * The Design tab marks padding by grid instead; the brand kit leaves these out.
   */
  outlier: boolean;
}

export type DesignFlagSection = "typography" | "color" | "contrast" | "radius" | "spacing";

export interface DesignFlag {
  section: DesignFlagSection;
  severity: "warn" | "info";
  message: string;
}

/** A category a class string can hand-type as an arbitrary value. */
export type DesignHandTypedCategory = "color" | "fontSize" | "radius" | "spacing";

/** What the class names say about how the site is styled. */
export interface DesignSystemSignals {
  /** Tailwind utilities run through the class names, so its spacing scale is on-grid. */
  tailwind: boolean;
  /** Root font size, px — Tailwind's scale is in rem. */
  remPx: number;
  /**
   * Per category, declarations measured and how many hand-typed an arbitrary
   * value rather than drawing on a theme token. Zero declarations when no
   * scan measured them.
   */
  handTyped: Record<DesignHandTypedCategory, { declarations: number; handTyped: number }>;
}

export interface DesignPageScan {
  path: string;
  scannedAt: number;
  elements: number;
}

export interface PolishdDesignData {
  ready: boolean;
  /** Pages with a scan, newest first. */
  pages: DesignPageScan[];
  fonts: DesignFontUsage[];
  /** Distinct font families, most used first. */
  families: { family: string; count: number }[];
  colors: DesignColorUsage[];
  contrast: DesignContrastPair[];
  radii: DesignRadiusUsage[];
  spacing: DesignSpacingUsage[];
  flags: DesignFlag[];
  /** Absent on data shaped before class names were read. */
  system?: DesignSystemSignals;
}

export const EMPTY_DESIGN_DATA: PolishdDesignData = {
  ready: false,
  pages: [],
  fonts: [],
  families: [],
  colors: [],
  contrast: [],
  radii: [],
  spacing: [],
  flags: [],
};

// ── Color math ───────────────────────────────────────────────────────────────

function rgbOf(hex: string): [number, number, number] | null {
  const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  if (!m) return null;
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

/** WCAG 2.x relative luminance. */
function luminance(hex: string): number | null {
  const rgb = rgbOf(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio between two hex colors, or null if unparseable. */
export function contrastRatio(a: string, b: string): number | null {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return null;
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

// ── Aggregation ──────────────────────────────────────────────────────────────

function toNum(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** A tuple's declaration tail as a merge part; an old scan's tuple has none. */
function declPart(tail: Partial<DesignDeclTail>): DeclarationPart {
  const [declarations, handTyped, ids] = tail;
  return { declarations, handTyped, ids };
}

/** Declaration and hand-typed totals across a section's values. */
function handTypedTotals(values: DesignDeclarations[]): { declarations: number; handTyped: number } {
  let declarations = 0;
  let handTyped = 0;
  for (const v of values) {
    declarations += v.declarations ?? 0;
    handTyped += v.handTyped ?? 0;
  }
  return { declarations, handTyped };
}

/**
 * Tailwind runs through the class names when a good share of the distinct
 * class strings carry its utilities — enough that a stray `p-2` from some
 * other library doesn't count.
 */
const TAILWIND_MIN_CLASSES = 8;
const TAILWIND_MIN_SHARE = 0.3;

interface PageScanRow {
  path: string;
  ts: number;
  payload: PolishdDesignScanPayload;
}

/** Latest parseable scan per page, newest first. */
async function loadPageScans(): Promise<PageScanRow[]> {
  const rows = await query(
    `SELECT path, ts, meta FROM ${polishdEventsSource()}
     WHERE type = 'design_scan'
     ORDER BY id DESC
     LIMIT 300`,
  );
  const byPath = new Map<string, PageScanRow>();
  for (const r of rows) {
    const path = r.path as string;
    if (byPath.has(path)) continue; // newest wins (rows are id DESC)
    const meta = parseMeta(r.meta);
    const raw = meta && typeof meta.payload === "string" ? meta.payload : null;
    if (!raw) continue;
    try {
      const payload = JSON.parse(raw) as PolishdDesignScanPayload;
      if (payload?.v !== 1 || !Array.isArray(payload.fonts)) continue;
      byPath.set(path, { path, ts: toNum(r.ts), payload });
    } catch {
      // A clipped or malformed payload is dropped, never fatal.
    }
  }
  return [...byPath.values()].sort((a, b) => b.ts - a.ts);
}

/**
 * Build the full design dataset: merge per-page tallies site-wide, then run
 * the deterministic checks. Read-only; degrades to `EMPTY_DESIGN_DATA`.
 */
export async function getDesignData(): Promise<PolishdDesignData> {
  if (!(await storeReady())) return EMPTY_DESIGN_DATA;
  const scans = await loadPageScans();
  if (scans.length === 0) return { ...EMPTY_DESIGN_DATA, ready: true };

  // fonts: family|size|weight → merged usage
  const fonts = new Map<
    string,
    {
      family: string;
      sizePx: number;
      weight: number;
      count: number;
      sample: string;
      tags: Set<string>;
      pages: Set<string>;
      decls: DeclarationPart[];
    }
  >();
  // colors: hex → role tallies
  const colors = new Map<
    string,
    { count: number; roles: Record<DesignColorRole, number>; pages: Set<string>; decls: DeclarationPart[] }
  >();
  const pairs = new Map<
    string,
    { fg: string; bg: string; count: number; minSizePx: number; pages: Set<string> }
  >();
  const radii = new Map<string, { count: number; pages: Set<string>; decls: DeclarationPart[] }>();
  const spacing = new Map<number, { count: number; pages: Set<string>; decls: DeclarationPart[] }>();
  let twClasses = 0;
  let classes = 0;
  const rems = new Map<number, number>();

  const addColor = (hex: string, role: DesignColorRole, count: number, page: string, decl: DeclarationPart) => {
    // Palette ignores alpha variants' suffix so #ffffff and #ffffffcc merge
    // visually apart — keep them distinct only when fully opaque differs.
    let c = colors.get(hex);
    if (!c) {
      colors.set(hex, (c = { count: 0, roles: { text: 0, background: 0, border: 0 }, pages: new Set(), decls: [] }));
    }
    c.count += count;
    c.roles[role] += count;
    c.pages.add(page);
    c.decls.push(decl);
  };

  for (const scan of scans) {
    const p = scan.payload;
    const page = scan.path;

    for (const [family, sizePx, weight, count, sample, tags, ...tail] of p.fonts) {
      if (typeof family !== "string" || !Number.isFinite(sizePx) || !Number.isFinite(count)) continue;
      const key = `${family}|${sizePx}|${weight}`;
      let f = fonts.get(key);
      if (!f) {
        fonts.set(
          key,
          (f = { family, sizePx, weight, count: 0, sample: "", tags: new Set(), pages: new Set(), decls: [] }),
        );
      }
      f.count += count;
      f.pages.add(page);
      f.decls.push(declPart(tail));
      if (!f.sample && typeof sample === "string") f.sample = sample;
      if (typeof tags === "string") {
        for (const t of tags.split(",")) if (t && f.tags.size < 6) f.tags.add(t);
      }
    }

    const roleLists: [DesignColorTuple[], DesignColorRole][] = [
      [p.text ?? [], "text"],
      [p.bg ?? [], "background"],
      [p.border ?? [], "border"],
    ];
    for (const [list, role] of roleLists) {
      for (const [hex, count, ...tail] of list) {
        if (typeof hex !== "string" || !hex.startsWith("#")) continue;
        addColor(hex.toLowerCase(), role, toNum(count), page, declPart(tail));
      }
    }

    for (const [fg, bg, count, minSizePx] of p.pairs ?? []) {
      if (typeof fg !== "string" || typeof bg !== "string") continue;
      const key = `${fg}|${bg}`;
      let pr = pairs.get(key);
      if (!pr) pairs.set(key, (pr = { fg: fg.toLowerCase(), bg: bg.toLowerCase(), count: 0, minSizePx: Infinity, pages: new Set() }));
      pr.count += toNum(count);
      if (Number.isFinite(minSizePx) && minSizePx < pr.minSizePx) pr.minSizePx = minSizePx;
      pr.pages.add(page);
    }

    for (const [value, count, ...tail] of p.radii ?? []) {
      if (typeof value !== "string") continue;
      let rd = radii.get(value);
      if (!rd) radii.set(value, (rd = { count: 0, pages: new Set(), decls: [] }));
      rd.count += toNum(count);
      rd.pages.add(page);
      rd.decls.push(declPart(tail));
    }

    for (const [px, count, ...tail] of p.pad ?? []) {
      if (!Number.isFinite(px)) continue;
      let sp = spacing.get(px);
      if (!sp) spacing.set(px, (sp = { count: 0, pages: new Set(), decls: [] }));
      sp.count += toNum(count);
      sp.pages.add(page);
      sp.decls.push(declPart(tail));
    }

    if (Array.isArray(p.tw)) {
      twClasses += toNum(p.tw[0]);
      classes += toNum(p.tw[1]);
    }
    const rem = toNum(p.rem);
    if (rem > 0) rems.set(rem, (rems.get(rem) ?? 0) + 1);
  }

  // ── Shape + outlier marking ────────────────────────────────────────────────

  const tailwind = twClasses >= TAILWIND_MIN_CLASSES && twClasses / Math.max(classes, 1) >= TAILWIND_MIN_SHARE;
  // The root size most pages render at; Tailwind's scale is measured in it.
  const remPx = [...rems.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 16;

  // With only a handful of measured elements, everything is statistically a
  // one-off — the badge means nothing until there's enough signal to compare
  // against, so outlier marking waits for a minimum sample per section
  // (ONE_OFF_RULES). Past that, a one-off is a value decided once, on one
  // page, that the page doesn't lean on — the kind of stray 17px that makes a
  // type scale incoherent.
  const fontShaped = [...fonts.values()].map((f) => ({ ...f, ...mergeDeclarations(f.decls), pages: [...f.pages] }));
  const fontTotals = sectionTotals(fontShaped);
  const fontList: DesignFontUsage[] = fontShaped
    .sort((a, b) => b.count - a.count)
    .map((f) => ({
      family: f.family,
      sizePx: f.sizePx,
      weight: f.weight,
      count: f.count,
      declarations: f.declarations,
      handTyped: f.handTyped,
      sample: f.sample || null,
      tags: [...f.tags],
      pages: f.pages,
      outlier: isOneOff(f, fontTotals, ONE_OFF_RULES.font),
    }));

  const familyTally = new Map<string, number>();
  for (const f of fontList) familyTally.set(f.family, (familyTally.get(f.family) ?? 0) + f.count);
  const families = [...familyTally.entries()]
    .map(([family, count]) => ({ family, count }))
    .sort((a, b) => b.count - a.count);

  const colorShaped = [...colors.entries()].map(([hex, c]) => ({
    hex,
    ...c,
    ...mergeDeclarations(c.decls),
    pages: [...c.pages],
  }));
  const colorTotals = sectionTotals(colorShaped);
  const colorList: DesignColorUsage[] = colorShaped
    .sort((a, b) => b.count - a.count)
    .map((c) => ({
      hex: c.hex,
      count: c.count,
      declarations: c.declarations,
      handTyped: c.handTyped,
      roles: c.roles,
      pages: c.pages,
      pct: colorTotals.count > 0 ? Math.round((c.count / colorTotals.count) * 1000) / 10 : 0,
      outlier: isOneOff(c, colorTotals, ONE_OFF_RULES.color),
    }));

  const contrast: DesignContrastPair[] = [...pairs.values()]
    .map((pr) => {
      const ratio = contrastRatio(pr.fg, pr.bg);
      if (ratio === null) return null;
      const minSizePx = Number.isFinite(pr.minSizePx) ? pr.minSizePx : 16;
      // WCAG AA: 3.0 for large text (≥24px, or ≥18.66px bold — we lack the
      // bold flag post-merge, so use the conservative 24px cut), else 4.5.
      const required = minSizePx >= 24 ? 3 : 4.5;
      return {
        fg: pr.fg,
        bg: pr.bg,
        count: pr.count,
        minSizePx,
        ratio,
        required,
        passes: ratio >= required,
        pages: [...pr.pages],
      };
    })
    .filter((p): p is DesignContrastPair => p !== null)
    .sort((a, b) => Number(a.passes) - Number(b.passes) || a.ratio - b.ratio);

  const radiusShaped = [...radii.entries()].map(([value, r]) => ({
    value,
    count: r.count,
    ...mergeDeclarations(r.decls),
    pages: [...r.pages],
  }));
  const radiusTotals = sectionTotals(radiusShaped);
  const radiusList: DesignRadiusUsage[] = radiusShaped
    .sort((a, b) => b.count - a.count)
    .map((r) => ({
      ...r,
      outlier: r.value !== "full" && isOneOff(r, radiusTotals, ONE_OFF_RULES.radius),
    }));

  // The grid is 4px — plus, on a Tailwind site, Tailwind's own half steps.
  const spacingShaped = [...spacing.entries()].map(([px, s]) => ({
    px,
    count: s.count,
    ...mergeDeclarations(s.decls),
    pages: [...s.pages],
  }));
  const spacingTotals = sectionTotals(spacingShaped);
  const spacingList: DesignSpacingUsage[] = spacingShaped
    .sort((a, b) => b.count - a.count)
    .map((s) => ({
      ...s,
      offGrid: isOffGrid(s.px, { tailwind, remPx }),
      outlier: isOneOff(s, spacingTotals, ONE_OFF_RULES.spacing),
    }));

  const data: PolishdDesignData = {
    ready: true,
    pages: scans.map((s) => ({ path: s.path, scannedAt: s.ts, elements: s.payload.el })),
    fonts: fontList,
    families,
    colors: colorList.slice(0, 64),
    contrast,
    radii: radiusList,
    spacing: spacingList,
    flags: [],
    system: {
      tailwind,
      remPx,
      handTyped: {
        color: handTypedTotals(colorList),
        fontSize: handTypedTotals(fontList),
        radius: handTypedTotals(radiusList),
        spacing: handTypedTotals(spacingList),
      },
    },
  };
  data.flags = buildDesignFlags(data);
  return data;
}
