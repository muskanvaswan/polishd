/**
 * Tests for what the design review is shown of the site.
 *
 * Run with `npm test`. The cases to hold: the pages are the ones visitors
 * reach; every first screen goes, light then dark; the value pictures go in
 * the order a picture can settle them — contrast first, a spread of
 * one-offs next, off-grid padding only to fill — and never past the cap.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { PolishdDesignData } from "../server/design.ts";
import { EMPTY_DESIGN_DATA } from "../server/design.ts";
import type { PolishdSnapshotPreview, PolishdSnapshotShot } from "../server/snapshots.ts";
import {
  MAX_VALUE_CROPS,
  cropLabel,
  cropPriority,
  describeValue,
  designReviewTargets,
  heroLabel,
  pickReviewRoutes,
  screenshotsNote,
  selectReviewImages,
  shotRefusal,
} from "./design-shots.ts";

const traffic = (entries: [string, number, number][]) =>
  new Map(entries.map(([route, sessions, pageViews]) => [route, { sessions, pageViews }]));

const font = (family: string, sizePx: number, weight: number, outlier: boolean) => ({
  family,
  sizePx,
  weight,
  count: 3,
  sample: null,
  tags: ["p"],
  pages: ["/pricing"],
  outlier,
});
const color = (hex: string, outlier: boolean, roles = { text: 1, background: 0, border: 0 }) => ({
  hex,
  count: 2,
  roles,
  pages: ["/"],
  pct: 1,
  outlier,
});
const radius = (value: string, outlier: boolean) => ({ value, count: 2, pages: ["/"], outlier });
const spacing = (px: number, offGrid: boolean) => ({ px, count: 2, pages: ["/"], offGrid, outlier: offGrid });

const data: PolishdDesignData = {
  ...EMPTY_DESIGN_DATA,
  ready: true,
  pages: [{ path: "/" }, { path: "/pricing" }] as unknown as PolishdDesignData["pages"],
  fonts: [font("Inter", 16, 400, false), font("Inter", 17, 500, true), font("Inter", 23, 600, true)],
  colors: [color("#111111", false), color("#fafafa", true, { text: 0, background: 1, border: 0 }), color("#777777", false)],
  contrast: [
    { fg: "#777777", bg: "#ffffff", count: 4, minSizePx: 13, ratio: 4.48, required: 4.5, passes: false, pages: ["/pricing"] },
    { fg: "#111111", bg: "#ffffff", count: 40, minSizePx: 14, ratio: 18.9, required: 4.5, passes: true, pages: ["/"] },
  ],
  radii: [radius("8px", false), radius("6px", true)],
  spacing: [spacing(16, false), spacing(13, true), spacing(7, true)],
};

test("the most-visited pages come first, by sessions then page views, ties keeping the given order", () => {
  const routes = ["/about", "/", "/pricing", "/docs", "/blog"];
  assert.deepEqual(
    pickReviewRoutes(routes, traffic([["/", 40, 60], ["/pricing", 12, 50], ["/docs", 12, 20], ["/about", 3, 3]])),
    ["/", "/pricing", "/docs"],
  );
  assert.deepEqual(pickReviewRoutes(routes, new Map()), ["/about", "/", "/pricing"]);
  assert.deepEqual(pickReviewRoutes(["/a", "/a", "/b"], new Map(), 5), ["/a", "/b"]);
});

test("a review looks for failing text colors first, then everything the tab flags, each once", () => {
  const keys = designReviewTargets(data).map((t) => t.key);
  assert.deepEqual(keys, [
    "color:#777777",
    "font:Inter|17|500",
    "font:Inter|23|600",
    "color:#fafafa",
    "radius:6px",
    "spacing:13",
    "spacing:7",
  ]);
  assert.deepEqual(designReviewTargets(data)[0].ref, { kind: "color", hex: "#777777", roles: ["text"] });
});

test("pictures go contrast first, then a spread of one-offs, padding last", () => {
  assert.deepEqual(cropPriority(data), [
    "color:#777777",
    "font:Inter|17|500",
    "color:#fafafa",
    "radius:6px",
    "font:Inter|23|600",
    "spacing:13",
    "spacing:7",
  ]);
});

test("values are described from the measurements behind their keys", () => {
  assert.equal(describeValue("font:Inter|17|500", data), "type style Inter 17px/500 (one-off)");
  assert.equal(describeValue("font:Inter|16|400", data), "type style Inter 16px/400");
  assert.equal(describeValue("color:#777777", data), "text color #777777, failing WCAG AA on #ffffff (4.48:1 at 13px)");
  assert.equal(describeValue("color:#fafafa", data), "background color #fafafa (one-off)");
  assert.equal(describeValue("radius:6px", data), "corner radius 6px (one-off)");
  assert.equal(describeValue("spacing:13", data), "padding 13px (off-grid)");
  assert.equal(describeValue("spacing:16", data), "padding 16px");
  assert.equal(describeValue("odd:thing", data), "odd:thing");
});

const shot = (route: string, theme: string, file: string | null): PolishdSnapshotShot => ({
  route,
  device: "desktop",
  theme,
  file: file ?? "",
  ...(file ? {} : { skipped: "HTTP 500" }),
});
const preview = (key: string, route: string, file: string): PolishdSnapshotPreview => ({
  key,
  route,
  device: "desktop",
  theme: "light",
  file,
});

test("every first screen goes, light then dark per page in planned order; dropped and skipped cells don't", () => {
  const capture = {
    routes: ["/", "/pricing", "/docs"],
    // Recorded out of order, as two cells in flight can be.
    shots: [
      shot("/pricing", "light", "r1-desktop-light.webp"),
      shot("/", "dark", "r0-desktop-dark.webp"),
      shot("/", "light", "r0-desktop-light.webp"),
      shot("/docs", "light", null),
      // No dark shot of /pricing: it rendered the same as light and was dropped.
    ],
    previews: [],
  };
  assert.deepEqual(
    selectReviewImages(capture, data).heroes.map((h) => [h.route, h.theme]),
    [
      ["/", "light"],
      ["/", "dark"],
      ["/pricing", "light"],
    ],
  );
});

test("value pictures follow the priority, only for values the capture found, under the cap", () => {
  const previews = [
    preview("spacing:13", "/", "v-r0-desktop-light-5.webp"),
    preview("radius:6px", "/", "v-r0-desktop-light-4.webp"),
    preview("color:#777777", "/pricing", "v-r1-desktop-light-0.webp"),
    preview("font:Inter|23|600", "/pricing", "v-r1-desktop-light-2.webp"),
  ];
  const { crops } = selectReviewImages({ routes: ["/", "/pricing"], shots: [], previews }, data);
  assert.deepEqual(
    crops.map((c) => c.key),
    ["color:#777777", "radius:6px", "font:Inter|23|600", "spacing:13"],
  );
  assert.equal(crops[0].label, "text color #777777, failing WCAG AA on #ffffff (4.48:1 at 13px)");

  const many: PolishdDesignData = {
    ...data,
    spacing: Array.from({ length: 10 }, (_, i) => spacing(5 + i * 2, true)),
  };
  const lots = many.spacing.map((s, i) => preview(`spacing:${s.px}`, "/", `v-r0-desktop-light-${i}.webp`));
  assert.equal(selectReviewImages({ routes: ["/"], shots: [], previews: lots }, many).crops.length, MAX_VALUE_CROPS);
});

test("a shot is refused when it's too big for the provider, or isn't an image", () => {
  const anthropic = { maxBytes: 3_600_000, maxEdge: 8000 };
  const scaling = { maxBytes: 3_600_000, maxEdge: Number.POSITIVE_INFINITY };
  assert.equal(shotRefusal({ width: 1440, height: 900 }, 200_000, anthropic), null);
  assert.match(shotRefusal({ width: 1440, height: 16000 }, 2_000_000, anthropic)!, /16000px, over the 8000px edge/);
  assert.equal(shotRefusal({ width: 1440, height: 16000 }, 2_000_000, scaling), null);
  assert.match(shotRefusal({ width: 1440, height: 900 }, 5_000_000, scaling)!, /5\.0 MB, over the 3\.6 MB/);
  assert.match(shotRefusal(null, 10, scaling)!, /not a readable/);
});

test("the prompt names each image's page or value, and the capture day", () => {
  const selection = {
    heroes: [
      { route: "/", theme: "light", file: "a" },
      { route: "/", theme: "dark", file: "b" },
      { route: "/pricing", theme: "light", file: "c" },
    ],
    crops: [{ key: "radius:6px", route: "/", theme: "light", file: "d", label: "corner radius 6px (one-off)" }],
  };
  assert.equal(heroLabel(2, selection.heroes[1]), "Screenshot 2: first screen of / (desktop, dark theme)");
  assert.equal(
    cropLabel(4, selection.crops[0]),
    "Screenshot 4: corner radius 6px (one-off) — the element carrying it, ringed in amber, on / (desktop, light theme)",
  );
  assert.equal(
    screenshotsNote(selection, Date.UTC(2026, 9, 25, 15)),
    "SCREENSHOTS: 4 attached, captured 2026-10-25, scaled down.\n" +
      "First screens (desktop) of the most-visited pages: / (light, dark); /pricing (light).\n" +
      "Flagged values pictured in place, each ringed in amber: [4] corner radius 6px (one-off) on /.",
  );
});
