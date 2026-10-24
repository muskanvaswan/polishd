/**
 * Polishd — naming a measured design value, and framing a picture of it.
 *
 * The Design tab flags values that break the system (a one-off 17px type
 * style, a stray #fafafa, a 7px padding). A flag alone says *what*; a picture
 * of the element carrying it says *where*. Those pictures are shot while a
 * site snapshot is captured (capture/core.ts shoots and frames them), and this module
 * holds the pure pieces both ends of that agree on:
 *
 *   • **Keys.** One string per value — `font:Inter|17|500`, `color:#fafafa`,
 *     `radius:6px`, `spacing:7` — so a preview shot at capture time can be
 *     found again from the row the dashboard renders.
 *   • **Targets.** Which values are worth picturing: the ones flagged one-off
 *     or off-grid. Every other value is the system working as intended.
 *   • **Rules.** What earns those flags. A one-off is a *decision*, not a
 *     rare rendered value: a badge class repeated down a table is one
 *     declaration, however many rows render it. And a value on the
 *     framework's own spacing scale (Tailwind's 6px `1.5` step) is on-grid
 *     even though it isn't a multiple of 4.
 *
 * Pure: no DOM, no store, no React — the test file pins the edge cases.
 */
import type { DesignValueRef } from "../capture/protocol";
import type { PolishdDesignData } from "../server/design";

/** The identity of one measured value, as the design scan tallies it. */
export type { DesignValueRef };

/** A value to picture at capture time, and the pages it was measured on. */
export interface DesignPreviewTarget {
  key: string;
  ref: DesignValueRef;
  pages: string[];
}

/** A stable key per value. Colors key on the hex alone, whatever the roles. */
export function designValueKey(ref: DesignValueRef): string {
  switch (ref.kind) {
    case "font":
      return `font:${ref.family}|${ref.sizePx}|${ref.weight}`;
    case "color":
      return `color:${ref.hex.toLowerCase()}`;
    case "radius":
      return `radius:${ref.value}`;
    case "spacing":
      return `spacing:${ref.px}`;
  }
}

/** Hard cap on values pictured per capture, bounding its extra screenshots. */
export const MAX_PREVIEW_TARGETS = 64;

/**
 * The values worth a picture: every value the Design tab flags — each
 * one-off font, color and radius, and each off-grid padding, most used
 * first. One-offs come first so a site drowning in off-grid spacing still
 * gets its one-offs pictured under the cap.
 */
export function designPreviewTargets(data: PolishdDesignData): DesignPreviewTarget[] {
  const refs: { ref: DesignValueRef; pages: string[] }[] = [];
  for (const f of data.fonts) {
    if (!f.outlier) continue;
    refs.push({
      ref: { kind: "font", family: f.family, sizePx: f.sizePx, weight: f.weight },
      pages: f.pages,
    });
  }
  for (const c of data.colors) {
    if (!c.outlier) continue;
    const roles = (["text", "background", "border"] as const).filter((r) => c.roles[r] > 0);
    refs.push({ ref: { kind: "color", hex: c.hex, roles: [...roles] }, pages: c.pages });
  }
  for (const r of data.radii) {
    if (!r.outlier) continue;
    refs.push({ ref: { kind: "radius", value: r.value }, pages: r.pages });
  }
  const offGrid = data.spacing.filter((s) => s.offGrid).sort((a, b) => b.count - a.count);
  for (const s of offGrid) {
    refs.push({ ref: { kind: "spacing", px: s.px }, pages: s.pages });
  }
  return refs
    .slice(0, MAX_PREVIEW_TARGETS)
    .map(({ ref, pages }) => ({ key: designValueKey(ref), ref, pages }));
}

/**
 * Why a flagged value has no picture yet, so its card can say something
 * true. A value measured only on Polishd's dashboard pseudo-pages
 * (`/~polishd/<tab>`, what an install reading dashboard telemetry measures)
 * is only pictured by a local capture, which can open the dashboard — a
 * production capture never shoots it. One measured on pages the latest
 * snapshot didn't shoot needs those pages captured, and another identical
 * capture won't help; nor will it for a value past the per-capture cap on
 * pictures (`targeted` false).
 */
export function unpicturedReason(
  pages: string[],
  shotRoutes: string[] | null,
  targeted = true,
): "dashboard_only" | "not_targeted" | "not_shot" | "capture" {
  const shotHere = (p: string) => shotRoutes?.includes(p) ?? false;
  if (pages.length > 0 && pages.every((p) => p.startsWith("/~")) && !pages.some(shotHere)) {
    return "dashboard_only";
  }
  if (!targeted) return "not_targeted";
  if (shotRoutes && pages.length > 0 && !pages.some((p) => shotRoutes.includes(p))) return "not_shot";
  return "capture";
}

// ── Declarations ─────────────────────────────────────────────────────────────

/**
 * One page's declarations for a value, as its scan tuple carries them: how
 * many distinct declarations rendered it, how many of those hand-typed it,
 * and up to a few of their ids (`!`-prefixed when hand-typed). Absent counts
 * mean a scan from before declarations were measured.
 */
export interface DeclarationPart {
  declarations?: unknown;
  handTyped?: unknown;
  ids?: unknown;
}

/** A value's declarations site-wide. Empty when any page's scan predates them. */
export interface DeclarationCount {
  declarations?: number;
  handTyped?: number;
}

/**
 * Merge one value's declarations across pages. Ids dedupe a class shared by
 * several pages into one declaration. When a page had more declarations than
 * ids it could send, the count can only be bounded from below — by then the
 * value is declared all over and the exact number no longer matters.
 */
export function mergeDeclarations(parts: DeclarationPart[]): DeclarationCount {
  const ids = new Map<string, boolean>();
  let complete = true;
  let floor = 0;
  let handFloor = 0;
  for (const part of parts) {
    const declared = part.declarations;
    if (typeof declared !== "number" || !Number.isFinite(declared)) return {};
    const list = typeof part.ids === "string" ? part.ids.split(" ").filter(Boolean) : [];
    for (const raw of list) {
      const hand = raw.startsWith("!");
      const id = hand ? raw.slice(1) : raw;
      ids.set(id, hand || ids.get(id) === true);
    }
    if (list.length < declared) complete = false;
    floor = Math.max(floor, declared);
    if (typeof part.handTyped === "number" && Number.isFinite(part.handTyped)) {
      handFloor = Math.max(handFloor, part.handTyped);
    }
  }
  if (parts.length === 0) return {};
  const hand = [...ids.values()].filter(Boolean).length;
  if (complete) return { declarations: ids.size, handTyped: hand };
  return { declarations: Math.max(ids.size, floor), handTyped: Math.max(hand, handFloor) };
}

// ── One-offs ─────────────────────────────────────────────────────────────────

export interface OneOffRule {
  /** Uses a section needs before anything in it can be called rare. */
  minCount: number;
  /** Share of the section's declarations a one-off stays within. */
  share: number;
}

/**
 * Per section. The use gates and shares are the ones the Design tab has
 * always applied; what they count changed from rendered elements to
 * declarations.
 */
export const ONE_OFF_RULES = {
  font: { minCount: 60, share: 0.015 },
  color: { minCount: 120, share: 0.005 },
  radius: { minCount: 20, share: 0.02 },
  spacing: { minCount: 40, share: 0.02 },
} as const satisfies Record<string, OneOffRule>;

/**
 * Share of a section's uses past which a value is part of what the page is
 * built from, however few declarations produced it — a body text color set
 * once on `<body>` is one declaration and half the page.
 */
export const DOMINANT_SHARE = 0.05;

export interface ValueUsage {
  count: number;
  declarations?: number;
  pages: string[];
}

/** A section's uses, and its declarations when every value carries them. */
export interface SectionTotals {
  count: number;
  declarations?: number;
}

export function sectionTotals(values: { count: number; declarations?: number }[]): SectionTotals {
  let count = 0;
  let declarations: number | undefined = 0;
  for (const v of values) {
    count += v.count;
    declarations = declarations === undefined || v.declarations === undefined ? undefined : declarations + v.declarations;
  }
  return { count, declarations };
}

/**
 * Whether a value is a one-off: decided once (or within a sliver of the
 * section's declarations), on one page, and not something the page leans on.
 * Nothing is rare until the section has enough uses to compare against.
 * Scans from before declarations were measured keep the old reading, where
 * every use counted as its own decision.
 */
export function isOneOff(v: ValueUsage, totals: SectionTotals, rule: OneOffRule): boolean {
  if (totals.count < rule.minCount || v.pages.length !== 1) return false;
  if (totals.declarations === undefined || v.declarations === undefined) {
    return v.count <= Math.max(2, totals.count * rule.share);
  }
  return (
    v.declarations <= Math.max(1, totals.declarations * rule.share) &&
    v.count <= Math.max(2, totals.count * DOMINANT_SHARE)
  );
}

// ── Spacing grid ─────────────────────────────────────────────────────────────

/**
 * Tailwind's default spacing scale, in its own units of 0.25rem: half steps
 * up to 3.5, whole steps to 12, then wider ones. `px` (1px) sits beside it.
 */
const TAILWIND_SPACING_UNITS = [
  0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52,
  56, 60, 64, 72, 80, 96,
];

/** How a site's spacing is meant to be measured. */
export interface SpacingScale {
  /** Tailwind styles the site, so its default scale is on-grid. */
  tailwind: boolean;
  /** The root font size, px — Tailwind's scale is in rem. */
  remPx: number;
}

/** Tailwind's spacing scale in whole pixels at a root font size. */
export function tailwindSpacingPx(remPx = 16): Set<number> {
  const out = new Set<number>([1]);
  for (const unit of TAILWIND_SPACING_UNITS) out.add(Math.round((unit * remPx) / 4));
  return out;
}

/**
 * Off-grid: neither on the 4px grid nor, on a Tailwind site, on Tailwind's
 * default scale — whose 2px, 6px, 10px and 14px half steps are deliberate.
 */
export function isOffGrid(px: number, scale?: SpacingScale): boolean {
  if (px % 4 === 0) return false;
  return !(scale?.tailwind && tailwindSpacingPx(scale.remPx).has(px));
}
