import assert from "node:assert/strict";
import { test } from "node:test";

import type { PolishdDesignData } from "../server/design";
import {
  designPreviewTargets,
  designValueKey,
  isOffScale,
  isOneOff,
  mergeDeclarations,
  onScale,
  ONE_OFF_RULES,
  radiusPx,
  sectionTotals,
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

test("only flagged values become targets: one-offs, then off-scale type and radii, then padding", () => {
  const targets = designPreviewTargets(
    data({
      fonts: [
        { family: "Inter", sizePx: 16, weight: 400, count: 400, sample: null, tags: [], pages: ["/"], outlier: false, offScale: false },
        { family: "Inter", sizePx: 13, weight: 400, count: 30, sample: null, tags: [], pages: ["/"], outlier: false, offScale: true },
        { family: "Inter", sizePx: 17, weight: 500, count: 1, sample: null, tags: [], pages: ["/pricing"], outlier: true, offScale: false },
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
      radii: [
        { value: "7px", count: 1, pages: ["/"], outlier: true, offScale: true },
        { value: "5px", count: 9, pages: ["/"], outlier: false, offScale: true },
      ],
      spacing: [
        { px: 8, count: 90, pages: ["/"], offScale: false, outlier: false },
        { px: 7, count: 3, pages: ["/"], offScale: true, outlier: false },
        { px: 9, count: 40, pages: ["/", "/about"], offScale: true, outlier: false },
      ],
    }),
  );
  assert.deepEqual(
    targets.map((t) => t.key),
    ["font:Inter|17|500", "color:#fafafa", "radius:7px", "font:Inter|13|400", "radius:5px", "spacing:9", "spacing:7"],
  );
  assert.deepEqual(targets[1].ref, { kind: "color", hex: "#fafafa", roles: ["background"] });
  assert.deepEqual(targets[5].pages, ["/", "/about"]);
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

test("every off-scale padding is a target, most used first", () => {
  const spacing = Array.from({ length: 12 }, (_, i) => ({
    px: 3 + i * 2,
    count: i + 1,
    offScale: true,
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
      { declarations: 1, handTyped: 0, ids: "k3x9", uses: 4 },
      { declarations: 1, handTyped: 0, ids: "k3x9", uses: 4 },
      { declarations: 2, handTyped: 1, ids: "k3x9 !p0a", uses: 9 },
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
  assert.deepEqual(mergeDeclarations([]), {});
});

test("an old scan contributes its uses, row by row, beside the declarations of newer ones", () => {
  // One page scanned by an old client, one by a new one.
  assert.deepEqual(mergeDeclarations([{ declarations: 1, ids: "a", uses: 5 }, { uses: 40 }]), {
    declarations: 1,
    handTyped: 0,
    legacyUses: 40,
  });
  // Only old scans: no declarations at all.
  assert.deepEqual(mergeDeclarations([{ uses: 12 }, { uses: "3" }]), { legacyUses: 15 });
  assert.deepEqual(sectionTotals([{ count: 300 }, { count: 100 }, { count: 8 }]), { count: 408 });
});

test("a one-off is rare in what renders and declared exactly once", () => {
  const rule = ONE_OFF_RULES.color;
  const value = (count: number, declarations: number | undefined, pages = ["/"]) => ({ count, declarations, pages });
  const totals = { count: 3000 };
  // A stray decided once, painting a sliver of the page.
  assert.equal(isOneOff(value(3, 1), totals, rule), true);
  // Just as rare, but chosen in two places — a pattern, not a stray.
  assert.equal(isOneOff(value(3, 2), totals, rule), false);
  // A badge class repeated down 38 rows is one declaration — counted once,
  // not promoted into a one-off: 38 uses is no sliver of 3,000.
  assert.equal(isOneOff(value(38, 1), totals, rule), false);
  // Shared across pages.
  assert.equal(isOneOff(value(3, 1, ["/", "/about"]), totals, rule), false);
  // Too little measured to call anything rare.
  assert.equal(isOneOff(value(1, 1), { count: 40 }, rule), false);
});

test("a brand color set by one class on a few prominent elements is no one-off", () => {
  // One page; the CTA blue is 12 of 496 color uses, from a single class.
  const totals = { count: 496 };
  assert.equal(isOneOff({ count: 12, declarations: 1, pages: ["/"] }, totals, ONE_OFF_RULES.color), false);
  // The old per-use reading agrees.
  assert.equal(isOneOff({ count: 12, pages: ["/"] }, totals, ONE_OFF_RULES.color), false);
});

test("a value from an old scan keeps the per-use reading, whatever the other rows are", () => {
  const rule = ONE_OFF_RULES.font;
  const totals = { count: 400 };
  // The old row's stray: rare in uses, nothing more to ask of it.
  assert.equal(isOneOff({ count: 2, legacyUses: 2, pages: ["/old"] }, totals, rule), true);
  // The new row's value is still read by its declarations: two of them, so a pattern.
  assert.equal(isOneOff({ count: 3, declarations: 2, pages: ["/new"] }, totals, rule), false);
  assert.equal(isOneOff({ count: 3, declarations: 1, pages: ["/new"] }, totals, rule), true);
  // Rare in uses is always required: 7 of 400 is past 1.5%.
  assert.equal(isOneOff({ count: 7, legacyUses: 7, pages: ["/old"] }, totals, rule), false);
});

test("a large old page never loosens the declaration check for new pages", () => {
  // A new page with 30 font declarations; three rare styles, each declared twice.
  const fresh = [
    ...Array.from({ length: 27 }, () => ({ count: 20, declarations: 1, pages: ["/new"] })),
    ...[13, 15, 17].map(() => ({ count: 3, declarations: 2, pages: ["/new"] })),
  ];
  const rare = fresh.slice(27);
  const alone = sectionTotals(fresh);
  assert.ok(rare.every((v) => !isOneOff(v, alone, ONE_OFF_RULES.font)));
  // Add a page nobody has revisited since the upgrade: 300 old uses.
  const withOld = sectionTotals([...fresh, { count: 300, legacyUses: 300, pages: ["/old"] } as never]);
  assert.ok(rare.every((v) => !isOneOff(v, withOld, ONE_OFF_RULES.font)), "still declared twice each");
});

test("the scale is 2px steps, and only hand-typed values are held to it", () => {
  for (const px of [0, 2, 4, 6, 10, 14, 18, 22]) assert.equal(onScale(px), true, `${px}px`);
  for (const px of [1, 3, 9, 13, 15, 12.5, 14.4]) assert.equal(onScale(px), false, `${px}px`);
  // Read to the hundredth: a rem value that lands a hair off still counts.
  assert.equal(onScale(16.001), true);
  // From the theme — or a site whose class names were never read — nothing is off-scale.
  assert.equal(isOffScale(13, { handTyped: 0 }), false);
  assert.equal(isOffScale(13, {}), false);
  assert.equal(isOffScale(13, { handTyped: 1 }), true);
  assert.equal(isOffScale(18, { handTyped: 4 }), false, "an even hand-typed value keeps the rhythm");
  assert.equal(isOffScale(radiusPx("full"), { handTyped: 1 }), false);
  assert.equal(radiusPx("5px (mixed)"), 5);
});
