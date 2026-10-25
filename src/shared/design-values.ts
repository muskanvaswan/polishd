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
 *     or off-scale. Every other value is the system working as intended.
 *   • **Rules.** What earns those flags. A one-off is rare in what renders
 *     *and* decided once: a value chosen in two places is a pattern, and a
 *     badge class repeated down a table is one declaration, however many
 *     rows render it. An off-scale value is hand-typed (`p-[13px]`) and off
 *     the 2px scale; a value from the theme is never off-scale.
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
 * one-off font, color and radius, then each off-scale font and radius, then
 * each off-scale padding, most used first. One-offs come first so a site
 * drowning in hand-typed spacing still gets its one-offs pictured under the
 * cap.
 */
export function designPreviewTargets(data: PolishdDesignData): DesignPreviewTarget[] {
  const refs: { ref: DesignValueRef; pages: string[] }[] = [];
  const fontRef = (f: PolishdDesignData["fonts"][number]): DesignValueRef => ({
    kind: "font",
    family: f.family,
    sizePx: f.sizePx,
    weight: f.weight,
  });
  for (const f of data.fonts) {
    if (f.outlier) refs.push({ ref: fontRef(f), pages: f.pages });
  }
  for (const c of data.colors) {
    if (!c.outlier) continue;
    const roles = (["text", "background", "border"] as const).filter((r) => c.roles[r] > 0);
    refs.push({ ref: { kind: "color", hex: c.hex, roles: [...roles] }, pages: c.pages });
  }
  for (const r of data.radii) {
    if (r.outlier) refs.push({ ref: { kind: "radius", value: r.value }, pages: r.pages });
  }
  for (const f of data.fonts) {
    if (f.offScale && !f.outlier) refs.push({ ref: fontRef(f), pages: f.pages });
  }
  for (const r of data.radii) {
    if (r.offScale && !r.outlier) refs.push({ ref: { kind: "radius", value: r.value }, pages: r.pages });
  }
  const offScale = data.spacing.filter((s) => s.offScale).sort((a, b) => b.count - a.count);
  for (const s of offScale) {
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
 * and up to a few of their ids (`!`-prefixed when hand-typed) — plus the
 * value's uses on that page. Absent counts mean a scan from before
 * declarations were measured.
 */
export interface DeclarationPart {
  declarations?: unknown;
  handTyped?: unknown;
  ids?: unknown;
  uses?: unknown;
}

/**
 * A value's declarations site-wide, merged per row: scans that measured them
 * contribute declarations, scans that predate them contribute their uses —
 * the old reading, where every use was its own decision.
 */
export interface DeclarationCount {
  /** From the scans that measured them; absent when none did. */
  declarations?: number;
  handTyped?: number;
  /** Uses from scans that predate declarations; absent when every scan measured them. */
  legacyUses?: number;
}

/**
 * Merge one value's declarations across pages. Ids dedupe a class shared by
 * several pages into one declaration. When a page had more declarations than
 * ids it could send, the count can only be bounded from below — by then the
 * value is declared all over and the exact number no longer matters.
 */
export function mergeDeclarations(parts: DeclarationPart[]): DeclarationCount {
  const ids = new Map<string, boolean>();
  let measured = 0;
  let legacyUses = 0;
  let complete = true;
  let floor = 0;
  let handFloor = 0;
  for (const part of parts) {
    const declared = part.declarations;
    if (typeof declared !== "number" || !Number.isFinite(declared)) {
      const uses = Number(part.uses);
      legacyUses += Number.isFinite(uses) && uses > 0 ? uses : 0;
      continue;
    }
    measured++;
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
  const out: DeclarationCount = {};
  if (measured > 0) {
    const hand = [...ids.values()].filter(Boolean).length;
    out.declarations = complete ? ids.size : Math.max(ids.size, floor);
    out.handTyped = complete ? hand : Math.max(hand, handFloor);
  }
  if (legacyUses > 0) out.legacyUses = legacyUses;
  return out;
}

/** A value's counts, as the one-off rule reads them. */
export interface ValueUsage {
  count: number;
  declarations?: number;
  legacyUses?: number;
  pages: string[];
}

// ── One-offs ─────────────────────────────────────────────────────────────────

export interface OneOffRule {
  /** Uses a section needs before anything in it can be called rare. */
  minCount: number;
  /** Share of the section's uses a one-off stays within. */
  share: number;
}

/** Per section: the gates and shares the Design tab has always applied. */
export const ONE_OFF_RULES = {
  font: { minCount: 60, share: 0.015 },
  color: { minCount: 120, share: 0.005 },
  radius: { minCount: 20, share: 0.02 },
  spacing: { minCount: 40, share: 0.02 },
} as const satisfies Record<string, OneOffRule>;

/** A section's uses — what a value's rarity is measured against. */
export interface SectionTotals {
  count: number;
}

export function sectionTotals(values: { count: number }[]): SectionTotals {
  return { count: values.reduce((sum, v) => sum + v.count, 0) };
}

/**
 * Whether a value is a one-off: rare in what the site renders — under the
 * section's share of uses, on one page — and declared exactly once. Rarity
 * is the test the Design tab has always applied; the declaration check only
 * narrows it, so a value chosen in two places is a pattern rather than a
 * stray, and repeated copies never promote anything into a one-off. It's a
 * count, not a share, so it never mixes units with anything else in the
 * section. Nothing is rare until the section has enough uses to compare
 * against.
 *
 * A value on one page comes from that page's one scan. When the scan
 * predates declarations, the per-use reading stands alone — per row, so one
 * stale page never changes how the rest of the section is read.
 */
export function isOneOff(v: ValueUsage, totals: SectionTotals, rule: OneOffRule): boolean {
  if (totals.count < rule.minCount || v.pages.length !== 1) return false;
  if (v.count > Math.max(2, totals.count * rule.share)) return false;
  return v.declarations === undefined || v.declarations <= 1;
}

// ── The 2px scale ────────────────────────────────────────────────────────────

/**
 * Hand-typed sizes are held to steps of 2px: 2, 4, 6 … 12, 14, 16. Nothing
 * is held to a 4px or 8px grid, and a value drawn from the theme (`p-1.5`,
 * `text-sm`, `rounded-md`) is never checked at all: it is the system,
 * whatever it renders as. Only an arbitrary value typed into a class
 * (`p-[13px]`, `text-[15px]`, `rounded-[5px]`) bypasses the theme, so only
 * those are measured against the scale.
 */
export const SCALE_STEP_PX = 2;

/** On the scale: a whole multiple of 2px, read to the hundredth, so 12.5px is off it. */
export function onScale(px: number): boolean {
  return Math.round(px * 100) % (SCALE_STEP_PX * 100) === 0;
}

/**
 * Off-scale: hand-typed as an arbitrary value by at least one declaration,
 * and not on the 2px scale. A site whose class names were never read has
 * nothing hand-typed, so nothing on it is off-scale.
 */
export function isOffScale(px: number, v: { handTyped?: number }): boolean {
  return (v.handTyped ?? 0) > 0 && Number.isFinite(px) && !onScale(px);
}

/** A radius label's size — "6px", "6px (mixed)" — or NaN for "full". */
export function radiusPx(value: string): number {
  return value === "full" ? NaN : parseFloat(value);
}
