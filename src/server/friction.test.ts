/**
 * Tests for the friction index fold.
 *
 * Run with `npm test`. Rows stand in for the grouped query's output (one row
 * per kind × page × target × session [× meta]), most recent first.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { foldFriction, type FrictionRow } from "./friction.ts";

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
    row({ type: "js_error", session: "a", path: "/checkout", meta: { message: "boom" } }),
    row({ type: "dead_click", session: "a", path: "/checkout", selector: "div.x", n: 2 }),
  ]);
  const page = idx.pages.find((p) => p.path === "/checkout")!;
  assert.equal(page.error.count, 1);
  assert.equal(page.dead.count, 2);
  assert.equal(page.rage.count, 0);
});

test("errors carry digest, frame and the interaction that preceded them, when captured", () => {
  const idx = foldFriction([
    // Most recent first: the newest digest/frame wins.
    row({ type: "js_error", session: "a", path: "/cart", meta: { message: "x is undefined", digest: "123", frame: "at Cart (app/cart/page.tsx:4:2)", after: "Checkout", afterMs: 120 } }),
    row({ type: "js_error", session: "b", path: "/cart", meta: { message: "x is undefined", digest: "999", after: "Checkout", afterMs: 80 } }),
    row({ type: "js_error", session: "b", path: "/", meta: { message: "x is undefined", after: "Apply coupon", afterMs: 40 }, n: 1 }),
    row({ type: "js_error", session: "c", path: "/cart", meta: { message: "x is undefined", after: "Checkout", afterMs: 300 } }),
  ]);
  const [e] = idx.errors;
  assert.equal(e.message, "x is undefined");
  assert.deepEqual(e.tally, { count: 4, sessions: 3, pages: ["/cart", "/"] });
  assert.equal(e.digest, "123");
  assert.equal(e.frame, "at Cart (app/cart/page.tsx:4:2)");
  assert.deepEqual(e.after, { label: "Checkout", count: 3, medianMs: 120 });
});

test("errors without the new meta fold exactly as before — no empty fields", () => {
  const idx = foldFriction([
    row({ type: "js_error", session: "a", meta: { message: "boom", source: "app.js", line: 3 } }),
    row({ type: "js_error", session: "a", meta: null }),
  ]);
  const boom = idx.errors.find((e) => e.message === "boom")!;
  assert.deepEqual(Object.keys(boom).sort(), ["message", "tally"]);
  assert.ok(idx.errors.some((e) => e.message === "Unknown error"));
});

test("a numeric digest is kept as text; non-numeric afterMs is ignored", () => {
  const idx = foldFriction([
    row({ type: "js_error", session: "a", meta: { message: "m", digest: 4242, after: "Save", afterMs: "soon" } }),
  ]);
  assert.equal(idx.errors[0].digest, "4242");
  assert.deepEqual(idx.errors[0].after, { label: "Save", count: 1 });
});

test("the cap flag passes through; empty input is an empty index", () => {
  assert.equal(foldFriction([], true).capped, true);
  assert.deepEqual(foldFriction([]), { clicks: [], pages: [], errors: [], capped: false });
});
