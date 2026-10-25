/**
 * Tests for the rule-based design findings.
 *
 * Run with `npm test`. Plain objects in, flags out. The cases pinned here are
 * the ones a real review got wrong: padding held to a 4px grid it was never
 * meant to follow (Tailwind's 6px/10px half steps, an even 18px), text under
 * 11px reported as unreadable, the systemic problem — every color hand-typed,
 * no token layer — never stated at all, and a finding the owner had already
 * dismissed in the review raised again here.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  DesignFontUsage,
  DesignRadiusUsage,
  DesignSpacingUsage,
  DesignSystemSignals,
  PolishdDesignData,
} from "./design";
import type { DesignDismissedValues } from "./design-dismissals";
import { buildDesignFlags } from "./design-flags.ts";

function data(overrides: Partial<PolishdDesignData>): PolishdDesignData {
  return {
    ready: true,
    pages: [{ path: "/", scannedAt: 1_700_000_000_000, elements: 400 }],
    fonts: [],
    families: [],
    colors: [],
    contrast: [],
    radii: [],
    spacing: [],
    flags: [],
    ...overrides,
  };
}

function system(overrides: Partial<DesignSystemSignals> = {}): DesignSystemSignals {
  const none = { declarations: 0, handTyped: 0 };
  return {
    tailwind: false,
    remPx: 16,
    ...overrides,
    handTyped: { color: none, fontSize: none, radius: none, spacing: none, ...overrides.handTyped },
  };
}

/** A padding value; `handTyped` declarations typed it as `p-[…]`. */
const pad = (px: number, count: number, handTyped = 0, offScale = false): DesignSpacingUsage => ({
  px,
  count,
  declarations: Math.max(handTyped, 1),
  handTyped,
  pages: ["/"],
  offScale,
  outlier: false,
});

const style = (sizePx: number, extra: Partial<DesignFontUsage> = {}): DesignFontUsage => ({
  family: "Inter",
  sizePx,
  weight: 400,
  count: 10,
  sample: null,
  tags: ["p"],
  pages: ["/"],
  outlier: false,
  offScale: false,
  ...extra,
});

const radius = (value: string, extra: Partial<DesignRadiusUsage> = {}): DesignRadiusUsage => ({
  value,
  count: 10,
  pages: ["/"],
  outlier: false,
  offScale: false,
  ...extra,
});

const offScaleFlag = (d: PolishdDesignData, section: string, dismissed?: DesignDismissedValues) =>
  buildDesignFlags(d, dismissed).find((f) => f.section === section && /off the 2px scale/.test(f.message));

test("padding is held to no grid: odd and even values from the theme raise nothing", () => {
  // 9px and 18px used to sit "off the 4px grid"; neither was hand-typed.
  const d = data({
    spacing: [pad(8, 400), pad(6, 120), pad(10, 90), pad(18, 40), pad(9, 152), pad(13, 4)],
  });
  assert.equal(offScaleFlag(d, "spacing"), undefined);
  assert.ok(!buildDesignFlags(d).some((f) => /grid/.test(f.message)));
});

test("hand-typed values off the 2px scale are named, most hand-typed first", () => {
  const d = data({
    spacing: [pad(8, 400, 30), pad(14, 40, 6), pad(13, 4, 1, true), pad(7, 30, 3, true)],
  });
  assert.deepEqual(offScaleFlag(d, "spacing"), {
    section: "spacing",
    severity: "info",
    message:
      "Hand-typed padding values off the 2px scale (p-[…]): 7px, 13px — use a spacing-scale step, or at least an even value.",
  });
});

test("type sizes and radii get the same check, one entry per size", () => {
  const d = data({
    fonts: [
      style(13, { handTyped: 2, offScale: true }),
      style(13, { weight: 600, handTyped: 1, offScale: true }),
      style(12.5, { handTyped: 1, offScale: true }),
      style(14, { handTyped: 9 }),
    ],
    radii: [radius("5px", { handTyped: 2, offScale: true }), radius("8px", { handTyped: 4 }), radius("full")],
  });
  assert.deepEqual(offScaleFlag(d, "typography"), {
    section: "typography",
    severity: "warn",
    message:
      "Hand-typed font sizes off the 2px scale (text-[…]): 13px, 12.5px — use a step of the type scale, or at least an even value.",
  });
  assert.equal(
    offScaleFlag(d, "radius")?.message,
    "Hand-typed corner radii off the 2px scale (rounded-[…]): 5px — use a theme radius, or at least an even value.",
  );
});

test("only text at 8px or smaller reads as too small", () => {
  const tiny = (d: PolishdDesignData) => buildDesignFlags(d).find((f) => /too small to read/.test(f.message));
  assert.equal(tiny(data({ fonts: [style(9), style(10), style(11)] })), undefined, "9–10px is small, not unreadable");
  assert.equal(
    tiny(data({ fonts: [style(10), style(8), style(7), style(6, { count: 2 })] }))?.message,
    "Text at 8px or smaller (8px, 7px) — too small to read on most screens.",
  );
});

test("values an ignored review issue cites leave every check in their section", () => {
  const ignored = { issue: "Hand-typed 13px padding on cards", reason: "Optical inset, deliberate" };
  const spacing = data({ spacing: [pad(8, 400, 30), pad(13, 4, 1, true), pad(7, 30, 3, true)] });
  assert.equal(
    offScaleFlag(spacing, "spacing", { "spacing:13px": ignored })?.message,
    "Hand-typed padding values off the 2px scale (p-[…]): 7px — use a spacing-scale step, or at least an even value.",
  );
  assert.equal(offScaleFlag(spacing, "spacing", { "spacing:13px": ignored, "spacing:7px": ignored }), undefined);
  // A value dismissed as padding is still checked as a type size.
  const both = data({ fonts: [style(13, { handTyped: 1, offScale: true })], spacing: [pad(13, 4, 1, true)] });
  assert.ok(offScaleFlag(both, "typography", { "spacing:13px": ignored }));

  // Counts drop the dismissed values too: nine sizes, one of them answered.
  const sizes = data({ fonts: [10, 12, 13, 14, 16, 18, 20, 24, 32].map((px) => style(px)) });
  assert.ok(buildDesignFlags(sizes).some((f) => /^9 distinct font sizes/.test(f.message)));
  assert.ok(!buildDesignFlags(sizes, { "type:13px": ignored }).some((f) => /distinct font sizes/.test(f.message)));

  const tiny = data({ fonts: [style(8), style(7)] });
  assert.match(buildDesignFlags(tiny, { "type:8px": ignored }).find((f) => /too small/.test(f.message))!.message, /\(7px\)/);

  const colors = data({
    colors: ["#ffffff", "#fffdf8", "#111111"].map((hex) => ({
      hex,
      count: 50,
      roles: { text: 0, background: 50, border: 0 },
      pages: ["/"],
      pct: 30,
      outlier: false,
    })),
    contrast: [
      { fg: "#888888", bg: "#ffffff", count: 9, minSizePx: 12, ratio: 3.5, required: 4.5, passes: false, pages: ["/"] },
    ],
  });
  assert.ok(buildDesignFlags(colors).some((f) => /Near-duplicate/.test(f.message)));
  assert.ok(!buildDesignFlags(colors, { "color:#fffdf8": ignored }).some((f) => /Near-duplicate/.test(f.message)));
  assert.ok(buildDesignFlags(colors).some((f) => f.section === "contrast"));
  assert.ok(!buildDesignFlags(colors, { "contrast:#888888 #ffffff": ignored }).some((f) => f.section === "contrast"));
  assert.ok(!buildDesignFlags(colors, { "contrast:#888888": ignored }).some((f) => f.section === "contrast"));
  // A palette dismissal of the same color is a different finding.
  assert.ok(buildDesignFlags(colors, { "color:#888888": ignored }).some((f) => f.section === "contrast"));
});

test("mostly hand-typed colors say there is no color token layer", () => {
  const d = data({
    system: system({ tailwind: true, handTyped: { color: { declarations: 50, handTyped: 46 } } as DesignSystemSignals["handTyped"] }),
    colors: [
      { hex: "#555555", count: 300, declarations: 20, handTyped: 20, roles: { text: 300, background: 0, border: 0 }, pages: ["/"], pct: 30, outlier: false },
      { hex: "#111111", count: 200, declarations: 12, handTyped: 11, roles: { text: 0, background: 200, border: 0 }, pages: ["/"], pct: 20, outlier: false },
      { hex: "#ffffff", count: 100, declarations: 4, handTyped: 0, roles: { text: 100, background: 0, border: 0 }, pages: ["/"], pct: 10, outlier: false },
    ],
  });
  const flag = buildDesignFlags(d).find((f) => f.section === "color" && /hand-typed/.test(f.message));
  assert.deepEqual(flag, {
    section: "color",
    severity: "warn",
    message:
      "92% of color declarations (46 of 50) are hand-typed arbitrary values (text-[#…], bg-[#…]) rather than theme tokens" +
      " — there is no color token layer (most hand-typed: #555555, #111111).",
  });
});

test("hand-typed colors wait for a majority and enough declarations", () => {
  const at = (category: keyof DesignSystemSignals["handTyped"], declarations: number, handTyped: number) =>
    buildDesignFlags(
      data({ system: system({ handTyped: { [category]: { declarations, handTyped } } as DesignSystemSignals["handTyped"] }) }),
    ).filter((f) => /hand-typed/.test(f.message));
  assert.equal(at("color", 50, 20).length, 0, "a minority bypassing the theme isn't the system");
  assert.equal(at("color", 40, 3).length, 0, "theme tokens plus a few legitimate arbitrary values");
  assert.equal(at("color", 20, 10).length, 0, "exactly half is not most");
  assert.equal(at("color", 20, 11).length, 1, "just past half is");
  assert.equal(at("color", 6, 6).length, 0, "too few declarations to call it a pattern");
  const some = at("color", 20, 13);
  assert.match(some[0].message, /^65% of color declarations \(13 of 20\).* — most colors bypass the theme\.$/);
  // Sizes are judged value by value against the 2px scale, never by share.
  assert.equal(at("fontSize", 10, 9).length, 0);
  assert.equal(at("radius", 6, 5).length, 0);
  assert.equal(at("spacing", 10, 8).length, 0);
});

test("one-off type styles are described by how they were decided", () => {
  const oneOff = (sizePx: number, declarations?: number) =>
    style(sizePx, { count: 1, declarations, tags: ["span"], outlier: true });
  const declared = buildDesignFlags(data({ fonts: [oneOff(13, 1), oneOff(15, 1), oneOff(17, 1)] }));
  assert.ok(declared.some((f) => f.message === "3 one-off type styles, each declared once on a single page — candidates to fold into the scale."));
  const legacy = buildDesignFlags(data({ fonts: [oneOff(13), oneOff(15), oneOff(17)] }));
  assert.ok(legacy.some((f) => f.message === "3 one-off type styles appear on a single page each — candidates to fold into the scale."));
});
