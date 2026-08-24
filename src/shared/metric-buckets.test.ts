import assert from "node:assert/strict";
import { test } from "node:test";

import { trendWindow } from "./metric-buckets.ts";

const NOW = 1000;

test("no buckets means no chart", () => {
  assert.deepEqual(trendWindow([], 48, NOW), []);
});

test("a single bucket is a one-point series", () => {
  assert.deepEqual(trendWindow([900], 48, NOW), [900]);
});

test("quiet buckets between two busy ones are filled in", () => {
  assert.deepEqual(trendWindow([10, 13], 48, NOW), [10, 11, 12, 13]);
});

test("input order does not matter", () => {
  assert.deepEqual(trendWindow([13, 10, 11], 48, NOW), [10, 11, 12, 13]);
});

test("only the most recent maxBuckets are drawn", () => {
  assert.deepEqual(trendWindow([1, 50], 3, NOW), [48, 49, 50]);
});

test("a window shorter than the cap keeps its own start", () => {
  assert.deepEqual(trendWindow([48, 50], 10, NOW), [48, 49, 50]);
});

test("the window ends at the newest data, not at now", () => {
  // Last activity three buckets ago: the chart still ends where the data does
  // rather than trailing off into empty buckets up to the present.
  assert.deepEqual(trendWindow([995, 997], 48, NOW), [995, 996, 997]);
});

test("a visitor's clock running fast cannot anchor the window", () => {
  assert.deepEqual(trendWindow([998, 999, 90_000], 48, NOW), [998, 999]);
});

test("the current bucket is not skew", () => {
  assert.deepEqual(trendWindow([NOW], 48, NOW), [NOW]);
});

test("nothing but future buckets is nothing to draw", () => {
  assert.deepEqual(trendWindow([5000, 6000], 48, NOW), []);
});

test("a cap of zero still returns the newest bucket", () => {
  assert.deepEqual(trendWindow([10, 20], 0, NOW), [20]);
});
