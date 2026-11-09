/**
 * A local SQLite file from before 0.3.2: its `events` table is renamed to
 * `polishd_events` on open, rows and all, and the old index names go. Its own
 * file: the store latches its first result.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

for (const key of ["POLISHD_DATABASE_URL", "BUFFD_DATABASE_URL", "POLISH_DATABASE_URL"]) delete process.env[key];
const path = join(mkdtempSync(join(tmpdir(), "polishd-legacy-")), "analytics.db");
process.env.POLISHD_DB_PATH = path;

// The 0.3.1 schema, with a visit already in it.
const old = new DatabaseSync(path);
old.exec(`
  CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, type TEXT NOT NULL, ts INTEGER NOT NULL,
    path TEXT NOT NULL, selector TEXT, component TEXT, text TEXT, value REAL, meta TEXT,
    received_at INTEGER NOT NULL, install_id TEXT, build TEXT
  );
  CREATE INDEX idx_events_path ON events(path);
  CREATE INDEX idx_events_build ON events(build);
  CREATE TABLE polishd_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
  INSERT INTO events (session_id, type, ts, path, received_at) VALUES ('before', 'page_view', 1, '/old', 1);
`);
old.close();

const { insertEvents, query, storeStatus } = await import("./store.ts");

test("the old events table becomes polishd_events, with its rows", async () => {
  assert.deepEqual(await storeStatus(), { ready: true, backend: "sqlite" });
  assert.equal(await insertEvents("after", [{ type: "page_view", ts: Date.now(), path: "/new" }]), 1);
  const sessions = (await query(`SELECT session_id FROM polishd_events ORDER BY id`)).map((r) => r.session_id);
  assert.deepEqual(sessions, ["before", "after"]);

  const tables = (await query(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)).map((r) => r.name);
  assert.ok(!tables.includes("events"));
  const indexes = (await query(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'polishd_events'`)).map(
    (r) => r.name as string,
  );
  assert.ok(indexes.includes("idx_polishd_events_path") && indexes.includes("idx_polishd_events_build"));
  assert.ok(!indexes.some((i) => i.startsWith("idx_events_")));
});
