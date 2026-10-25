import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_PREVIEWS_PER_SHOT,
  SNAPSHOT_RENDERINGS,
  captureOrder,
  capturePathFor,
  dashboardTabOf,
  darkModeVerdict,
  imageMime,
  parseSnapshotFile,
  previewMisses,
  snapshotFileFor,
} from "./snapshot-files.ts";

const ROUTES = ["/", "/pricing"];

test("each slot gets one name, derived on the server", () => {
  assert.equal(snapshotFileFor(ROUTES, { route: "/pricing", device: "phone", theme: "dark" }, "image/webp"), "r1-phone-dark.webp");
  assert.equal(
    snapshotFileFor(ROUTES, { route: "/", device: "desktop", theme: "light", preview: 3 }, "image/webp"),
    "v-r0-desktop-light-3.webp",
  );
  assert.equal(snapshotFileFor(ROUTES, { route: "/", device: "desktop", theme: "light" }, "image/png"), "r0-desktop-light.png");
});

test("slots outside the capture get no name", () => {
  assert.equal(snapshotFileFor(ROUTES, { route: "/admin", device: "phone", theme: "dark" }, "image/webp"), null);
  // @ts-expect-error — a device the capture doesn't shoot
  assert.equal(snapshotFileFor(ROUTES, { route: "/", device: "tablet", theme: "dark" }, "image/webp"), null);
  assert.equal(snapshotFileFor(ROUTES, { route: "/", device: "phone", theme: "dark" }, "text/html"), null);
  for (const preview of [-1, 1.5, MAX_PREVIEWS_PER_SHOT]) {
    assert.equal(snapshotFileFor(ROUTES, { route: "/", device: "phone", theme: "dark", preview }, "image/webp"), null);
  }
});

test("minted names parse back; nothing else does", () => {
  assert.deepEqual(parseSnapshotFile("r1-phone-dark.webp"), { routeIndex: 1, device: "phone", theme: "dark", dir: "shots" });
  assert.deepEqual(parseSnapshotFile("v-r0-desktop-light-3.webp"), {
    routeIndex: 0,
    device: "desktop",
    theme: "light",
    preview: 3,
    dir: "previews",
  });
  for (const file of [
    "../r0-phone-dark.webp",
    "r0-phone-dark.webp/../../x",
    "r0-phone-dark.html",
    "r0-phone-dark-3.webp", // a preview index without the v- prefix
    "v-r0-phone-dark.webp", // a preview without its index
    "r0-tablet-dark.webp",
    `v-r0-phone-dark-${MAX_PREVIEWS_PER_SHOT}.webp`,
    "",
  ]) {
    assert.equal(parseSnapshotFile(file), null, file);
  }
});

test("old PNG snapshots keep their type; new ones are WebP", () => {
  assert.equal(imageMime("r0-home--desktop--light.png"), "image/png");
  assert.equal(imageMime("r0-desktop-light.webp"), "image/webp");
});

test("identical light and dark everywhere means no dark mode", () => {
  const shots = [
    { route: "/", device: "desktop", theme: "light", hash: "a" },
    { route: "/", device: "desktop", theme: "dark", hash: "a" },
    { route: "/", device: "phone", theme: "light", hash: "b" },
    { route: "/", device: "phone", theme: "dark", hash: "b" },
  ];
  assert.deepEqual(darkModeVerdict(shots), { noDarkMode: true, redundant: [1, 3] });
});

test("one page that themes keeps every dark shot", () => {
  const shots = [
    { route: "/", device: "desktop", theme: "light", hash: "a" },
    { route: "/", device: "desktop", theme: "dark", hash: "a" },
    { route: "/app", device: "desktop", theme: "light", hash: "c" },
    { route: "/app", device: "desktop", theme: "dark", hash: "d" },
  ];
  assert.deepEqual(darkModeVerdict(shots), { noDarkMode: false, redundant: [] });
});

test("no complete pairs says nothing about dark mode", () => {
  assert.deepEqual(
    darkModeVerdict([
      { route: "/", device: "desktop", theme: "light", hash: "a" },
      { route: "/", device: "desktop", theme: "dark" }, // skipped cell, no hash
    ]),
    { noDarkMode: false, redundant: [] },
  );
});

test("the landing page's phone view goes first, light then dark", () => {
  const { probe, rest } = captureOrder(["/pricing", "/", "/blog"], SNAPSHOT_RENDERINGS);
  assert.deepEqual(probe, [
    { route: "/", device: "phone", theme: "light" },
    { route: "/", device: "phone", theme: "dark" },
  ]);
  // The rest stay rendering-major, every cell exactly once.
  assert.equal(rest.length, 3 * 4 - 2);
  assert.deepEqual(rest.slice(0, 3).map((s) => `${s.route} ${s.device} ${s.theme}`), [
    "/pricing desktop light",
    "/ desktop light",
    "/blog desktop light",
  ]);
  assert.ok(!rest.some((s) => s.route === "/" && s.device === "phone"));
});

test("without a homepage the first route probes; without phones, the first device in both themes", () => {
  assert.equal(captureOrder(["/pricing", "/about"], SNAPSHOT_RENDERINGS).probe[0].route, "/pricing");
  const review = captureOrder(["/a", "/b"], [
    { device: "desktop", theme: "light" },
    { device: "desktop", theme: "dark" },
  ]);
  assert.deepEqual(review.probe.map((s) => `${s.route} ${s.device} ${s.theme}`), ["/a desktop light", "/a desktop dark"]);
  assert.deepEqual(review.rest.map((s) => `${s.route} ${s.theme}`), ["/b light", "/b dark"]);
  const lightOnly = captureOrder(["/"], [{ device: "phone", theme: "light" }]);
  assert.deepEqual(lightOnly, { probe: [], rest: [{ route: "/", device: "phone", theme: "light" }] });
});

test("a value is missed only if it was pictured nowhere", () => {
  assert.deepEqual(previewMisses(["a", "b", "a", "c"], ["b"]), ["a", "c"]);
  assert.deepEqual(previewMisses([], ["b"]), []);
});

test("dashboard telemetry pages map to the dashboard's own tabs", () => {
  assert.equal(capturePathFor("/~polishd/design", "/polishd"), "/polishd?tab=design");
  assert.equal(capturePathFor("/~polishd/issues", "/admin/polishd/"), "/admin/polishd?tab=issues");
  assert.equal(capturePathFor("/pricing", "/polishd"), "/pricing");
  for (const route of ["/~polishd", "/~polishd/", "/~polishd/a/b", "/~polishd/../x", "/~other/design"]) {
    assert.equal(dashboardTabOf(route), null, route);
  }
});
