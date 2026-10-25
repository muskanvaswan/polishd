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
import type { PolishdDesignScanPayload } from "../shared/types";
import { aggregateDesignScans, contrastRatio, type DesignScanRow } from "./design-aggregate";
import { selectBuildScans, type DesignBuildCoverage } from "./design-builds";
import { buildDesignFlags } from "./design-flags";
import { getCurrentBuild, polishdEventsSource } from "./queries";
import { parseMeta, query, storeReady } from "./store";

export { aggregateDesignScans, buildDesignFlags, contrastRatio, selectBuildScans };
export type { DesignBuildCoverage };

// ── Aggregated shapes (what the Design tab renders) ──────────────────────────

/**
 * How a value was decided. Both are absent when any page's scan predates
 * declaration counting.
 */
export interface DesignDeclarations {
  /**
   * Distinct declarations rendering the value site-wide: class strings, or
   * for an unclassed element its tag path. A component rendered on every row
   * is one declaration. Counted from the scans that measured them; absent
   * when none did.
   */
  declarations?: number;
  /** Of those, declarations that hand-typed it as an arbitrary value (`text-[#555]`). */
  handTyped?: number;
  /**
   * Uses from scans that predate declaration counting — each weighed as its
   * own decision, the old reading. Absent when every scan measured them; only
   * then is `declarations` the whole count.
   */
  legacyUses?: number;
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
  /**
   * Background tallies on controls — buttons, links styled as them, inputs:
   * how much of this color is the site's action color. 0 where no scan
   * recorded it (scans from before it was measured).
   */
  controls?: number;
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
  /** The build the page was served from when scanned; absent when unknown. */
  build?: string;
}

export interface PolishdDesignData {
  ready: boolean;
  /** Pages with a scan, newest first. */
  pages: DesignPageScan[];
  /**
   * How the current build's scans stand, and whether only they are merged
   * (see design-builds.ts). Absent when no build has been stamped on anything.
   */
  build?: DesignBuildCoverage;
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

/**
 * The latest scan per page, newest first, with the build each was taken on.
 *
 * The newest row per path is picked in SQL rather than by reading the last
 * few hundred scans: pages now scan again on every build (and on every load
 * in development), so one busy page could otherwise fill that window and
 * push the others out of the Design tab.
 */
async function loadPageScans(): Promise<DesignScanRow[]> {
  const rows = await query(
    `SELECT path, ts, meta, build FROM ${polishdEventsSource()}
     WHERE id IN (
       SELECT MAX(id) FROM ${polishdEventsSource()}
       WHERE type = 'design_scan'
       GROUP BY path
     )`,
  );
  const scans: DesignScanRow[] = [];
  for (const r of rows) {
    const meta = parseMeta(r.meta);
    const raw = meta && typeof meta.payload === "string" ? meta.payload : null;
    if (!raw) continue;
    try {
      const payload = JSON.parse(raw) as PolishdDesignScanPayload;
      if (payload?.v !== 1 || !Array.isArray(payload.fonts)) continue;
      scans.push({
        path: r.path as string,
        ts: Number(r.ts) || 0,
        payload,
        build: typeof r.build === "string" && r.build ? r.build : null,
      });
    } catch {
      // A clipped or malformed payload is dropped, never fatal.
    }
  }
  return scans.sort((a, b) => b.ts - a.ts);
}

/** Every page the build has served: distinct paths with a page_view on it. */
async function loadPathsViewedOn(build: string): Promise<Set<string>> {
  const rows = await query(
    `SELECT DISTINCT path FROM ${polishdEventsSource({ build })} WHERE type = 'page_view'`,
  );
  return new Set(rows.map((r) => r.path as string));
}

/**
 * Build the full design dataset: pick the scans that describe the current
 * build (design-builds.ts), merge their per-page tallies site-wide, then run
 * the deterministic checks (design-aggregate.ts). Read-only; degrades to
 * `EMPTY_DESIGN_DATA`.
 */
export async function getDesignData(): Promise<PolishdDesignData> {
  if (!(await storeReady())) return EMPTY_DESIGN_DATA;
  const [latest, current] = await Promise.all([loadPageScans(), getCurrentBuild()]);
  if (latest.length === 0) return { ...EMPTY_DESIGN_DATA, ready: true };
  const viewed = current ? await loadPathsViewedOn(current.build) : new Set<string>();
  const { scans, coverage } = selectBuildScans(latest, current, viewed);
  const data = aggregateDesignScans(scans);
  return coverage ? { ...data, build: coverage } : data;
}

