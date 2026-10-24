/**
 * Tests for rage-click counting.
 *
 * Run with `npm test`. The tracker answers at the click itself, from the
 * click stream alone — the dead-click hold never enters into it, so judging
 * outcomes can't delay a rage click or change which bursts count. Hits are
 * counted per key: a control element by identity, or — for something that
 * isn't a control — a selector string.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { createRageTracker } from "./rage.ts";

const likeButton = { tag: "button", className: "like-btn" };
const other = { tag: "div" };

test("the third hit inside the window is rage — decided on that click, not later", () => {
  const rage = createRageTracker(3, 500);
  assert.deepEqual(
    [rage.hit(likeButton, 0), rage.hit(likeButton, 100), rage.hit(likeButton, 200)],
    [false, false, true],
  );
  assert.equal(rage.hit(likeButton, 300), false, "a burst is reported once");
});

test("an element whose classes change as it's clicked is still one element", () => {
  // A like button toggles `liked` on every click, so its selector string
  // alternates — which used to reset the count on every click.
  const rage = createRageTracker(3, 500);
  const hits = [0, 1, 2, 3, 4, 5].map((i) => {
    likeButton.className = i % 2 ? "like-btn liked" : "like-btn";
    return rage.hit(likeButton, i * 80);
  });
  assert.deepEqual(hits, [false, false, true, false, false, false]);
});

test("each hit only has to follow the previous one within the window", () => {
  const rage = createRageTracker(3, 500);
  rage.hit(likeButton, 0);
  rage.hit(likeButton, 450);
  assert.equal(rage.hit(likeButton, 900), true);
});

test("a fake control is keyed by its selector, and still adds up to rage", () => {
  // A plain <div> styled as a button: no control to key on, so its selector —
  // the case rage exists for.
  const rage = createRageTracker(3, 500);
  assert.deepEqual(
    [rage.hit("div.fake-btn", 0), rage.hit("div.fake-btn", 90), rage.hit("div.fake-btn", 180)],
    [false, false, true],
  );
  assert.equal(rage.hit("div.other", 200), false);
});

test("an element and a string never match each other", () => {
  const rage = createRageTracker(2, 500);
  rage.hit("[object Object]", 0);
  assert.equal(rage.hit(likeButton, 10), false);
});

test("a gap or a different element starts over", () => {
  const rage = createRageTracker(3, 500);
  rage.hit(likeButton, 0);
  rage.hit(likeButton, 100);
  assert.equal(rage.hit(likeButton, 700), false, "past the window");
  rage.hit(other, 750);
  assert.equal(rage.hit(likeButton, 800), false, "another element in between");
  assert.equal(rage.hit(null, 850), false);
  assert.equal(rage.hit(null, 900), false, "no element is never a burst");
  assert.equal(rage.hit(null, 950), false);
});
