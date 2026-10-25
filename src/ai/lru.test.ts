/**
 * Tests for the bounded cache GitHub reads go through.
 *
 * Run with `npm test`. What matters is that it stays bounded — by entries,
 * by size, by age — and that what it evicts is what was used least recently.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { Lru } from "./lru.ts";

test("evicts the least recently used past the entry cap", () => {
  const c = new Lru<number>({ maxEntries: 2 });
  c.set("a", 1);
  c.set("b", 2);
  c.get("a"); // a is now the most recent
  c.set("c", 3);
  assert.equal(c.get("b"), undefined);
  assert.equal(c.get("a"), 1);
  assert.equal(c.get("c"), 3);
});

test("stays under its size cap, and never stores what can't fit", () => {
  const c = new Lru<string>({ maxEntries: 100, maxSize: 10, sizeOf: (s) => s.length });
  c.set("a", "12345");
  c.set("b", "12345");
  c.set("c", "123"); // 13 > 10: a goes
  assert.equal(c.get("a"), undefined);
  assert.equal(c.get("b"), "12345");
  c.set("huge", "x".repeat(11));
  assert.equal(c.get("huge"), undefined);
  assert.equal(c.get("c"), "123", "an oversized value evicts nothing");
});

test("expires entries past their time to live", () => {
  let now = 0;
  const c = new Lru<string>({ maxEntries: 4, ttlMs: 1000, now: () => now });
  c.set("branch", "main");
  now = 999;
  assert.equal(c.get("branch"), "main");
  now = 2001;
  assert.equal(c.get("branch"), undefined);
  assert.equal(c.size, 0);
});

test("re-setting a key replaces it without double-counting its size", () => {
  const c = new Lru<string>({ maxEntries: 10, maxSize: 10, sizeOf: (s) => s.length });
  c.set("a", "12345");
  c.set("a", "123456789");
  c.set("b", "1");
  assert.equal(c.get("a"), "123456789");
  assert.equal(c.get("b"), "1");
});
