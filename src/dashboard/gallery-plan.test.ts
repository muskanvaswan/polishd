/**
 * Tests for the Overview gallery's selection.
 *
 * Run with `npm test`. What's pinned: the homepage leads at its largest, the
 * next two pages by traffic follow, the homepage's phone shot fills the
 * column between them, a site without dark shots degrades to light, skipped
 * cells never tile, fewer pages lend their other renderings before a tile is
 * left out, and the count left out is every pictured shot not shown.
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

const cell = (t: { shot: PolishdSnapshotShot; slot: string }) =>
  `${t.slot}: ${t.shot.route} ${t.shot.device} ${t.shot.theme}`;

test("the homepage leads, the two most visited other pages follow, its phone shot fills the column", () => {
  const snap = snapshot(full(["/", "/settings", "/signup", "/blog", "/pricing"]));
  const { tiles, more } = planGallery(snap, ["/pricing", "/", "/blog", "/signup"]);
  assert.deepEqual(tiles.map(cell), [
    "hero: / desktop light",
    "phone: / phone dark",
    "second: /pricing desktop light",
    "third: /blog desktop light",
  ]);
  assert.equal(more, 20 - 4);
});

test("without a homepage the most visited page leads, and unranked pages fill in", () => {
  const snap = snapshot(full(["/pricing", "/blog", "/about"]));
  const { tiles } = planGallery(snap, ["/blog", "/pricing"]);
  assert.deepEqual(tiles.map(cell), [
    "hero: /blog desktop light",
    "phone: /blog phone dark",
    "second: /pricing desktop light",
    "third: /about desktop light",
  ]);
});

test("a site without dark shots shows light everywhere", () => {
  const light = ["/", "/a", "/b"].flatMap((r) => [shot(r, "desktop", "light"), shot(r, "phone", "light")]);
  const { tiles, more } = planGallery(snapshot(light), []);
  assert.deepEqual(tiles.map(cell), [
    "hero: / desktop light",
    "phone: / phone light",
    "second: /a desktop light",
    "third: /b desktop light",
  ]);
  assert.equal(more, 2);
});

test("fewer pages borrow the pages' other renderings rather than leave tiles out", () => {
  const two = planGallery(snapshot(full(["/", "/pricing"])), []);
  assert.deepEqual(two.tiles.map(cell), [
    "hero: / desktop light",
    "phone: / phone dark",
    "second: /pricing desktop light",
    "third: /pricing desktop dark",
  ]);
  assert.equal(two.more, 4);
  const one = planGallery(snapshot(full(["/"])), []);
  assert.deepEqual(one.tiles.map(cell), [
    "hero: / desktop light",
    "phone: / phone dark",
    "second: / desktop dark",
    "third: / phone light",
  ]);
  assert.equal(one.more, 0);
  // Fewer shots than tiles: what there is, in its place.
  const pair = planGallery(snapshot([shot("/", "desktop", "light"), shot("/", "phone", "light")]), []);
  assert.deepEqual(pair.tiles.map(cell), ["hero: / desktop light", "phone: / phone light"]);
  assert.deepEqual(planGallery(snapshot([shot("/", "desktop", "light")]), []).tiles.map(cell), [
    "hero: / desktop light",
  ]);
});

test("skipped cells never tile, and a homepage shot only on a phone still leads", () => {
  const shots = [
    shot("/", "desktop", "light", false),
    shot("/", "phone", "light"),
    shot("/a", "desktop", "light"),
    shot("/a", "phone", "dark", false),
    shot("/b", "desktop", "dark"),
  ];
  const { tiles, more } = planGallery(snapshot(shots), []);
  assert.deepEqual(tiles.map(cell), [
    "hero: / phone light",
    "second: /a desktop light",
    "third: /b desktop dark",
  ]);
  assert.equal(more, 0);
});

test("nothing pictured is nothing to show", () => {
  assert.deepEqual(planGallery(snapshot([shot("/", "desktop", "light", false)]), ["/"]), {
    tiles: [],
    more: 0,
  });
});
