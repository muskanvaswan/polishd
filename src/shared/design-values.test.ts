import assert from "node:assert/strict";
import { test } from "node:test";

import type { PolishdDesignData } from "../server/design";
import {
  designPreviewTargets,
  designValueKey,
  isOffGrid,
  isOneOff,
  mergeDeclarations,
  ONE_OFF_RULES,
  sectionTotals,
  tailwindSpacingPx,
  unpicturedReason,
} from "./design-values.ts";

test("keys are stable per value, and colors ignore case and role", () => {
  assert.equal(designValueKey({ kind: "font", family: "Inter", sizePx: 17, weight: 500 }), "font:Inter|17|500");
  assert.equal(designValueKey({ kind: "color", hex: "#FaFaFa", roles: ["text"] }), "color:#fafafa");
  assert.equal(
    designValueKey({ kind: "color", hex: "#fafafa", roles: ["background", "border"] }),
    "color:#fafafa",
  );
  assert.equal(designValueKey({ kind: "radius", value: "6px (mixed)" }), "radius:6px (mixed)");
  assert.equal(designValueKey({ kind: "spacing", px: 7 }), "spacing:7");
});

function data(overrides: Partial<PolishdDesignData>): PolishdDesignData {
  return {
    ready: true,
    pages: [],
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

test("only flagged values become targets, one-offs before off-grid spacing", () => {
  const targets = designPreviewTargets(
    data({
      fonts: [
        { family: "Inter", sizePx: 16, weight: 400, count: 400, sample: null, tags: [], pages: ["/"], outlier: false },
        { family: "Inter", sizePx: 17, weight: 500, count: 1, sample: null, tags: [], pages: ["/pricing"], outlier: true },
      ],
      colors: [
        {
          hex: "#fafafa",
          count: 1,
          roles: { text: 0, background: 1, border: 0 },
          pages: ["/about"],
          pct: 0.1,
          outlier: true,
        },
      ],
      radii: [{ value: "7px", count: 1, pages: ["/"], outlier: true }],
      spacing: [
        { px: 8, count: 90, pages: ["/"], offGrid: false, outlier: false },
        { px: 7, count: 3, pages: ["/"], offGrid: true, outlier: false },
        { px: 9, count: 40, pages: ["/", "/about"], offGrid: true, outlier: false },
      ],
    }),
  );
  assert.deepEqual(
    targets.map((t) => t.key),
    ["font:Inter|17|500", "color:#fafafa", "radius:7px", "spacing:9", "spacing:7"],
  );
  assert.deepEqual(targets[1].ref, { kind: "color", hex: "#fafafa", roles: ["background"] });
  assert.deepEqual(targets[3].pages, ["/", "/about"]);
});

test("a value measured only on dashboard pseudo-pages waits for a local capture", () => {
  assert.equal(unpicturedReason(["/~polishd/design", "/~polishd/analytics"], ["/"]), "dashboard_only");
  assert.equal(unpicturedReason(["/~polishd/design"], null), "dashboard_only");
  // Once a local capture has shot the tab, it's an ordinary value.
  assert.equal(unpicturedReason(["/~polishd/design"], ["/", "/~polishd/design"]), "capture");
});

test("a value whose pages the latest snapshot didn't shoot says so", () => {
  assert.equal(unpicturedReason(["/pricing"], ["/", "/about"]), "not_shot");
  assert.equal(unpicturedReason(["/pricing", "/about"], ["/", "/about"]), "capture");
  assert.equal(unpicturedReason(["/pricing"], null), "capture");
  assert.equal(unpicturedReason([], ["/"]), "capture");
});

test("every off-grid padding is a target, most used first", () => {
  const spacing = Array.from({ length: 12 }, (_, i) => ({
    px: 3 + i * 2,
    count: i + 1,
    offGrid: true,
    pages: ["/"],
  }));
  const data = { fonts: [], colors: [], radii: [], spacing } as unknown as PolishdDesignData;
  const keys = designPreviewTargets(data).map((t) => t.key);
  assert.equal(keys.length, 12);
  assert.equal(keys[0], "spacing:25");
});

test("a value past the picture cap says so rather than asking for a capture", () => {
  assert.equal(unpicturedReason(["/"], ["/"], false), "not_targeted");
  assert.equal(unpicturedReason(["/~polishd/design"], ["/"], false), "dashboard_only");
});

test("declarations merge across pages by id, so a shared class counts once", () => {
  // A button constant on three pages: one declaration site-wide.
  assert.deepEqual(
    mergeDeclarations([
      { declarations: 1, handTyped: 0, ids: "k3x9" },
      { declarations: 1, handTyped: 0, ids: "k3x9" },
      { declarations: 2, handTyped: 1, ids: "k3x9 !p0a" },
    ]),
    { declarations: 2, handTyped: 1 },
  );
  // More declarations than ids sent: bounded below by the biggest page.
  assert.deepEqual(
    mergeDeclarations([
      { declarations: 9, handTyped: 4, ids: "a b c d e" },
      { declarations: 2, handTyped: 0, ids: "a f" },
    ]),
    { declarations: 9, handTyped: 4 },
  );
  // A page scanned before declarations were counted leaves the value unknown.
  assert.deepEqual(mergeDeclarations([{ declarations: 1, ids: "a" }, {}]), {});
  assert.deepEqual(mergeDeclarations([]), {});
});

test("a one-off is decided once, on one page, and not something the page leans on", () => {
  const rule = ONE_OFF_RULES.color;
  const value = (count: number, declarations: number | undefined, pages = ["/"]) => ({ count, declarations, pages });
  const totals = { count: 3000, declarations: 120 };
  // A stray badge color repeated down a 38-row table: one decision.
  assert.equal(isOneOff(value(38, 1), totals, rule), true);
  // The same rendered count, but chosen in two places — a pattern, not a stray.
  assert.equal(isOneOff(value(38, 2), totals, rule), false);
  // Declared once on <body>, painting a third of the page: the system itself.
  assert.equal(isOneOff(value(1000, 1), totals, rule), false);
  // Shared across pages.
  assert.equal(isOneOff(value(3, 1, ["/", "/about"]), totals, rule), false);
  // Too little measured to call anything rare.
  assert.equal(isOneOff(value(1, 1), { count: 40, declarations: 10 }, rule), false);
});

test("scans from before declarations keep the old per-use reading", () => {
  const rule = ONE_OFF_RULES.font;
  const legacy = { count: 400 };
  assert.equal(isOneOff({ count: 2, pages: ["/"] }, legacy, rule), true);
  assert.equal(isOneOff({ count: 7, pages: ["/"] }, legacy, rule), false);
  // One value without declarations makes the whole section legacy.
  const totals = sectionTotals([{ count: 300, declarations: 20 }, { count: 100 }]);
  assert.deepEqual(totals, { count: 400, declarations: undefined });
  assert.equal(isOneOff({ count: 7, declarations: 1, pages: ["/"] }, totals, rule), false);
});

test("Tailwind's half steps are on-grid on a Tailwind site, and only there", () => {
  const tailwind = { tailwind: true, remPx: 16 };
  for (const px of [1, 2, 6, 10, 14]) {
    assert.equal(isOffGrid(px, tailwind), false, `${px}px`);
    assert.equal(isOffGrid(px), true, `${px}px without Tailwind`);
  }
  for (const px of [3, 5, 7, 9, 13, 15, 18]) assert.equal(isOffGrid(px, tailwind), true, `${px}px`);
  for (const px of [4, 8, 12, 24]) assert.equal(isOffGrid(px), false);
  // The scale is in rem: at a 10px root, `p-1.5` renders 4px and `p-3.5` 9px.
  assert.equal(tailwindSpacingPx(10).has(9), true);
  assert.equal(isOffGrid(9, { tailwind: true, remPx: 10 }), false);
  assert.equal(isOffGrid(9, tailwind), true);
});
