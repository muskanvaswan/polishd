/**
 * Tests for rage-click counting.
 *
 * Run with `npm test`. The tracker answers at the click itself, from the
 * click stream alone — the dead-click hold never enters into it, so judging
 * outcomes can't delay a rage click or change which bursts count.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { createRageTracker } from "./rage.ts";

test("the third hit inside the window is rage — decided on that click, not later", () => {
  const rage = createRageTracker(3, 500);
  assert.deepEqual(
    [rage.hit("div#dead", 0), rage.hit("div#dead", 100), rage.hit("div#dead", 200)],
    [false, false, true],
  );
  assert.equal(rage.hit("div#dead", 300), false, "a burst is reported once");
});

test("each hit only has to follow the previous one within the window", () => {
  const rage = createRageTracker(3, 500);
  rage.hit("a", 0);
  rage.hit("a", 450);
  assert.equal(rage.hit("a", 900), true);
});

test("a gap or a different element starts over", () => {
  const rage = createRageTracker(3, 500);
  rage.hit("a", 0);
  rage.hit("a", 100);
  assert.equal(rage.hit("a", 700), false, "past the window");
  rage.hit("b", 750);
  assert.equal(rage.hit("a", 800), false, "another element in between");
  assert.equal(rage.hit(undefined, 850), false);
});
