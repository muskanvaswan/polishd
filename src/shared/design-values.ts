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
 * true. A snapshot only shoots the site's own pages: a value measured only on
 * Polishd's dashboard pseudo-pages (`/~polishd/<tab>`, what an install reading
 * dashboard telemetry measures) will never be pictured, and one measured on
 * pages the latest snapshot didn't shoot needs those pages captured — another
 * identical capture won't help. Nor will it for a value past the per-capture
 * cap on pictures (`targeted` false).
 */
export function unpicturedReason(
  pages: string[],
  shotRoutes: string[] | null,
  targeted = true,
): "dashboard_only" | "not_targeted" | "not_shot" | "capture" {
  if (pages.length > 0 && pages.every((p) => p.startsWith("/~"))) return "dashboard_only";
  if (!targeted) return "not_targeted";
  if (shotRoutes && pages.length > 0 && !pages.some((p) => shotRoutes.includes(p))) return "not_shot";
  return "capture";
}
