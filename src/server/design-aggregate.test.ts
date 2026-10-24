/**
 * Tests for merging design scans site-wide.
 *
 * Run with `npm test`. Payloads go in as the client serializes them — old
 * shapes included, since installs on older package versions (and the
 * telemetry collector, which ingests every version at once) keep writing
 * them. An old payload must aggregate exactly as it always did: counts kept,
 * declarations unknown, the per-use one-off reading, the plain 4px grid.
 *
 * The subject imports its siblings without file extensions, as the build
 * requires, so this file teaches its own test process to try `.ts` for those
 * before loading it.
 */
import assert from "node:assert/strict";
import { register } from "node:module";
import { test } from "node:test";

import { buildBrandKit } from "../shared/brand-kit.ts";
import type { DesignScanRow } from "./design-aggregate.ts";
import type { PolishdDesignScanPayload } from "../shared/types";

register(
  "data:text/javascript," +
    encodeURIComponent(`
      export async function resolve(specifier, context, next) {
        try {
          return await next(specifier, context);
        } catch (err) {
          const bare = /^\\.\\.?\\//.test(specifier) && !/\\.[cm]?[jt]sx?$/.test(specifier);
          if (err?.code !== "ERR_MODULE_NOT_FOUND" || !bare) throw err;
          return next(specifier + ".ts", context);
        }
      }`),
);
const { aggregateDesignScans } = await import("./design-aggregate.ts");

function scan(path: string, payload: Partial<PolishdDesignScanPayload>, ts = 1): DesignScanRow {
  return {
    path,
    ts,
    payload: { v: 1, el: 400, fonts: [], text: [], bg: [], border: [], pairs: [], radii: [], pad: [], ...payload },
  };
}

/** A payload as clients before declaration counting wrote it: bare counts, no tw/rem. */
const OLD_SHAPE = {
  fonts: [
    ["Inter", 16, 400, 300, "Body copy", "p,span"],
    ["Inter", 14, 500, 60, "Label", "label"],
    ["Inter", 17, 500, 2, "Stray", "span"],
  ],
  text: [["#111111", 330], ["#555555", 30], ["#666666", 2]],
  bg: [["#ffffff", 120], ["#fafafa", 1]],
  border: [["#e5e5e5", 40]],
  pairs: [["#111111", "#ffffff", 300, 14, 0]],
  radii: [["8px", 40], ["6px", 1]],
  pad: [[8, 200], [16, 100], [6, 60], [10, 40], [2, 20]],
} as unknown as Partial<PolishdDesignScanPayload>;

test("an old-shape payload aggregates as it always did", () => {
  const data = aggregateDesignScans([scan("/", OLD_SHAPE)]);
  // Counts survive; declarations are unknown rather than zero.
  assert.deepEqual(
    data.fonts.map((f) => [f.sizePx, f.count, f.declarations, f.outlier]),
    [[16, 300, undefined, false], [14, 60, undefined, false], [17, 2, undefined, true]],
  );
  assert.deepEqual(
    data.colors.map((c) => [c.hex, c.count, c.declarations]),
    [["#111111", 330, undefined], ["#ffffff", 120, undefined], ["#e5e5e5", 40, undefined], ["#555555", 30, undefined], ["#666666", 2, undefined], ["#fafafa", 1, undefined]],
  );
  assert.equal(data.colors.find((c) => c.hex === "#fafafa")?.outlier, true);
  assert.equal(data.radii.find((r) => r.value === "6px")?.outlier, true);
  // No class names were read: not a Tailwind site, nothing hand-typed, 6/10/2px off the 4px grid.
  assert.equal(data.system?.tailwind, false);
  assert.deepEqual(data.system?.handTyped.color, { declarations: 0, handTyped: 0 });
  assert.deepEqual(data.spacing.filter((s) => s.offGrid).map((s) => s.px), [6, 10, 2]);
  assert.ok(data.flags.some((f) => f.message.startsWith("29% of padding values sit off a 4px grid (6px, 10px, 2px)")));
  assert.ok(!data.flags.some((f) => /hand-typed/.test(f.message)));
});

test("old and new scans merge row by row: old uses beside new declarations", () => {
  const fresh = scan(
    "/new",
    {
      fonts: [
        ["Inter", 16, 400, 200, "Body", "p", 1, 0, "body1"],
        ["Inter", 12, 500, 38, "Paid", "span", 1, 1, "!badge"],
      ],
      text: [["#111111", 200, 1, 0, "body1"], ["#555555", 38, 1, 1, "!badge"]],
      tw: [40, 50],
      rem: 16,
    },
    2,
  );
  const data = aggregateDesignScans([fresh, scan("/", OLD_SHAPE)]);
  const font = (px: number) => data.fonts.find((f) => f.sizePx === px)!;
  // 16px: one declaration from the new page, 300 uses from the old one.
  assert.deepEqual([font(16).count, font(16).declarations, font(16).legacyUses], [500, 1, 300]);
  assert.deepEqual([font(12).declarations, font(12).handTyped, font(12).legacyUses], [1, 1, undefined]);
  // The old page's stray still reads the old way.
  assert.equal(font(17).outlier, true);
  assert.equal(data.system?.tailwind, true);
});

test("one stale old-shape page doesn't revert the rest of the section", () => {
  // A new scan with a rare style declared twice — a pattern, not a stray —
  // beside a page nobody has revisited since the upgrade.
  const fresh = scan(
    "/",
    {
      fonts: [
        ["Inter", 16, 400, 300, "Body", "p", 1, 0, "body1"],
        ["Inter", 14, 500, 60, "Label", "label", 3, 0, "l1 l2 l3"],
        ["Inter", 13, 400, 2, "Meta", "span", 2, 0, "m1 m2"],
        ["Inter", 15, 400, 1, "Odd", "span", 1, 1, "!odd"],
      ],
      tw: [40, 50],
      rem: 16,
    },
    2,
  );
  const stale = scan("/legacy", { fonts: [["Inter", 16, 400, 40, "Body", "p"]] } as unknown as Partial<PolishdDesignScanPayload>);
  const data = aggregateDesignScans([fresh, stale]);
  const outlier = (px: number) => data.fonts.find((f) => f.sizePx === px)!.outlier;
  assert.equal(outlier(13), false, "two declarations: still read by declarations");
  assert.equal(outlier(15), true);
});

test("a large old page doesn't turn twice-declared styles into one-offs", () => {
  // A new page: 27 ordinary styles, plus three rare ones each declared twice.
  const fonts = [
    ...Array.from({ length: 27 }, (_, i) => ["Inter", 18 + i, 400, 20, "Copy", "p", 1, 0, `d${i}`]),
    ...[13, 15, 17].map((px) => ["Inter", px, 400, 3, "Rare", "span", 2, 0, `r${px}a r${px}b`]),
  ];
  const fresh = scan("/new", { fonts, tw: [40, 50], rem: 16 } as unknown as Partial<PolishdDesignScanPayload>, 2);
  // A page nobody has revisited since the upgrade, 300 old uses.
  const stale = scan("/old", { fonts: [["Inter", 16, 400, 300, "Body", "p"]] } as unknown as Partial<PolishdDesignScanPayload>);
  for (const scans of [[fresh], [fresh, stale]]) {
    const data = aggregateDesignScans(scans);
    assert.deepEqual(
      data.fonts.filter((f) => [13, 15, 17].includes(f.sizePx)).map((f) => [f.declarations, f.outlier]),
      [[2, false], [2, false], [2, false]],
    );
    assert.ok(!data.flags.some((f) => /one-off type styles/.test(f.message)));
  }
});

test("a brand CTA color from one class on a few elements stays in the brand kit", () => {
  // One scanned page: 496 color uses, the CTA blue 12 of them, from one class.
  const text: [string, number, number, number, string][] = [
    ["#111111", 300, 6, 0, "a b c d e"],
    ["#666666", 120, 4, 0, "f g h i"],
    ["#ffffff", 64, 3, 0, "j k l"],
  ];
  const data = aggregateDesignScans([
    scan("/", { text, bg: [["#2563eb", 12, 1, 0, "cta"]], tw: [40, 50], rem: 16 }),
  ]);
  const cta = data.colors.find((c) => c.hex === "#2563eb")!;
  assert.deepEqual([cta.count, cta.declarations, cta.outlier], [12, 1, false]);
  assert.ok(buildBrandKit(data).colors.some((c) => c.hex === "#2563eb"));
  // The old-shape payload agrees.
  const old = aggregateDesignScans([
    scan("/", {
      text: text.map(([hex, n]) => [hex, n]),
      bg: [["#2563eb", 12]],
    } as unknown as Partial<PolishdDesignScanPayload>),
  ]);
  assert.equal(old.colors.find((c) => c.hex === "#2563eb")!.outlier, false);
});

test("declarations merge across pages by id: a shared class is one decision", () => {
  const page = (path: string, extra: [number, number, number, number, string][] = []) =>
    scan(path, {
      fonts: [["Inter", 16, 400, 120, "Body", "p", 1, 0, "body1"]],
      radii: [["6px", 41, 1, 1, "!btn"], ["8px", 30, 4, 0, "c1 c2 c3 c4"]],
      pad: [[9, 152, 5, 5, "!r1 !r2 !r3 !r4 !r5"], [8, 400, 6, 0, "a b c d e"], ...extra],
      tw: [30, 40],
      rem: 16,
    });
  const data = aggregateDesignScans([page("/", [[6, 40, 2, 0, "d1 d2"]]), page("/orders"), page("/about")]);
  const radius = data.radii.find((r) => r.value === "6px")!;
  assert.deepEqual([radius.count, radius.declarations, radius.handTyped], [123, 1, 1]);
  const nine = data.spacing.find((s) => s.px === 9)!;
  assert.deepEqual([nine.count, nine.declarations, nine.offGrid], [456, 5, true]);
  // 8px had 6 declarations but only 5 ids fit: a lower bound, never more than measured.
  assert.equal(data.spacing.find((s) => s.px === 8)!.declarations, 6);
  // Tailwind's 6px step is on-grid here.
  assert.equal(data.spacing.find((s) => s.px === 6)!.offGrid, false);
});

test("malformed rows are skipped, never fatal", () => {
  const junk = {
    fonts: [null, "Inter", ["Inter", "16", 400, 5, "x", "p"], ["Inter", 16, 400, 50, "Body", "p"]],
    text: { "#111": 4 },
    bg: [[42, 3], ["#ffffff", "7"]],
    radii: [["8px"]],
    pad: [[Number.NaN, 3], [8, 12, "lots", null, 7]],
    tw: "yes",
    rem: -4,
  } as unknown as Partial<PolishdDesignScanPayload>;
  const data = aggregateDesignScans([scan("/", junk)]);
  assert.deepEqual(data.fonts.map((f) => [f.sizePx, f.count]), [[16, 50]]);
  assert.deepEqual(data.colors.map((c) => [c.hex, c.count]), [["#ffffff", 7]]);
  assert.deepEqual(data.spacing.map((s) => [s.px, s.count, s.declarations]), [[8, 12, undefined]]);
  assert.equal(data.system?.tailwind, false);
  assert.equal(data.system?.remPx, 16);
});

test("theme tokens plus a few legitimate arbitrary values raise no hand-typed finding", () => {
  const colors = (n: number, hand: number) =>
    Array.from({ length: n }, (_, i): [string, number, number, number, string] => [
      `#${(0x101010 * (i + 1)).toString(16).padStart(6, "0").slice(0, 6)}`,
      20,
      2,
      i < hand ? 1 : 0,
      i < hand ? `t${i} !h${i}` : `t${i} u${i}`,
    ]);
  const themed = aggregateDesignScans([scan("/", { text: colors(12, 2), tw: [40, 50], rem: 16 })]);
  assert.deepEqual(themed.system?.handTyped.color, { declarations: 24, handTyped: 2 });
  assert.ok(!themed.flags.some((f) => /hand-typed/.test(f.message)));
  // Every color declared through an arbitrary class: there is no token layer.
  const handTyped = (n: number) =>
    Array.from({ length: n }, (_, i): [string, number, number, number, string] => [
      `#${(0x0f0f0f * (i + 1)).toString(16).padStart(6, "0").slice(0, 6)}`,
      20,
      1,
      1,
      `!h${i}`,
    ]);
  const bypassed = aggregateDesignScans([scan("/", { text: handTyped(12), tw: [40, 50], rem: 16 })]);
  assert.ok(bypassed.flags.some((f) => /^100% of color declarations \(12 of 12\).*there is no color token layer/.test(f.message)));
});
