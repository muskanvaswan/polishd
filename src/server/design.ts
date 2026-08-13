/**
 * Polishd — design metrics aggregation (server only).
 *
 * Merges the latest `design_scan` per page into one site-wide picture: the
 * typography actually in use, the color palette as rendered, the radius and
 * spacing scales — a brand guideline reverse-engineered from the built site.
 *
 * The second half is deterministic review: rule-based checks against widely
 * accepted UI practice (a bounded type scale, one or two families, a palette
 * without near-duplicates, WCAG contrast, spacing on a grid). These produce
 * `flags` — no model involved — and both the metrics and the flags feed the
 * AI design review in ai/design.ts.
 */
import { defaultPolishdConfig } from "../config";
import type {
  DesignColorTuple,
  PolishdDesignScanPayload,
} from "../shared/types";
import { parseMeta, query, storeReady } from "./store";

// Same dashboard-route exclusion the analytics queries use; duplicated as a
// tiny helper because queries.ts keeps its `EVENTS` fragment module-private.
const EVENTS = (() => {
  const route = defaultPolishdConfig.dashboardRoute.replace(/\/+$/, "");
  if (!route) return "events";
  const literal = `'${route.replace(/'/g, "''")}'`;
  const prefix = `'${`${route}/`.replace(/'/g, "''")}'`;
  return `(SELECT * FROM events
     WHERE path <> ${literal}
       AND substr(path, 1, ${route.length + 1}) <> ${prefix}) AS events`;
})();

// ── Aggregated shapes (what the Design tab renders) ──────────────────────────

export interface DesignFontUsage {
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

export interface DesignColorUsage {
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

export interface DesignRadiusUsage {
  /** "8px", "9999px (full)" style label. */
  value: string;
  count: number;
  pages: string[];
  outlier: boolean;
}

export interface DesignSpacingUsage {
  px: number;
  count: number;
  pages: string[];
  /** True when the value sits off the site's dominant spacing grid. */
  offGrid: boolean;
}

export type DesignFlagSection = "typography" | "color" | "contrast" | "radius" | "spacing";

export interface DesignFlag {
  section: DesignFlagSection;
  severity: "warn" | "info";
  message: string;
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

/** Euclidean RGB distance — crude but plenty to catch #fefefe vs #ffffff. */
function colorDistance(a: string, b: string): number | null {
  const ra = rgbOf(a);
  const rb = rgbOf(b);
  if (!ra || !rb) return null;
  return Math.sqrt((ra[0] - rb[0]) ** 2 + (ra[1] - rb[1]) ** 2 + (ra[2] - rb[2]) ** 2);
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

interface PageScanRow {
  path: string;
  ts: number;
  payload: PolishdDesignScanPayload;
}

/** Latest parseable scan per page, newest first. */
async function loadPageScans(): Promise<PageScanRow[]> {
  const rows = await query(
    `SELECT path, ts, meta FROM ${EVENTS}
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
    { family: string; sizePx: number; weight: number; count: number; sample: string; tags: Set<string>; pages: Set<string> }
  >();
  // colors: hex → role tallies
  const colors = new Map<
    string,
    { count: number; roles: Record<DesignColorRole, number>; pages: Set<string> }
  >();
  const pairs = new Map<
    string,
    { fg: string; bg: string; count: number; minSizePx: number; pages: Set<string> }
  >();
  const radii = new Map<string, { count: number; pages: Set<string> }>();
  const spacing = new Map<number, { count: number; pages: Set<string> }>();

  const addColor = (hex: string, role: DesignColorRole, count: number, page: string) => {
    // Palette ignores alpha variants' suffix so #ffffff and #ffffffcc merge
    // visually apart — keep them distinct only when fully opaque differs.
    let c = colors.get(hex);
    if (!c) colors.set(hex, (c = { count: 0, roles: { text: 0, background: 0, border: 0 }, pages: new Set() }));
    c.count += count;
    c.roles[role] += count;
    c.pages.add(page);
  };

  for (const scan of scans) {
    const p = scan.payload;
    const page = scan.path;

    for (const [family, sizePx, weight, count, sample, tags] of p.fonts) {
      if (typeof family !== "string" || !Number.isFinite(sizePx) || !Number.isFinite(count)) continue;
      const key = `${family}|${sizePx}|${weight}`;
      let f = fonts.get(key);
      if (!f) {
        fonts.set(key, (f = { family, sizePx, weight, count: 0, sample: "", tags: new Set(), pages: new Set() }));
      }
      f.count += count;
      f.pages.add(page);
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
      for (const [hex, count] of list) {
        if (typeof hex !== "string" || !hex.startsWith("#")) continue;
        addColor(hex.toLowerCase(), role, toNum(count), page);
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

    for (const [value, count] of p.radii ?? []) {
      if (typeof value !== "string") continue;
      let rd = radii.get(value);
      if (!rd) radii.set(value, (rd = { count: 0, pages: new Set() }));
      rd.count += toNum(count);
      rd.pages.add(page);
    }

    for (const [px, count] of p.pad ?? []) {
      if (!Number.isFinite(px)) continue;
      let sp = spacing.get(px);
      if (!sp) spacing.set(px, (sp = { count: 0, pages: new Set() }));
      sp.count += toNum(count);
      sp.pages.add(page);
    }
  }

  // ── Shape + outlier marking ────────────────────────────────────────────────

  const totalFontTally = [...fonts.values()].reduce((s, f) => s + f.count, 0);
  // With only a handful of measured elements, everything is statistically a
  // one-off — the badge means nothing until there's enough signal to compare
  // against, so outlier marking waits for a minimum sample per section.
  const fontSignal = totalFontTally >= 60;
  const fontList: DesignFontUsage[] = [...fonts.values()]
    .sort((a, b) => b.count - a.count)
    .map((f) => ({
      family: f.family,
      sizePx: f.sizePx,
      weight: f.weight,
      count: f.count,
      sample: f.sample || null,
      tags: [...f.tags],
      pages: [...f.pages],
      // A combination carrying under ~1.5% of all text, on one page only, is a
      // one-off — the kind of stray 17px that makes a type scale incoherent.
      outlier:
        fontSignal && f.count <= Math.max(2, totalFontTally * 0.015) && f.pages.size === 1,
    }));

  const familyTally = new Map<string, number>();
  for (const f of fontList) familyTally.set(f.family, (familyTally.get(f.family) ?? 0) + f.count);
  const families = [...familyTally.entries()]
    .map(([family, count]) => ({ family, count }))
    .sort((a, b) => b.count - a.count);

  const totalColorTally = [...colors.values()].reduce((s, c) => s + c.count, 0);
  const colorSignal = totalColorTally >= 120;
  const colorList: DesignColorUsage[] = [...colors.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([hex, c]) => ({
      hex,
      count: c.count,
      roles: c.roles,
      pages: [...c.pages],
      pct: totalColorTally > 0 ? Math.round((c.count / totalColorTally) * 1000) / 10 : 0,
      outlier: colorSignal && c.count <= Math.max(2, totalColorTally * 0.005) && c.pages.size === 1,
    }))
    .slice(0, 64);

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

  const totalRadiusTally = [...radii.values()].reduce((s, r) => s + r.count, 0);
  const radiusSignal = totalRadiusTally >= 20;
  const radiusList: DesignRadiusUsage[] = [...radii.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([value, r]) => ({
      value,
      count: r.count,
      pages: [...r.pages],
      outlier:
        radiusSignal &&
        value !== "full" &&
        r.count <= Math.max(2, totalRadiusTally * 0.02) &&
        r.pages.size === 1,
    }));

  // Dominant grid: 4px unless the site's own values say 8px.
  const spacingEntries = [...spacing.entries()].sort((a, b) => b[1].count - a[1].count);
  const spacingList: DesignSpacingUsage[] = spacingEntries.map(([px, s]) => ({
    px,
    count: s.count,
    pages: [...s.pages],
    offGrid: px % 4 !== 0,
  }));

  const data: PolishdDesignData = {
    ready: true,
    pages: scans.map((s) => ({ path: s.path, scannedAt: s.ts, elements: s.payload.el })),
    fonts: fontList,
    families,
    colors: colorList,
    contrast,
    radii: radiusList,
    spacing: spacingList,
    flags: [],
  };
  data.flags = buildDesignFlags(data);
  return data;
}

// ── Deterministic review ─────────────────────────────────────────────────────

/** Cohesion thresholds, drawn from common design-system practice. */
const LIMITS = {
  fontSizes: 8, // a considered type scale is 5–8 steps
  fontFamilies: 2, // one for UI, maybe one display/mono
  fontWeights: 4,
  colors: 24, // full palette incl. neutrals
  radii: 4, // distinct corner radii (excluding 0/full)
  spacingValues: 14,
};

/**
 * Rule-based checks over the aggregated data. Pure function of its input so
 * it's easy to test and the AI layer can quote the same findings verbatim.
 */
export function buildDesignFlags(data: PolishdDesignData): DesignFlag[] {
  const flags: DesignFlag[] = [];
  if (data.pages.length === 0) return flags;

  // Typography ---------------------------------------------------------------
  const sizes = [...new Set(data.fonts.map((f) => f.sizePx))].sort((a, b) => a - b);
  if (sizes.length > LIMITS.fontSizes) {
    flags.push({
      section: "typography",
      severity: "warn",
      message:
        `${sizes.length} distinct font sizes in use (${sizes.slice(0, 12).map((s) => `${s}px`).join(", ")}${sizes.length > 12 ? ", …" : ""}). ` +
        `Cohesive interfaces usually hold to a 5–8 step type scale; sizes 1–2px apart read as accidental.`,
    });
  }
  if (data.families.length > LIMITS.fontFamilies) {
    // A mono family for code is normal; flag only when even ignoring one
    // there are still too many.
    const nonMono = data.families.filter((f) => !/mono|courier|consolas|menlo/i.test(f.family));
    if (nonMono.length > LIMITS.fontFamilies) {
      flags.push({
        section: "typography",
        severity: "warn",
        message:
          `${data.families.length} font families detected (${data.families.map((f) => f.family).join(", ")}). ` +
          `Most coherent brands use one or two, plus a monospace for code.`,
      });
    }
  }
  const weights = [...new Set(data.fonts.map((f) => f.weight))].sort((a, b) => a - b);
  if (weights.length > LIMITS.fontWeights) {
    flags.push({
      section: "typography",
      severity: "info",
      message: `${weights.length} font weights in use (${weights.join(", ")}) — hierarchies usually need 3–4.`,
    });
  }
  const tiny = data.fonts.filter((f) => f.sizePx < 11 && f.count >= 3);
  if (tiny.length > 0) {
    flags.push({
      section: "typography",
      severity: "warn",
      message: `Text below 11px found (${[...new Set(tiny.map((t) => `${t.sizePx}px`))].join(", ")}) — hard to read on most screens.`,
    });
  }
  const oneOffs = data.fonts.filter((f) => f.outlier);
  if (oneOffs.length >= 3) {
    flags.push({
      section: "typography",
      severity: "info",
      message: `${oneOffs.length} one-off type styles appear on a single page each — candidates to fold into the scale.`,
    });
  }

  // Color ----------------------------------------------------------------------
  const opaque = data.colors.filter((c) => c.hex.length === 7);
  if (opaque.length > LIMITS.colors) {
    flags.push({
      section: "color",
      severity: "warn",
      message: `${opaque.length} distinct colors rendered site-wide — palettes past ~${LIMITS.colors} usually mean drifted one-off values rather than a system.`,
    });
  }
  // Near-duplicates among the meaningfully used colors.
  const used = opaque.filter((c) => c.count >= 3).slice(0, 32);
  const dupes: string[] = [];
  for (let i = 0; i < used.length; i++) {
    for (let j = i + 1; j < used.length; j++) {
      const d = colorDistance(used[i].hex, used[j].hex);
      if (d !== null && d > 0 && d < 10) dupes.push(`${used[i].hex} ≈ ${used[j].hex}`);
    }
  }
  if (dupes.length > 0) {
    flags.push({
      section: "color",
      severity: "warn",
      message: `Near-duplicate colors: ${dupes.slice(0, 4).join("; ")}${dupes.length > 4 ? ` (+${dupes.length - 4} more)` : ""} — likely meant to be the same token.`,
    });
  }

  // Contrast -------------------------------------------------------------------
  const failing = data.contrast.filter((p) => !p.passes && p.count >= 2);
  for (const p of failing.slice(0, 5)) {
    flags.push({
      section: "contrast",
      severity: "warn",
      message:
        `${p.fg} text on ${p.bg} is ${p.ratio}:1 at ${p.minSizePx}px — below the WCAG AA ${p.required}:1 minimum` +
        ` (seen on ${p.pages.slice(0, 2).join(", ")}${p.pages.length > 2 ? ", …" : ""}).`,
    });
  }

  // Radius ----------------------------------------------------------------------
  const distinctRadii = data.radii.filter((r) => r.value !== "full" && !r.value.includes("mixed"));
  if (distinctRadii.length > LIMITS.radii) {
    flags.push({
      section: "radius",
      severity: "warn",
      message:
        `${distinctRadii.length} distinct corner radii (${distinctRadii.slice(0, 8).map((r) => r.value).join(", ")}${distinctRadii.length > 8 ? ", …" : ""}) — ` +
        `most systems settle on 2–4 (e.g. small, medium, full).`,
    });
  }

  // Spacing ----------------------------------------------------------------------
  const totalPad = data.spacing.reduce((s, v) => s + v.count, 0);
  const offGrid = data.spacing.filter((v) => v.offGrid);
  const offGridShare = totalPad > 0 ? offGrid.reduce((s, v) => s + v.count, 0) / totalPad : 0;
  if (offGridShare > 0.25 && offGrid.length >= 3) {
    flags.push({
      section: "spacing",
      severity: "info",
      message:
        `${Math.round(offGridShare * 100)}% of padding values sit off a 4px grid (${offGrid.slice(0, 6).map((v) => `${v.px}px`).join(", ")}${offGrid.length > 6 ? ", …" : ""}) — ` +
        `consistent rhythm usually comes from a 4px or 8px base unit.`,
    });
  }
  if (data.spacing.length > LIMITS.spacingValues) {
    flags.push({
      section: "spacing",
      severity: "info",
      message: `${data.spacing.length} distinct padding values in use — a spacing scale of 6–10 steps covers most interfaces.`,
    });
  }

  return flags;
}
