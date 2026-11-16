/**
 * Ingest's write path against a real SQLite store: what gets stored, and what
 * the beacon is told when the store refuses a batch.
 *
 * Its own file (so its own process and database), because the last test
 * breaks the store on purpose.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

for (const key of [
  "POLISHD_DATABASE_URL",
  "BUFFD_DATABASE_URL",
  "POLISH_DATABASE_URL",
  "POLISHD_DASHBOARD_ROUTE",
]) {
  delete process.env[key];
}
process.env.POLISHD_DB_PATH = join(mkdtempSync(join(tmpdir(), "polishd-ingest-write-")), "test.db");

const { exec, query, writeEvents } = await import("./store.ts");
const { STORE_WRITE_FAILED, ingest, ingestTelemetry, plausibleTs } = await import("./ingest.ts");

// performance.timeOrigin + performance.now(): what a browser hands a seed script.
const FRACTIONAL = Date.UTC(2026, 10, 1) + 0.39;

test("plausibleTs always returns a whole millisecond", () => {
  const now = Date.UTC(2026, 10, 16) + 0.7;
  assert.equal(plausibleTs(FRACTIONAL, now), Math.round(FRACTIONAL));
  assert.equal(plausibleTs(FRACTIONAL + 0.2, now), Math.round(FRACTIONAL) + 1);
  assert.equal(plausibleTs(Number.NaN, now), Math.round(now), "the fallback is whole too");
  assert.ok(Number.isInteger(plausibleTs(FRACTIONAL, now)));
});

test("a batch with fractional timestamps is stored, with integer ts", async () => {
  const result = await ingest(
    {
      events: [
        { type: "page_view", ts: FRACTIONAL, path: "/fractional" },
        { type: "click", ts: FRACTIONAL + 10.5, path: "/fractional", selector: "button", text: "Go" },
      ],
    },
    "frac-session",
  );
  assert.deepEqual(result, { ok: true, stored: 2 });
  const rows = await query(`SELECT ts FROM polishd_events WHERE session_id = ? ORDER BY ts`, [
    "frac-session",
  ]);
  assert.deepEqual(
    rows.map((r) => Number(r.ts)),
    [Math.round(FRACTIONAL), Math.round(FRACTIONAL + 10.5)],
  );
});

test("an empty batch is not reported as a failure", async () => {
  assert.deepEqual(await ingest({ events: [] }, "empty-session"), { ok: true, stored: 0 });
});

// Keep last: it drops the events table.
test("a write the store refuses is reported and warned, not silent", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  await exec(`DROP TABLE polishd_events`);

  const direct = await writeEvents("broken", [{ type: "page_view", ts: Date.now(), path: "/x" }]);
  assert.equal(direct.stored, 0);
  assert.match(direct.error ?? "", /polishd_events/);

  const result = await ingest({ events: [{ type: "page_view", ts: FRACTIONAL, path: "/lost" }] }, "broken");
  assert.deepEqual(result, { ok: true, stored: 0, reason: STORE_WRITE_FAILED });

  const telemetry = await ingestTelemetry(
    { sessionId: "tele-session", events: [{ type: "page_view", ts: Date.now(), path: "/t" }] },
    "example.com",
  );
  assert.equal(telemetry.reason, STORE_WRITE_FAILED);

  assert.ok(
    warn.mock.calls.some((c) => String(c.arguments[0]).includes("insert failed")),
    "the server log says a batch was dropped",
  );
});
