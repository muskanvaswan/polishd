/**
 * The store against real Postgres databases, one per case. Each case runs in
 * its own child process, since the store latches its first result.
 *
 * Needs databases (skipped without them):
 *   POLISHD_TEST_PG_FRESH       empty
 *   POLISHD_TEST_PG_APP_EVENTS  the app's own `events` table, with an index
 *   POLISHD_TEST_PG_LEGACY      Polishd's pre-0.3.2 `events`, rows and idx_events_* indexes,
 *                               plus an app table with an index of its own named idx_events_orders
 *   POLISHD_TEST_PG_TAKEN       a `polishd_events` table that isn't Polishd's
 *
 * Each run needs them freshly made: the first run migrates the legacy one.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const STORE = new URL("./store.ts", import.meta.url).href;
const RESOLVE = fileURLToPath(new URL("../../scripts/test-resolve.mjs", import.meta.url));

/** Open the store in a fresh process against `url`, write one event, and report. */
function openStore(url: string): { status: { ready: boolean; error?: string }; stored: number } {
  const script = `
    globalThis.require = (await import("node:module")).createRequire(import.meta.url);
    const { storeStatus, insertEvents } = await import(${JSON.stringify(STORE)});
    const status = await storeStatus();
    const stored = await insertEvents("pg-case", [{ type: "page_view", ts: Date.now(), path: "/case" }]);
    console.log(JSON.stringify({ status, stored }));
    process.exit(0);
  `;
  const out = execFileSync(
    process.execPath,
    ["--experimental-strip-types", "--import", RESOLVE, "--input-type=module", "-e", script],
    { env: { ...process.env, POLISHD_DATABASE_URL: url }, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  return JSON.parse(out.trim().split("\n").pop() ?? "{}");
}

async function inspect(url: string, sql: string, params: unknown[] = []) {
  const { Client } = require("pg") as typeof import("pg");
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query(sql, params)).rows;
  } finally {
    await client.end();
  }
}

const columnsOf = (url: string, table: string) =>
  inspect(
    url,
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = $1 ORDER BY column_name`,
    [table],
  ).then((rows) => rows.map((r) => r.column_name as string));

const indexesOf = (url: string, table: string) =>
  inspect(url, `SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND tablename = $1 ORDER BY 1`, [
    table,
  ]).then((rows) => rows.map((r) => r.indexname as string));

const env = process.env;

test("an empty database gets polishd_events and polishd_meta", { skip: !env.POLISHD_TEST_PG_FRESH && "set POLISHD_TEST_PG_FRESH" }, async () => {
  const url = env.POLISHD_TEST_PG_FRESH!;
  const { status, stored } = openStore(url);
  assert.equal(status.ready, true);
  assert.equal(stored, 1);
  assert.ok((await columnsOf(url, "polishd_events")).includes("session_id"));
  assert.ok((await columnsOf(url, "polishd_meta")).includes("value"));
  assert.ok((await indexesOf(url, "polishd_events")).includes("idx_polishd_events_path"));
  assert.deepEqual(await columnsOf(url, "events"), [], "no table by the old name");
});

test("the app's own events table is left exactly as it was, and Polishd sits beside it", { skip: !env.POLISHD_TEST_PG_APP_EVENTS && "set POLISHD_TEST_PG_APP_EVENTS" }, async () => {
  const url = env.POLISHD_TEST_PG_APP_EVENTS!;
  const before = { columns: await columnsOf(url, "events"), indexes: await indexesOf(url, "events") };
  const { status, stored } = openStore(url);
  assert.equal(status.ready, true);
  assert.equal(stored, 1);
  assert.deepEqual({ columns: await columnsOf(url, "events"), indexes: await indexesOf(url, "events") }, before);
  const [{ n }] = await inspect(url, "SELECT COUNT(*)::int AS n FROM events");
  assert.equal(n, 1, "the app's row, and only it");
});

test("Polishd's pre-0.3.2 events table is renamed into place, data and indexes with it", { skip: !env.POLISHD_TEST_PG_LEGACY && "set POLISHD_TEST_PG_LEGACY" }, async () => {
  const url = env.POLISHD_TEST_PG_LEGACY!;
  const { status, stored } = openStore(url);
  assert.equal(status.ready, true);
  assert.equal(stored, 1);
  assert.deepEqual(await columnsOf(url, "events"), [], "the old name is gone");
  const sessions = (await inspect(url, "SELECT session_id FROM polishd_events ORDER BY id")).map((r) => r.session_id);
  assert.deepEqual(sessions, ["old-1", "old-2", "pg-case"]);
  const indexes = await indexesOf(url, "polishd_events");
  assert.ok(indexes.includes("idx_polishd_events_path") && indexes.includes("idx_polishd_events_build"));
  assert.ok(!indexes.some((i) => i.startsWith("idx_events_")), "no index left under the old name");
  assert.deepEqual(await indexesOf(url, "orders"), ["idx_events_orders", "orders_pkey"], "an app index that only looks like ours is untouched");

  // The next instance finds it already done.
  assert.equal(openStore(url).status.ready, true);
});

test("a polishd_events that isn't Polishd's is refused, and nothing is created", { skip: !env.POLISHD_TEST_PG_TAKEN && "set POLISHD_TEST_PG_TAKEN" }, async () => {
  const url = env.POLISHD_TEST_PG_TAKEN!;
  const before = await columnsOf(url, "polishd_events");
  const { status, stored } = openStore(url);
  assert.equal(status.ready, false);
  assert.match(status.error ?? "", /table named "polishd_events" that isn't Polishd's/);
  assert.equal(stored, 0);
  assert.deepEqual(await columnsOf(url, "polishd_events"), before);
  assert.deepEqual(await columnsOf(url, "polishd_meta"), []);
});
