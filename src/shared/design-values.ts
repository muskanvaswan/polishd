/**
 * Polishd — naming a measured design value, and framing a picture of it.
 *
 * The Design tab flags values that break the system (a one-off 17px type
 * style, a stray #fafafa, a 7px padding). A flag alone says *what*; a picture
 * of the element carrying it says *where*. Those pictures are shot while a
 * site snapshot is captured (see server/value-previews.ts), and this module
 * holds the pure pieces both ends of that agree on:
 *
 *   • **Keys.** One string per value — `font:Inter|17|500`, `color:#fafafa`,
 *     `radius:6px`, `spacing:7` — so a preview shot at capture time can be
 *     found again from the row the dashboard renders.
 *   • **Targets.** Which values are worth picturing: the ones flagged one-off
 *     or off-grid. Every other value is the system working as intended.
 *   • **Framing.** The crop around a located element: wide enough to show the
 *     component it sits in, never so wide the element disappears.
 *
 * Pure: no DOM, no store, no React — the test file pins the edge cases.
 */
import type { PolishdDesignData } from "../server/design";

/** The identity of one measured value, as the design scan tallies it. */
export type DesignValueRef =
  | { kind: "font"; family: string; sizePx: number; weight: number }
  | { kind: "color"; hex: string; roles: ("text" | "background" | "border")[] }
  | { kind: "radius"; value: string }
  | { kind: "spacing"; px: number };

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

/** Off-grid paddings pictured per capture, most used first. */
const MAX_SPACING_TARGETS = 8;
/** Hard cap on values pictured per capture, bounding its extra screenshots. */
export const MAX_PREVIEW_TARGETS = 48;

/**
 * The values worth a picture: every one-off font, color and radius, plus the
 * most used off-grid paddings. One-offs come first so a site drowning in
 * off-grid spacing still gets its one-offs pictured under the cap.
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
  const offGrid = data.spacing
    .filter((s) => s.offGrid)
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_SPACING_TARGETS);
  for (const s of offGrid) {
    refs.push({ ref: { kind: "spacing", px: s.px }, pages: s.pages });
  }
  return refs
    .slice(0, MAX_PREVIEW_TARGETS)
    .map(({ ref, pages }) => ({ key: designValueKey(ref), ref, pages }));
}

// ── Framing ──────────────────────────────────────────────────────────────────

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Context kept around the element on every side, in CSS px. */
const CONTEXT_PX = 40;
/** Crops come out 16:10 — the hover card's shape — unless the viewport can't fit it. */
const ASPECT = 1.6;
/** Small elements still get a component's worth of surroundings. */
const MIN_WIDTH = 360;

/**
 * The clip to screenshot for an element at `el` (viewport coordinates, after
 * it was scrolled into view): the element plus context, grown to 16:10,
 * centered on the element's visible part and kept inside the viewport.
 * Null when no part of the element is on screen — a drawer parked off-canvas,
 * say — since a crop of whatever sits there instead would be a lie.
 */
export function previewClip(el: Box, viewport: { width: number; height: number }): Box | null {
  const vw = Math.floor(viewport.width);
  const vh = Math.floor(viewport.height);
  if (vw <= 0 || vh <= 0 || el.width <= 0 || el.height <= 0) return null;

  // The part of the element actually on screen.
  const left = Math.max(el.x, 0);
  const top = Math.max(el.y, 0);
  const right = Math.min(el.x + el.width, vw);
  const bottom = Math.min(el.y + el.height, vh);
  if (right <= left || bottom <= top) return null;

  let width = right - left + CONTEXT_PX * 2;
  let height = bottom - top + CONTEXT_PX * 2;
  if (width / height < ASPECT) width = height * ASPECT;
  else height = width / ASPECT;
  if (width < MIN_WIDTH) {
    width = MIN_WIDTH;
    height = MIN_WIDTH / ASPECT;
  }
  width = Math.min(Math.ceil(width), vw);
  height = Math.min(Math.ceil(height), vh);

  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const x = Math.min(Math.max(Math.round(cx - width / 2), 0), vw - width);
  const y = Math.min(Math.max(Math.round(cy - height / 2), 0), vh - height);
  return { x, y, width, height };
}
