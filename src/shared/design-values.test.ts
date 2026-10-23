import assert from "node:assert/strict";
import { test } from "node:test";

import type { PolishdDesignData } from "../server/design";
import { designPreviewTargets, designValueKey, previewClip } from "./design-values.ts";

const VIEWPORT = { width: 1440, height: 900 };

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

test("a small element gets a component's worth of context at 16:10", () => {
  const clip = previewClip({ x: 700, y: 440, width: 40, height: 20 }, VIEWPORT);
  assert.deepEqual(clip, { x: 540, y: 338, width: 360, height: 225 });
});

test("a wide element grows the crop vertically to keep the shape", () => {
  const clip = previewClip({ x: 220, y: 400, width: 1000, height: 40 }, VIEWPORT);
  assert.ok(clip);
  assert.equal(clip.width, 1080);
  assert.equal(clip.height, 675);
});

test("the crop never leaves the viewport", () => {
  const nearCorner = previewClip({ x: 4, y: 4, width: 30, height: 12 }, VIEWPORT);
  assert.deepEqual(nearCorner, { x: 0, y: 0, width: 360, height: 225 });
  const farCorner = previewClip({ x: 1420, y: 880, width: 30, height: 30 }, VIEWPORT);
  assert.deepEqual(farCorner, { x: 1080, y: 675, width: 360, height: 225 });
});

test("an element bigger than the screen is framed by the screen", () => {
  const clip = previewClip({ x: -100, y: -2000, width: 1640, height: 6000 }, VIEWPORT);
  assert.deepEqual(clip, { x: 0, y: 0, width: 1440, height: 900 });
});

test("a phone viewport narrower than the minimum still fits", () => {
  const clip = previewClip({ x: 100, y: 300, width: 40, height: 20 }, { width: 340, height: 700 });
  assert.ok(clip);
  assert.equal(clip.width, 340);
  assert.equal(clip.x, 0);
});

test("an element entirely off screen has no honest crop", () => {
  assert.equal(previewClip({ x: 1500, y: 100, width: 300, height: 600 }, VIEWPORT), null);
  assert.equal(previewClip({ x: 100, y: 100, width: 0, height: 20 }, VIEWPORT), null);
});
