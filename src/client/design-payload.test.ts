/**
 * Tests for fitting a design scan into one ingest event.
 *
 * Run with `npm test`. Ingest drops a `design_scan` payload past 32,000
 * characters (MAX_DESIGN_PAYLOAD_LEN in server/ingest.ts), so the worst page
 * the scan can describe — every list at its cap, every string at its limit,
 * every value carrying a full set of declaration ids — must still fit, and a
 * payload that doesn't must lose its least-used values, not the whole scan.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { PolishdDesignScanPayload } from "../shared/types";
import { MAX_PAYLOAD_CHARS, serializeDesignScan } from "./design-payload.ts";

/** Ingest's cap on `meta.payload`, from server/ingest.ts. */
const INGEST_CAP = 32_000;

/** Five ids of the longest form the scan writes: `!` plus seven base-36 chars. */
const IDS = Array.from({ length: 5 }, (_, i) => `!zzzzzz${i}`).join(" ");

/** Every list at the scan's cap (CAPS in design-scan.ts), every string at its limit. */
function worstCase(): PolishdDesignScanPayload {
  const hex = (i: number) => `#${i.toString(16).padStart(6, "0")}80`;
  return {
    v: 1,
    el: 1500,
    fonts: Array.from({ length: 60 }, (_, i) => [
      `"Some Very Long Variable Font Family Name ${i}"`.padEnd(60, "x").slice(0, 60),
      10 + i / 10,
      100 * ((i % 9) + 1),
      99_999 - i,
      `Sample "text" with quotes \\ and more ${i}`.padEnd(48, "y").slice(0, 48),
      "button,span,div,td",
      38,
      38,
      IDS,
    ]),
    text: Array.from({ length: 48 }, (_, i) => [hex(i), 99_999 - i, 999, 999, IDS]),
    bg: Array.from({ length: 48 }, (_, i) => [hex(i + 100), 99_999 - i, 999, 999, IDS]),
    border: Array.from({ length: 48 }, (_, i) => [hex(i + 200), 99_999 - i, 999, 999, IDS]),
    pairs: Array.from({ length: 60 }, (_, i) => [hex(i), hex(i + 1), 99_999 - i, 10.5, 1]),
    radii: Array.from({ length: 24 }, (_, i) => [`${100 + i}px (mixed)`, 99_999 - i, 999, 999, IDS]),
    pad: Array.from({ length: 40 }, (_, i) => [100 + i, 99_999 - i, 999, 999, IDS]),
    tw: [1500, 1500],
    rem: 16,
  };
}

test("the worst page the scan can describe fits under ingest's cap", () => {
  const payload = worstCase();
  const raw = JSON.stringify(payload).length;
  const out = serializeDesignScan(payload);
  assert.ok(out.length > 0 && out.length <= MAX_PAYLOAD_CHARS && MAX_PAYLOAD_CHARS < INGEST_CAP);
  const parsed = JSON.parse(out) as PolishdDesignScanPayload;
  if (raw > MAX_PAYLOAD_CHARS) {
    // Ids go first: every value and every count survives, only cross-page dedupe is lost.
    assert.equal(parsed.fonts.length, 60);
    assert.equal(parsed.text.length, 48);
    assert.deepEqual(parsed.fonts[0].slice(6), [38, 38, ""]);
    assert.deepEqual(parsed.pad[0], [100, 99_999, 999, 999, ""]);
  }
});

test("a payload that still doesn't fit loses its least-used values, not the scan", () => {
  const payload = worstCase();
  const out = serializeDesignScan(payload, 8_000);
  assert.ok(out.length > 0 && out.length <= 8_000);
  const parsed = JSON.parse(out) as PolishdDesignScanPayload;
  assert.ok(parsed.fonts.length < 60 && parsed.fonts.length > 0);
  // Lists are most-used first, so what's kept is the head.
  assert.deepEqual(parsed.fonts.map((f) => f[3]), payload.fonts.slice(0, parsed.fonts.length).map((f) => f[3]));
  assert.equal(parsed.pad[0][0], 100);
});

test("an ordinary payload goes out untouched, ids and all", () => {
  const payload: PolishdDesignScanPayload = {
    v: 1,
    el: 120,
    fonts: [["Inter", 16, 400, 80, "Body", "p", 2, 0, "a b"]],
    text: [["#111111", 80, 2, 0, "a b"]],
    bg: [],
    border: [],
    pairs: [],
    radii: [["6px", 41, 1, 1, "!btn"]],
    pad: [[9, 152, 5, 5, "!r1 !r2 !r3 !r4 !r5"]],
    tw: [12, 20],
    rem: 16,
  };
  assert.equal(serializeDesignScan(payload), JSON.stringify(payload));
});
