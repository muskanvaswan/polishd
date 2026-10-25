/**
 * Tests for the bounded wait that keeps source matching from outliving the
 * model call it follows.
 *
 * Run with `npm test`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { settleWithin } from "./deadline.ts";

test("returns the work's result when it finishes in time", async () => {
  assert.equal(await settleWithin(Promise.resolve("matched"), 50, "unmatched"), "matched");
});

test("returns the fallback when the work stalls past the deadline", async () => {
  const stalled = new Promise<string>(() => {}); // a GitHub read that never answers
  const started = Date.now();
  assert.equal(await settleWithin(stalled, 30, "unmatched"), "unmatched");
  assert.ok(Date.now() - started < 1000);
});

test("a rejection in time rejects; one after the deadline is swallowed", async () => {
  await assert.rejects(settleWithin(Promise.reject(new Error("boom")), 50, "x"), /boom/);
  const late = new Promise<string>((_, reject) => setTimeout(() => reject(new Error("late")), 40));
  assert.equal(await settleWithin(late, 10, "fallback"), "fallback");
  await new Promise((r) => setTimeout(r, 60)); // the late rejection must not surface as unhandled
});
