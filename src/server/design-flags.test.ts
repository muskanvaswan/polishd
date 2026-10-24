/**
 * Tests for the rule-based design findings.
 *
 * Run with `npm test`. Plain objects in, flags out. The cases pinned here are
 * the ones a real review got wrong: Tailwind's 6px/10px half steps reported
 * as off-grid, an off-grid share inflated by one class repeated per row, and
 * the systemic problem — every color hand-typed, no token layer — never
 * stated at all.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { DesignSpacingUsage, DesignSystemSignals, PolishdDesignData } from "./design";
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

const pad = (px: number, count: number, declarations: number | undefined, offGrid: boolean): DesignSpacingUsage => ({
  px,
  count,
  declarations,
  pages: ["/"],
  offGrid,
  outlier: false,
});

const spacingFlag = (d: PolishdDesignData) =>
  buildDesignFlags(d).find((f) => f.section === "spacing" && /off/.test(f.message));

test("Tailwind's half steps, once scored on-grid, raise no off-grid finding", () => {
  // The aggregation marks 6/10/1px on-grid on a Tailwind site; only real strays remain.
  const flagged = data({
    system: system({ tailwind: true }),
    spacing: [pad(8, 400, 40, false), pad(6, 120, 12, false), pad(10, 90, 9, false), pad(1, 30, 3, false), pad(9, 4, 1, true)],
  });
  assert.equal(spacingFlag(flagged), undefined);
});

test("the off-grid share counts declarations, not rows", () => {
  // 9px down 38 table rows (152 sides) from 5 class strings: 38% of uses
  // sit off-grid, but only 7 of 29 decisions.
  const d = data({
    spacing: [pad(8, 200, 16, false), pad(16, 60, 6, false), pad(9, 152, 5, true), pad(13, 4, 1, true), pad(7, 2, 1, true)],
  });
  assert.equal(spacingFlag(d), undefined);
  const drifting = data({
    system: system({ tailwind: true }),
    spacing: [pad(8, 200, 6, false), pad(9, 40, 5, true), pad(13, 4, 3, true), pad(7, 2, 2, true)],
  });
  assert.equal(
    spacingFlag(drifting)?.message,
    "63% of padding declarations sit off the 4px grid and Tailwind's spacing scale (9px, 13px, 7px) — " +
      "consistent rhythm usually comes from a 4px or 8px base unit.",
  );
});

test("data scanned before declarations still weighs the off-grid share by uses", () => {
  const legacy = data({
    spacing: [pad(8, 100, undefined, false), pad(6, 30, undefined, true), pad(10, 20, undefined, true), pad(1, 10, undefined, true)],
  });
  assert.match(spacingFlag(legacy)!.message, /^38% of padding values sit off a 4px grid \(6px, 10px, 1px\)/);
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

test("hand-typed findings wait for a majority and enough declarations", () => {
  const at = (category: keyof DesignSystemSignals["handTyped"], declarations: number, handTyped: number) =>
    buildDesignFlags(
      data({ system: system({ handTyped: { [category]: { declarations, handTyped } } as DesignSystemSignals["handTyped"] }) }),
    ).filter((f) => /hand-typed/.test(f.message));
  assert.equal(at("color", 50, 20).length, 0, "a minority bypassing the theme isn't the system");
  assert.equal(at("color", 6, 6).length, 0, "too few declarations to call it a pattern");
  const some = at("color", 20, 13);
  assert.match(some[0].message, /^65% of color declarations \(13 of 20\).* — most colors bypass the theme\.$/);
  const sizes = at("fontSize", 10, 9);
  assert.equal(sizes[0].section, "typography");
  assert.match(sizes[0].message, /^90% of font-size declarations \(9 of 10\) are hand-typed \(text-\[…px\]\)/);
  assert.equal(at("radius", 6, 5)[0].severity, "info");
  assert.equal(at("spacing", 10, 8)[0].section, "spacing");
});

test("one-off type styles are described by how they were decided", () => {
  const style = (sizePx: number, declarations?: number) => ({
    family: "Inter",
    sizePx,
    weight: 400,
    count: 1,
    declarations,
    sample: null,
    tags: ["span"],
    pages: ["/"],
    outlier: true,
  });
  const declared = buildDesignFlags(data({ fonts: [style(13, 1), style(15, 1), style(17, 1)] }));
  assert.ok(declared.some((f) => f.message === "3 one-off type styles, each declared once on a single page — candidates to fold into the scale."));
  const legacy = buildDesignFlags(data({ fonts: [style(13), style(15), style(17)] }));
  assert.ok(legacy.some((f) => f.message === "3 one-off type styles appear on a single page each — candidates to fold into the scale."));
});
