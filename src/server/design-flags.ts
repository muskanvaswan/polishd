/**
 * Polishd — deterministic design review.
 *
 * Rule-based checks over the aggregated design data (server/design.ts),
 * against widely accepted UI practice: a bounded type scale, one or two
 * families, a palette without near-duplicates, WCAG contrast, spacing on a
 * grid, and values drawn from a theme rather than typed by hand. They
 * produce `flags` — no model involved — and the AI design review quotes the
 * same findings.
 *
 * Where it matters, the rules count declarations, not rendered elements: a
 * padding class repeated down a 38-row table is one decision to revisit,
 * not 38. Data from before declarations were measured falls back to uses.
 *
 * Pure: types only, no store — the test file drives it with plain objects.
 */
import type { DesignFlag, DesignHandTypedCategory, PolishdDesignData } from "./design";

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
 * Hand-typed values: past `share` of a category's declarations, the theme is
 * mostly bypassed; past `noLayer`, there's effectively no token layer at all.
 * Each category needs a few declarations before a share means anything.
 */
const HAND_TYPED = {
  share: 0.5,
  noLayer: 0.8,
  minDeclarations: { color: 10, fontSize: 6, radius: 5, spacing: 8 } satisfies Record<DesignHandTypedCategory, number>,
};

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
 * The hand-typed finding for one category, or null when it's mostly themed
 * (or too little was measured to say).
 */
function handTypedFlag(
  data: PolishdDesignData,
  category: DesignHandTypedCategory,
): DesignFlag | null {
  const totals = data.system?.handTyped[category];
  if (!totals || totals.declarations < HAND_TYPED.minDeclarations[category]) return null;
  const share = totals.handTyped / totals.declarations;
  if (share <= HAND_TYPED.share) return null;
  const pct = Math.round(share * 100);
  const ofN = `(${totals.handTyped} of ${totals.declarations})`;
  const byHand = <T extends { handTyped?: number; count: number }>(values: T[]) =>
    values.filter((v) => (v.handTyped ?? 0) > 0).sort((a, b) => b.handTyped! - a.handTyped! || b.count - a.count);
  const noLayer = share >= HAND_TYPED.noLayer;

  switch (category) {
    case "color": {
      const top = byHand(data.colors).map((c) => c.hex);
      return {
        section: "color",
        severity: "warn",
        message:
          `${pct}% of color declarations ${ofN} are hand-typed arbitrary values (text-[#…], bg-[#…]) rather than theme tokens` +
          `${noLayer ? " — there is no color token layer" : " — most colors bypass the theme"}` +
          `${top.length ? ` (most hand-typed: ${list(top, 4)})` : ""}.`,
      };
    }
    case "fontSize": {
      const top = [...new Set(byHand(data.fonts).map((f) => `${f.sizePx}px`))];
      return {
        section: "typography",
        severity: "warn",
        message:
          `${pct}% of font-size declarations ${ofN} are hand-typed (text-[…px]) rather than steps of a type scale` +
          `${noLayer ? " — there is no type-scale token layer" : ""}` +
          `${top.length ? ` (most hand-typed: ${list(top, 4)})` : ""}.`,
      };
    }
    case "radius": {
      const top = byHand(data.radii).map((r) => r.value);
      return {
        section: "radius",
        severity: "info",
        message:
          `${pct}% of corner-radius declarations ${ofN} are hand-typed (rounded-[…]) rather than theme radii` +
          `${top.length ? ` (most hand-typed: ${list(top, 4)})` : ""}.`,
      };
    }
    case "spacing": {
      const top = byHand(data.spacing).map((s) => `${s.px}px`);
      return {
        section: "spacing",
        severity: "info",
        message:
          `${pct}% of padding declarations ${ofN} are hand-typed (p-[…]) rather than spacing-scale steps` +
          `${top.length ? ` (most hand-typed: ${list(top, 4)})` : ""}.`,
      };
    }
  }
}

/**
 * Rule-based checks over the aggregated data. Pure function of its input so
 * it's easy to test and the AI layer can quote the same findings verbatim.
 */
export function buildDesignFlags(data: PolishdDesignData): DesignFlag[] {
  const flags: DesignFlag[] = [];
  if (data.pages.length === 0) return flags;
  const pushIf = (flag: DesignFlag | null) => {
    if (flag) flags.push(flag);
  };

  // Typography ---------------------------------------------------------------
  const sizes = [...new Set(data.fonts.map((f) => f.sizePx))].sort((a, b) => a - b);
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
    const declared = oneOffs.every((f) => f.declarations !== undefined);
    flags.push({
      section: "typography",
      severity: "info",
      message: declared
        ? `${oneOffs.length} one-off type styles, each declared once on a single page — candidates to fold into the scale.`
        : `${oneOffs.length} one-off type styles appear on a single page each — candidates to fold into the scale.`,
    });
  }
  pushIf(handTypedFlag(data, "fontSize"));

  // Color ----------------------------------------------------------------------
  const opaque = data.colors.filter((c) => c.hex.length === 7);
  if (opaque.length > LIMITS.colors) {
    flags.push({
      section: "color",
      severity: "warn",
      message: `${opaque.length} distinct colors rendered site-wide — palettes past ~${LIMITS.colors} usually mean drifted one-off values rather than a system.`,
    });
  }
  pushIf(handTypedFlag(data, "color"));
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
        `${distinctRadii.length} distinct corner radii (${list(distinctRadii.map((r) => r.value), 8)}) — ` +
        `most systems settle on 2–4 (e.g. small, medium, full).`,
    });
  }
  pushIf(handTypedFlag(data, "radius"));

  // Spacing ----------------------------------------------------------------------
  // Share of decisions, not of rendered sides: one off-grid class repeated
  // down a table is one thing to fix.
  const declared = data.spacing.length > 0 && data.spacing.every((v) => v.declarations !== undefined);
  const weight = (v: PolishdDesignData["spacing"][number]) => (declared ? v.declarations! : v.count);
  const totalPad = data.spacing.reduce((s, v) => s + weight(v), 0);
  const offGrid = data.spacing.filter((v) => v.offGrid).sort((a, b) => weight(b) - weight(a) || b.count - a.count);
  const offGridShare = totalPad > 0 ? offGrid.reduce((s, v) => s + weight(v), 0) / totalPad : 0;
  if (offGridShare > 0.25 && offGrid.length >= 3) {
    const grid = data.system?.tailwind ? "the 4px grid and Tailwind's spacing scale" : "a 4px grid";
    flags.push({
      section: "spacing",
      severity: "info",
      message:
        `${Math.round(offGridShare * 100)}% of padding ${declared ? "declarations" : "values"} sit off ${grid} ` +
        `(${list(offGrid.map((v) => `${v.px}px`), 6)}) — consistent rhythm usually comes from a 4px or 8px base unit.`,
    });
  }
  if (data.spacing.length > LIMITS.spacingValues) {
    flags.push({
      section: "spacing",
      severity: "info",
      message: `${data.spacing.length} distinct padding values in use — a spacing scale of 6–10 steps covers most interfaces.`,
    });
  }
  pushIf(handTypedFlag(data, "spacing"));

  return flags;
}
