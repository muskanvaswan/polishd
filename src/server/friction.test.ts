/**
 * Tests for the friction index fold.
 *
 * Run with `npm test`. Rows stand in for the grouped query's output (one row
 * per kind × page × target × session [× meta]), most recent first.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { foldFriction, withRageHandles, type FrictionRow } from "./friction.ts";

const row = (r: Partial<FrictionRow> & Pick<FrictionRow, "type" | "session">): FrictionRow => ({
  path: "/",
  selector: null,
  component: null,
  text: null,
  meta: null,
  n: 1,
  ...r,
});

test("click friction counts events, distinct sessions and pages, per kind", () => {
  const idx = foldFriction([
    row({ type: "dead_click", session: "a", selector: "div.flex", text: "Show 9 more", n: 5 }),
    row({ type: "dead_click", session: "b", selector: "div.flex", path: "/blog", n: 2 }),
    row({ type: "dead_click", session: "a", selector: "div.flex", path: "/blog", n: 1 }),
    row({ type: "rage_click", session: "c", selector: "div.flex", n: 3 }),
  ]);
  assert.equal(idx.clicks.length, 1);
  const [c] = idx.clicks;
  assert.equal(c.key, "div.flex");
  assert.equal(c.by, "selector");
  assert.equal(c.text, "Show 9 more");
  assert.deepEqual(c.dead, { count: 8, sessions: 2, pages: ["/", "/blog"] });
  assert.deepEqual(c.rage, { count: 3, sessions: 1, pages: ["/"] });
  assert.deepEqual(c.near, []);
});

test("clicks inside a monitored component are keyed by the component", () => {
  const idx = foldFriction([
    row({ type: "dead_click", session: "a", selector: "div.a", component: "pricing-table" }),
    row({ type: "dead_click", session: "b", selector: "div.b", component: "pricing-table" }),
  ]);
  assert.equal(idx.clicks.length, 1);
  assert.equal(idx.clicks[0].by, "component");
  assert.equal(idx.clicks[0].key, "pricing-table");
  assert.equal(idx.clicks[0].dead.sessions, 2);
});

test("near-miss labels are tallied by events, most frequent first", () => {
  const idx = foldFriction([
    row({ type: "dead_click", session: "a", selector: "div.bar", meta: { near: "Show 9 more" }, n: 4 }),
    row({ type: "dead_click", session: "b", selector: "div.bar", meta: { near: "Filter" }, n: 1 }),
    row({ type: "dead_click", session: "c", selector: "div.bar", meta: { near: "Show 9 more" }, n: 2 }),
    row({ type: "dead_click", session: "d", selector: "div.bar", meta: { near: "  " } }),
    row({ type: "dead_click", session: "e", selector: "div.bar" }), // older client: no meta
  ]);
  assert.deepEqual(idx.clicks[0].near, [
    { label: "Show 9 more", count: 6 },
    { label: "Filter", count: 1 },
  ]);
  assert.equal(idx.clicks[0].dead.count, 9);
});

test("pages tally each kind separately, and keep the most affected first", () => {
  const idx = foldFriction([
    row({ type: "rage_click", session: "a", path: "/checkout", selector: "button.pay" }),
    row({ type: "dead_click", session: "a", path: "/checkout", selector: "div.x", n: 2 }),
    row({ type: "dead_click", session: "b", path: "/", selector: "div.x" }),
  ]);
  const page = idx.pages.find((p) => p.path === "/checkout")!;
  assert.equal(page.rage.count, 1);
  assert.equal(page.dead.count, 2);
  assert.equal(idx.pages.find((p) => p.path === "/")!.rage.count, 0);
});

test("the cap flag passes through; empty input is an empty index", () => {
  assert.equal(foldFriction([], true).capped, true);
  assert.deepEqual(foldFriction([]), { clicks: [], pages: [], capped: false });
});

test("handles are kept per target, most frequent first", () => {
  const idx = foldFriction([
    row({ type: "rage_click", session: "a", selector: "div.x", meta: { handle: "div#toolbar>button.export" }, n: 3 }),
    row({ type: "dead_click", session: "b", selector: "div.x", meta: { handle: "div#toolbar>div.x" } }),
  ]);
  assert.equal(idx.clicks[0].handle, "div#toolbar>button.export");
  const old = foldFriction([row({ type: "dead_click", session: "a", selector: "div.x" })]);
  assert.equal("handle" in old.clicks[0], false, "older clients: no field at all");
});

test("rage-click handles arrive separately and fill only targets that lack one", () => {
  // Rage rows are grouped without their meta (so they don't split per distinct meta).
  const idx = foldFriction([
    row({ type: "rage_click", session: "a", selector: "div.rage-only", n: 4 }),
    row({ type: "dead_click", session: "b", selector: "div.both", meta: { handle: "div#a>div.both" } }),
    row({ type: "rage_click", session: "b", selector: "div.both" }),
  ]);
  const withHandles = withRageHandles(idx, [
    { selector: "div.rage-only", component: null, handle: "div#a>div.rage-only", n: 3 },
    { selector: "div.rage-only", component: null, handle: "div#b>div.rage-only", n: 1 },
    { selector: "div.both", component: null, handle: "div#z>div.both", n: 9 },
  ]);
  const by = (key: string) => withHandles.clicks.find((c) => c.key === key)!;
  assert.equal(by("div.rage-only").handle, "div#a>div.rage-only");
  assert.equal(by("div.both").handle, "div#a>div.both", "a dead-click handle is kept");
  assert.equal(by("div.rage-only").rage.count, 4, "counts untouched");
});
