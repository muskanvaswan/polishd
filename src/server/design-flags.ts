/**
 * Polishd — deterministic design review.
 *
 * Rule-based checks over the aggregated design data (server/design.ts),
 * against widely accepted UI practice: a bounded type scale, one or two
 * families, a palette without near-duplicates, WCAG contrast, and sizes that
 * come from a theme or at least a scale. They produce `flags` — no model
 * involved — and the AI design review quotes the same findings.
 *
 * Sizes aren't held to a 4px or 8px grid. What's pointed out is a font size,
 * radius or padding hand-typed as an arbitrary value (`p-[13px]`) that also
 * sits off the 2px scale (shared/design-values.ts): a value from the theme is
 * the system, and an even hand-typed one still keeps the rhythm.
 *
 * Values the owner dismissed through a review issue (design-dismissals.ts)
 * are left out of every check in their section: answered once, a finding
 * isn't raised again here either.
 *
 * Where it matters, the rules count declarations, not rendered elements: a
 * padding class repeated down a 38-row table is one decision to revisit,
 * not 38. Data from before declarations were measured falls back to uses.
 *
 * Pure: types only, no store — the test file drives it with plain objects.
 */
import type { DesignFlag, PolishdDesignData } from "./design";
import {
  colorKey,
  contrastDismissal,
  radiusKey,
  spacingKey,
  typeKey,
  type DesignDismissedValues,
} from "./design-dismissals";
import { radiusPx } from "../shared/design-values";

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
 * Hand-typed colors: past `share` of the palette's declarations, the theme is
 * mostly bypassed; past `noLayer`, there's effectively no token layer at all.
 * It takes a few declarations before a share means anything.
 */
const HAND_TYPED_COLOR = { share: 0.5, noLayer: 0.8, minDeclarations: 10 };

/** Text at or below this size, px, is too small to read on most screens. */
const TINY_TEXT_PX = 8;

function rgbOf(hex: string): [number, number, number] | null {
  const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  if (!m) return null;
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

/** Euclidean RGB distance — crude but plenty to catch #fefefe vs #ffffff. */
function colorDistance(a: string, b: string): number | null {
  const ra = rgbOf(a);
  const rb = rgbOf(b);
  if (!ra || !rb) return null;
  return Math.sqrt((ra[0] - rb[0]) ** 2 + (ra[1] - rb[1]) ** 2 + (ra[2] - rb[2]) ** 2);
}

const list = (values: string[], cap: number) =>
  `${values.slice(0, cap).join(", ")}${values.length > cap ? ", …" : ""}`;

/**
 * The hand-typed color finding, or null when the palette is mostly themed (or
 * too little was measured to say). Dismissed colors are taken out of the
 * totals as well as the list.
 */
function handTypedColorFlag(
  data: PolishdDesignData,
  colors: PolishdDesignData["colors"],
): DesignFlag | null {
  const totals = data.system?.handTyped.color;
  if (!totals) return null;
  let { declarations, handTyped } = totals;
  for (const c of data.colors) {
    if (colors.includes(c)) continue;
    declarations -= c.declarations ?? 0;
    handTyped -= c.handTyped ?? 0;
  }
  if (declarations < HAND_TYPED_COLOR.minDeclarations) return null;
  const share = handTyped / declarations;
  if (share <= HAND_TYPED_COLOR.share) return null;
  const top = colors
    .filter((c) => (c.handTyped ?? 0) > 0)
    .sort((a, b) => b.handTyped! - a.handTyped! || b.count - a.count)
    .map((c) => c.hex);
  return {
    section: "color",
    severity: "warn",
    message:
      `${Math.round(share * 100)}% of color declarations (${handTyped} of ${declarations}) are hand-typed ` +
      `arbitrary values (text-[#…], bg-[#…]) rather than theme tokens` +
      `${share >= HAND_TYPED_COLOR.noLayer ? " — there is no color token layer" : " — most colors bypass the theme"}` +
      `${top.length ? ` (most hand-typed: ${list(top, 4)})` : ""}.`,
  };
}

/** One section's off-scale values, as the finding lists them. */
interface OffScaleValue {
  px: number;
  handTyped: number;
  count: number;
}

/**
 * The off-scale finding for one section: the hand-typed values off the 2px
 * scale, most hand-typed first, or null when there are none.
 */
function offScaleFlag(
  section: "typography" | "radius" | "spacing",
  values: OffScaleValue[],
): DesignFlag | null {
  // One entry per px: a size hand-typed in two type styles is one value to move.
  const byPx = new Map<number, OffScaleValue>();
  for (const v of values) {
    const seen = byPx.get(v.px);
    byPx.set(v.px, seen ? { px: v.px, handTyped: seen.handTyped + v.handTyped, count: seen.count + v.count } : v);
  }
  if (byPx.size === 0) return null;
  const px = [...byPx.values()]
    .sort((a, b) => b.handTyped - a.handTyped || b.count - a.count)
    .map((v) => `${v.px}px`);
  const what = {
    typography: ["font sizes", "text-[…]", "a step of the type scale"],
    radius: ["corner radii", "rounded-[…]", "a theme radius"],
    spacing: ["padding values", "p-[…]", "a spacing-scale step"],
  }[section];
  return {
    section,
    severity: section === "typography" ? "warn" : "info",
    message:
      `Hand-typed ${what[0]} off the 2px scale (${what[1]}): ${list(px, 6)} — ` +
      `use ${what[2]}, or at least an even value.`,
  };
}

/**
 * Rule-based checks over the aggregated data. Pure function of its input so
 * it's easy to test and the AI layer can quote the same findings verbatim.
 * `dismissed` values are left out of every check in their section.
 */
export function buildDesignFlags(
  data: PolishdDesignData,
  dismissed: DesignDismissedValues = {},
): DesignFlag[] {
  const flags: DesignFlag[] = [];
  if (data.pages.length === 0) return flags;
  const pushIf = (flag: DesignFlag | null) => {
    if (flag) flags.push(flag);
  };
  const kept = (key: string | null) => key === null || !(key in dismissed);
  const fonts = data.fonts.filter((f) => kept(typeKey(f.sizePx)));
  const colors = data.colors.filter((c) => kept(colorKey(c.hex)));
  const contrast = data.contrast.filter((p) => !contrastDismissal(dismissed, p.fg, p.bg));
  const radii = data.radii.filter((r) => kept(radiusKey(r.value)));
  const spacing = data.spacing.filter((s) => kept(spacingKey(s.px)));

  // Typography ---------------------------------------------------------------
  const sizes = [...new Set(fonts.map((f) => f.sizePx))].sort((a, b) => a - b);
  if (sizes.length > LIMITS.fontSizes) {
    flags.push({
      section: "typography",
      severity: "warn",
      message:
        `${sizes.length} distinct font sizes in use (${list(sizes.map((s) => `${s}px`), 12)}). ` +
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
  const weights = [...new Set(fonts.map((f) => f.weight))].sort((a, b) => a - b);
  if (weights.length > LIMITS.fontWeights) {
    flags.push({
      section: "typography",
      severity: "info",
      message: `${weights.length} font weights in use (${weights.join(", ")}) — hierarchies usually need 3–4.`,
    });
  }
  const tiny = fonts.filter((f) => f.sizePx <= TINY_TEXT_PX && f.count >= 3);
  if (tiny.length > 0) {
    const tinySizes = [...new Set(tiny.map((t) => t.sizePx))].sort((a, b) => b - a);
    flags.push({
      section: "typography",
      severity: "warn",
      message: `Text at ${TINY_TEXT_PX}px or smaller (${tinySizes.map((s) => `${s}px`).join(", ")}) — too small to read on most screens.`,
    });
  }
  const oneOffs = fonts.filter((f) => f.outlier);
  if (oneOffs.length >= 3) {
    const declared = oneOffs.every((f) => f.declarations !== undefined);
    flags.push({
      section: "typography",
      severity: "info",
      message: declared
        ? `${oneOffs.length} one-off type styles, each declared once on a single page — candidates to fold into the scale.`
        : `${oneOffs.length} one-off type styles appear on a single page each — candidates to fold into the scale.`,
    });
  }
  pushIf(
    offScaleFlag(
      "typography",
      fonts.filter((f) => f.offScale).map((f) => ({ px: f.sizePx, handTyped: f.handTyped ?? 0, count: f.count })),
    ),
  );

  // Color ----------------------------------------------------------------------
  const opaque = colors.filter((c) => c.hex.length === 7);
  if (opaque.length > LIMITS.colors) {
    flags.push({
      section: "color",
      severity: "warn",
      message: `${opaque.length} distinct colors rendered site-wide — palettes past ~${LIMITS.colors} usually mean drifted one-off values rather than a system.`,
    });
  }
  pushIf(handTypedColorFlag(data, colors));
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
  const failing = contrast.filter((p) => !p.passes && p.count >= 2);
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
  const distinctRadii = radii.filter((r) => r.value !== "full" && !r.value.includes("mixed"));
  if (distinctRadii.length > LIMITS.radii) {
    flags.push({
      section: "radius",
      severity: "warn",
      message:
        `${distinctRadii.length} distinct corner radii (${list(distinctRadii.map((r) => r.value), 8)}) — ` +
        `most systems settle on 2–4 (e.g. small, medium, full).`,
    });
  }
  pushIf(
    offScaleFlag(
      "radius",
      radii.filter((r) => r.offScale).map((r) => ({ px: radiusPx(r.value), handTyped: r.handTyped ?? 0, count: r.count })),
    ),
  );

  // Spacing ----------------------------------------------------------------------
  // Only what's hand-typed off the 2px scale is pointed out: there is no grid
  // to hold padding to, and a value from the theme is the system.
  pushIf(
    offScaleFlag(
      "spacing",
      spacing.filter((s) => s.offScale).map((s) => ({ px: s.px, handTyped: s.handTyped ?? 0, count: s.count })),
    ),
  );
  if (spacing.length > LIMITS.spacingValues) {
    flags.push({
      section: "spacing",
      severity: "info",
      message: `${spacing.length} distinct padding values in use — a spacing scale of 6–10 steps covers most interfaces.`,
    });
  }

  return flags;
}
