/**
 * Polishd — merging per-page design scans into the site-wide picture.
 *
 * Pure: the scan rows in (whatever version of the client wrote them), the
 * Design tab's data out, flags included. server/design.ts loads the rows and
 * calls this; the test file feeds it payloads directly.
 *
 * Installs on older package versions keep reporting to the same store (and
 * the telemetry collector ingests every version at once), so every field
 * past the original shape is optional here: a scan without declaration
 * counts leaves those values' declarations unknown, and they keep the per-use
 * one-off reading; one without class-name readings is not a Tailwind site and
 * has nothing hand-typed. A malformed row is skipped, never fatal.
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
  DesignFontTuple,
  DesignPadTuple,
  DesignPairTuple,
  DesignRadiusTuple,
  PolishdDesignScanPayload,
} from "../shared/types";
import type {
  DesignColorRole,
  DesignColorUsage,
  DesignContrastPair,
  DesignDeclarations,
  DesignFontUsage,
  DesignRadiusUsage,
  DesignSpacingUsage,
  PolishdDesignData,
} from "./design";
import { buildDesignFlags } from "./design-flags";

/** One page's latest scan. */
export interface DesignScanRow {
  path: string;
  ts: number;
  payload: PolishdDesignScanPayload;
}

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

/** A payload list's tuples, skipping anything that isn't one. */
function rows<T>(list: unknown): T[] {
  return Array.isArray(list) ? (list.filter(Array.isArray) as T[]) : [];
}

// ── Aggregation ──────────────────────────────────────────────────────────────

/**
 * Merge per-page tallies site-wide, mark one-offs and the grid, then run the
 * deterministic checks.
 */
export function aggregateDesignScans(scans: DesignScanRow[]): PolishdDesignData {
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

    for (const [family, sizePx, weight, count, sample, tags, ...tail] of rows<DesignFontTuple>(p.fonts)) {
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
      [rows(p.text), "text"],
      [rows(p.bg), "background"],
      [rows(p.border), "border"],
    ];
    for (const [list, role] of roleLists) {
      for (const [hex, count, ...tail] of list) {
        if (typeof hex !== "string" || !hex.startsWith("#")) continue;
        addColor(hex.toLowerCase(), role, toNum(count), page, declPart(tail));
      }
    }

    for (const [fg, bg, count, minSizePx] of rows<DesignPairTuple>(p.pairs)) {
      if (typeof fg !== "string" || typeof bg !== "string") continue;
      const key = `${fg}|${bg}`;
      let pr = pairs.get(key);
      if (!pr) pairs.set(key, (pr = { fg: fg.toLowerCase(), bg: bg.toLowerCase(), count: 0, minSizePx: Infinity, pages: new Set() }));
      pr.count += toNum(count);
      if (Number.isFinite(minSizePx) && minSizePx < pr.minSizePx) pr.minSizePx = minSizePx;
      pr.pages.add(page);
    }

    for (const [value, count, ...tail] of rows<DesignRadiusTuple>(p.radii)) {
      if (typeof value !== "string") continue;
      let rd = radii.get(value);
      if (!rd) radii.set(value, (rd = { count: 0, pages: new Set(), decls: [] }));
      rd.count += toNum(count);
      rd.pages.add(page);
      rd.decls.push(declPart(tail));
    }

    for (const [px, count, ...tail] of rows<DesignPadTuple>(p.pad)) {
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
