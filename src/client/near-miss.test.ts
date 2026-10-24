/**
 * Tests for finding the control a dead click narrowly missed.
 *
 * Run with `npm test`. No DOM: elements are plain objects with a rect, a
 * parent and children, and `hitTest` returns the deepest one under a point.
 * The layout that matters is the one from the report — a full-width row whose
 * only control is a text-sized "Show 9 more" button.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  distanceToRect,
  findNearMiss,
  probePoints,
  withoutLabel,
  type NearMissDeps,
  type RectLike,
} from "./near-miss.ts";

interface Box {
  name: string;
  rect: RectLike;
  control: boolean;
  parent: Box | null;
  children: Box[];
}

const box = (
  name: string,
  [left, top, width, height]: [number, number, number, number],
  parent: Box | null,
  control = false,
): Box => {
  const b: Box = {
    name,
    rect: { left, top, right: left + width, bottom: top + height },
    control,
    parent,
    children: [],
  };
  parent?.children.push(b);
  return b;
};

const inRect = (x: number, y: number, r: RectLike) =>
  x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

/** The DOM over a tree of boxes, on a 1440×900 viewport. */
const depsFor = (root: Box): NearMissDeps<Box> => ({
  isControl: (el) => el.control,
  controlOf(el) {
    let n: Box | null = el;
    for (let depth = 0; n && depth < 4; depth++, n = n.parent) if (n.control) return n;
    return null;
  },
  children: (el) => el.children,
  rect: (el) => el.rect,
  hitTest(x, y) {
    let hit: Box | null = null;
    const visit = (b: Box) => {
      if (!inRect(x, y, b.rect)) return;
      hit = b;
      b.children.forEach(visit);
    };
    visit(root);
    return hit;
  },
  viewportArea: () => 1440 * 900,
});

test("a bar wrapping a text-sized button names the button, however far the click", () => {
  const page = box("page", [0, 0, 1440, 900], null);
  const bar = box("bar", [0, 400, 1200, 40], page);
  const button = box("show-more", [20, 410, 120, 20], bar, true);
  const miss = findNearMiss(bar, { x: 1100, y: 420 }, depsFor(page));
  assert.deepEqual(miss && { control: miss.control.name, contained: miss.contained }, {
    control: button.name,
    contained: true,
  });
});

test("of a few contained controls, the nearest wins", () => {
  const page = box("page", [0, 0, 1440, 900], null);
  const toolbar = box("toolbar", [0, 0, 600, 48], page);
  box("bold", [10, 10, 28, 28], toolbar, true);
  box("italic", [44, 10, 28, 28], toolbar, true);
  box("link", [560, 10, 28, 28], toolbar, true);
  assert.equal(findNearMiss(toolbar, { x: 500, y: 24 }, depsFor(page))?.control.name, "link");
});

test("a layout container is not a near miss by containment", () => {
  // Too many controls inside to say which was meant…
  const page = box("page", [0, 0, 1440, 900], null);
  const nav = box("nav", [0, 0, 600, 60], page);
  for (let i = 0; i < 4; i++) box(`tab${i}`, [i * 100, 10, 80, 40], nav, true);
  assert.equal(findNearMiss(nav, { x: 560, y: 30 }, depsFor(page)), null);

  // …or too much of the screen, however few controls it holds.
  const root = box("root", [0, 0, 1440, 900], null);
  const hero = box("hero", [0, 0, 1440, 700], root);
  box("cta", [600, 500, 200, 48], hero, true);
  assert.equal(findNearMiss(hero, { x: 100, y: 100 }, depsFor(root)), null);
});

test("hidden controls are not candidates", () => {
  const page = box("page", [0, 0, 1440, 900], null);
  const row = box("row", [0, 100, 800, 40], page);
  box("collapsed", [10, 110, 0, 0], row, true);
  assert.equal(findNearMiss(row, { x: 700, y: 120 }, depsFor(page)), null);
});

test("a control's own subtree isn't searched — its icon is the control", () => {
  const page = box("page", [0, 0, 1440, 900], null);
  const row = box("row", [0, 100, 800, 40], page);
  const button = box("button", [10, 110, 100, 20], row, true);
  box("icon", [12, 112, 16, 16], button, true);
  assert.equal(findNearMiss(row, { x: 700, y: 120 }, depsFor(page))?.control, button);
});

test("a control bordering the click point is found by probing around it", () => {
  const page = box("page", [0, 0, 1440, 900], null);
  const list = box("list", [0, 0, 700, 400], page);
  for (let i = 0; i < 5; i++) box(`item${i}`, [0, i * 50, 600, 40], list, true);
  const gap = box("gap", [0, 40, 600, 10], list); // the strip between two items
  const miss = findNearMiss(gap, { x: 300, y: 45 }, depsFor(page));
  assert.deepEqual(miss && { control: miss.control.name, contained: miss.contained }, {
    control: "item1",
    contained: false,
  });
});

test("nothing within the probe rings is no near miss", () => {
  const page = box("page", [0, 0, 1440, 900], null);
  const panel = box("panel", [0, 0, 1440, 900], page);
  box("far", [1300, 800, 80, 40], panel, true);
  const spacer = box("spacer", [600, 400, 10, 10], panel);
  assert.equal(findNearMiss(spacer, { x: 605, y: 405 }, depsFor(page)), null);
});

test("a keyboard or scripted click is matched by containment only", () => {
  const page = box("page", [0, 0, 1440, 900], null);
  const bar = box("bar", [0, 0, 600, 40], page);
  const button = box("button", [10, 10, 80, 20], bar, true);
  assert.equal(findNearMiss(bar, null, depsFor(page))?.control, button);
  const gap = box("gap", [0, 40, 600, 10], page);
  assert.equal(findNearMiss(gap, null, depsFor(page)), null);
});

test("geometry: distance to a rect, and the probe rings", () => {
  const r = { left: 10, top: 10, right: 20, bottom: 20 };
  assert.equal(distanceToRect({ x: 15, y: 15 }, r), 0);
  assert.equal(distanceToRect({ x: 25, y: 15 }, r), 5);
  assert.equal(distanceToRect({ x: 23, y: 24 }, r), 5);
  const points = probePoints({ x: 0, y: 0 });
  assert.equal(points.length, 24);
  assert.deepEqual(points[0], { x: 12, y: 0 }, "nearest ring first");
  assert.ok(points.every((p) => Math.round(Math.hypot(p.x, p.y)) <= 40));
});

test("withoutLabel strips the contained control's text from the click's label", () => {
  assert.equal(withoutLabel("Show # more type styles ↓", "Show # more type styles ↓"), undefined);
  assert.equal(withoutLabel("Weekly report Read more", "Read more"), "Weekly report");
  assert.equal(withoutLabel("Unrelated", "Read more"), "Unrelated");
  assert.equal(withoutLabel(undefined, "Read more"), undefined);
  assert.equal(withoutLabel("Label", undefined), "Label");
});
