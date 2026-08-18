/**
 * Tests for the capture-health rule.
 *
 * Run with `npm test`. The subject is deliberately pure — no database, no
 * renderer — so these are plain assertions over plain objects.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CAPTURE_WINDOW_MS,
  captureStatus,
  foldNoSessionDrop,
  noSessionCountSince,
  parseNoSessionRecord,
  type CaptureHealth,
} from "./capture-status.ts";

const NOW = 1_770_000_000_000; // fixed clock; nothing here reads Date.now()
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function health(over: Partial<CaptureHealth> = {}): CaptureHealth {
  return {
    noSessionCount: 0,
    recentNoSessionCount: 0,
    lastNoSessionAt: null,
    lastStoredAt: null,
    recentEvents: 0,
    recentBatches: 0,
    windowMs: CAPTURE_WINDOW_MS,
    ...over,
  };
}

// ── The reported false positive ──────────────────────────────────────────────

test("a healthy site with old drops and one recent drop shows no red banner", () => {
  // The install from the bug report: storing normally, seven cookie-less
  // batches all-time (six from before the proxy was deployed), one of them
  // ten minutes ago, and a real visitor since.
  const status = captureStatus(
    health({
      noSessionCount: 7,
      recentNoSessionCount: 1,
      lastNoSessionAt: NOW - 10 * 60_000,
      lastStoredAt: NOW - 60_000,
      recentEvents: 1_840,
      recentBatches: 96,
    }),
    12_400,
    NOW,
  );

  assert.notEqual(status.level, "broken");
  assert.equal(status.level, "ok"); // one drop isn't worth a word either
  assert.equal(status.storedSinceDrop, true);
  assert.equal(status.nothingStored, false);
});

test("history alone never re-arms the alert", () => {
  // Same site, but the drops are ancient and none is inside the window. The
  // old rule tripped on the all-time total; this one has nothing to count.
  const status = captureStatus(
    health({
      noSessionCount: 4_000,
      recentNoSessionCount: 0,
      lastNoSessionAt: NOW - 90 * DAY,
      lastStoredAt: NOW - 30_000,
      recentEvents: 12,
      recentBatches: 3,
    }),
    500, // low volume: the old 1-in-400 ratio would have tripped instantly
    NOW,
  );
  assert.equal(status.level, "ok");
});

test("a low-volume site with steady bot noise gets a neutral note, not red", () => {
  const status = captureStatus(
    health({
      noSessionCount: 40,
      recentNoSessionCount: 9,
      lastNoSessionAt: NOW - 5 * 60_000,
      lastStoredAt: NOW - 2 * 60_000,
      recentEvents: 210,
      recentBatches: 31,
    }),
    900,
    NOW,
  );
  assert.equal(status.level, "notice");
  assert.equal(status.droppedBatches, 9);
  assert.equal(status.storedBatches, 31);
  assert.ok(status.sharePct !== null && Math.round(status.sharePct) === 23);
});

// ── The cases the red banner exists for ──────────────────────────────────────

test("drops with nothing ever stored is a broken proxy", () => {
  const status = captureStatus(
    health({ noSessionCount: 2, recentNoSessionCount: 2, lastNoSessionAt: NOW - 60_000 }),
    0,
    NOW,
  );
  assert.equal(status.level, "broken");
  assert.equal(status.nothingStored, true);
});

test("a proxy that stops minting goes red once nothing lands in the window", () => {
  const status = captureStatus(
    health({
      noSessionCount: 900,
      recentNoSessionCount: 120,
      lastNoSessionAt: NOW - 60_000,
      lastStoredAt: NOW - 3 * DAY, // last store predates every drop
      recentEvents: 0,
      recentBatches: 0,
    }),
    50_000,
    NOW,
  );
  assert.equal(status.level, "broken");
  assert.equal(status.storedSinceDrop, false);
  assert.equal(status.nothingStored, false); // so the copy must not say "nothing is being stored"
});

test("a dormant site poked by a crawler stays quiet", () => {
  // No traffic for days and two cookie-less pokes: not evidence of a failure.
  const status = captureStatus(
    health({
      noSessionCount: 2,
      recentNoSessionCount: 2,
      lastNoSessionAt: NOW - HOUR,
      lastStoredAt: NOW - 5 * DAY,
      recentEvents: 0,
      recentBatches: 0,
    }),
    3_000,
    NOW,
  );
  assert.equal(status.level, "ok");
});

test("a store after the last drop suppresses red even with heavy drops", () => {
  const status = captureStatus(
    health({
      noSessionCount: 5_000,
      recentNoSessionCount: 400,
      lastNoSessionAt: NOW - 2 * 60_000,
      lastStoredAt: NOW - 60_000,
      recentEvents: 6,
      recentBatches: 2,
    }),
    900,
    NOW,
  );
  assert.equal(status.level, "notice");
  assert.equal(status.storedSinceDrop, true);
});

test("no drops at all says nothing", () => {
  assert.equal(captureStatus(health({ lastStoredAt: NOW }), 100, NOW).level, "ok");
  assert.equal(captureStatus(health(), 0, NOW).level, "ok");
});

// ── The rolling record ───────────────────────────────────────────────────────

test("drops fold into hour buckets and age out of the window", () => {
  let rec = foldNoSessionDrop(null, NOW - 40 * HOUR, 6); // before the window
  rec = foldNoSessionDrop(rec, NOW - 2 * HOUR, 2);
  rec = foldNoSessionDrop(rec, NOW - 90 * 60_000, 1);
  rec = foldNoSessionDrop(rec, NOW, 3);

  assert.equal(rec.count, 12); // all-time total keeps everything
  assert.equal(rec.lastAt, NOW);
  assert.equal(noSessionCountSince(rec, NOW - CAPTURE_WINDOW_MS), 6); // the 40h-old six are gone
  assert.equal(noSessionCountSince(rec, NOW - 30 * 60_000), 3);
});

test("two drops in the same hour share a bucket", () => {
  let rec = foldNoSessionDrop(null, NOW, 1);
  rec = foldNoSessionDrop(rec, NOW + 60_000, 4);
  assert.equal(rec.buckets.length, 1);
  assert.equal(rec.buckets[0].n, 5);
});

test("buckets are bounded however long a proxy stays broken", () => {
  let rec = foldNoSessionDrop(null, NOW - 500 * HOUR, 1);
  for (let i = 499; i >= 0; i--) rec = foldNoSessionDrop(rec, NOW - i * HOUR, 1);
  assert.ok(rec.buckets.length <= 26, `kept ${rec.buckets.length} buckets`);
  assert.equal(rec.count, 501);
});

test("a pre-0.2.3 record parses, and its undated drops count toward no window", () => {
  const rec = parseNoSessionRecord(JSON.stringify({ count: 7, lastAt: NOW - 10 * 60_000 }));
  assert.ok(rec);
  assert.equal(rec.count, 7);
  assert.deepEqual(rec.buckets, []);
  assert.equal(noSessionCountSince(rec, NOW - CAPTURE_WINDOW_MS), 0);

  // Which is exactly what keeps the reported install out of the red banner.
  assert.equal(
    captureStatus(
      health({
        noSessionCount: rec.count,
        recentNoSessionCount: noSessionCountSince(rec, NOW - CAPTURE_WINDOW_MS),
        lastNoSessionAt: rec.lastAt,
        lastStoredAt: NOW - 60_000,
        recentEvents: 100,
        recentBatches: 20,
      }),
      12_400,
      NOW,
    ).level,
    "ok",
  );
});

test("junk and absent records parse to null", () => {
  assert.equal(parseNoSessionRecord(null), null);
  assert.equal(parseNoSessionRecord(""), null);
  assert.equal(parseNoSessionRecord("not json"), null);
  assert.equal(noSessionCountSince(null, 0), 0);
});
