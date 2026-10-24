import assert from "node:assert/strict";
import { test } from "node:test";

import type { PolishdDesignData } from "../server/design";
import { designPreviewTargets, designValueKey } from "./design-values.ts";

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
        { px: 8, count: 90, pages: ["/"], offGrid: false },
        { px: 6, count: 3, pages: ["/"], offGrid: true },
        { px: 10, count: 40, pages: ["/", "/about"], offGrid: true },
      ],
    }),
  );
  assert.deepEqual(
    targets.map((t) => t.key),
    ["font:Inter|17|500", "color:#fafafa", "radius:7px", "spacing:10", "spacing:6"],
  );
  assert.deepEqual(targets[1].ref, { kind: "color", hex: "#fafafa", roles: ["background"] });
  assert.deepEqual(targets[3].pages, ["/", "/about"]);
});
