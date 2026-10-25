/**
 * Tests for the Overview gallery's selection.
 *
 * Run with `npm test`. What's pinned: every route appears once at each size,
 * the themes alternate so both show without doubling any page, a site without
 * dark shots degrades to light, skipped cells never tile, and the cap counts
 * everything it leaves out.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { PolishdSnapshot, PolishdSnapshotShot } from "../server/snapshots";
import { planGallery } from "./gallery-plan.ts";

function shot(route: string, device: string, theme: string, pictured = true): PolishdSnapshotShot {
  return { route, device, theme, file: pictured ? `${route}-${device}-${theme}.png` : "" };
}

function snapshot(shots: PolishdSnapshotShot[]): PolishdSnapshot {
  return {
    id: "s1",
    capturedAt: 0,
    origin: "https://example.com",
    fingerprint: null,
    shots,
    authWalled: [],
    noDarkMode: false,
  };
}

const full = (routes: string[]) =>
  routes.flatMap((r) => [
    shot(r, "desktop", "light"),
    shot(r, "desktop", "dark"),
    shot(r, "phone", "light"),
    shot(r, "phone", "dark"),
  ]);

const cell = (s: PolishdSnapshotShot) => `${s.route} ${s.device} ${s.theme}`;

test("each route tiles once per device, themes alternating route by route", () => {
  const { tiles, more } = planGallery(snapshot(full(["/", "/pricing", "/blog"])), 12);
  assert.deepEqual(tiles.map(cell), [
    "/ desktop light",
    "/ phone dark",
    "/pricing desktop dark",
    "/pricing phone light",
    "/blog desktop light",
    "/blog phone dark",
  ]);
  assert.equal(more, 6);
});

test("a site without dark shots shows light everywhere", () => {
  const light = ["/", "/pricing"].flatMap((r) => [shot(r, "desktop", "light"), shot(r, "phone", "light")]);
  const { tiles, more } = planGallery(snapshot(light), 12);
  assert.deepEqual(tiles.map(cell), [
    "/ desktop light",
    "/ phone light",
    "/pricing desktop light",
    "/pricing phone light",
  ]);
  assert.equal(more, 0);
});

test("skipped cells never tile, and a route with one device still shows", () => {
  const shots = [
    shot("/", "desktop", "light"),
    shot("/", "desktop", "dark", false),
    shot("/", "phone", "light", false),
    shot("/", "phone", "dark", false),
    shot("/login", "phone", "light"),
  ];
  const { tiles, more } = planGallery(snapshot(shots), 12);
  assert.deepEqual(tiles.map(cell), ["/ desktop light", "/login phone light"]);
  assert.equal(more, 0);
});

test("the cap trims the tail and counts every pictured shot left out", () => {
  const { tiles, more } = planGallery(snapshot(full(["/", "/a", "/b", "/c"])), 5);
  assert.equal(tiles.length, 5);
  assert.equal(more, 16 - 5);
  assert.deepEqual(planGallery(snapshot(full(["/"])), 0), { tiles: [], more: 4 });
});
