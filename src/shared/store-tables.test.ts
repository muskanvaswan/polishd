/** Which tables are Polishd's, what the store plans before opening, and the screen for a taken name. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { describeStoreFailure } from "./store-failure.ts";
import { foreignTableError, planTables, tableOwner } from "./store-tables.ts";

const OURS = ["id", "session_id", "type", "ts", "path", "selector", "received_at"];
const META = ["key", "value", "updated_at"];
const APPS = ["id", "title", "starts_at"];

test("a table is Polishd's by its columns, not its name", () => {
  assert.equal(tableOwner("polishd_events", []), "absent");
  assert.equal(tableOwner("polishd_events", OURS), "polishd");
  assert.equal(tableOwner("polishd_events", OURS.filter((c) => c !== "selector")), "polishd", "an older Polishd table is still ours");
  assert.equal(tableOwner("polishd_events", ["id", "type", "path", "ts"]), "foreign", "a lookalike without session_id isn't ours");
  assert.equal(tableOwner("events", OURS), "polishd", "Polishd's pre-0.3.2 table");
  assert.equal(tableOwner("events", APPS), "foreign", "the app's own");
  assert.equal(tableOwner("polishd_meta", META), "polishd");
});

test("the store's plan for each database it can meet", () => {
  const plan = (tables: Record<string, string[]>) => planTables((t) => tables[t] ?? []);
  assert.deepEqual(plan({}), { refuse: null, renameLegacy: false }, "empty");
  assert.deepEqual(plan({ events: APPS }), { refuse: null, renameLegacy: false }, "the app's events: left alone");
  assert.deepEqual(plan({ events: OURS, polishd_meta: META }), { refuse: null, renameLegacy: true }, "before 0.3.2: rename");
  assert.deepEqual(
    plan({ polishd_events: OURS, polishd_meta: META, events: OURS }),
    { refuse: null, renameLegacy: false },
    "already renamed: an old table back from a rollback stays where it is",
  );
  const taken = plan({ polishd_events: ["id", "name"] });
  assert.match(taken.refuse ?? "", /table named "polishd_events" that isn't Polishd's/);
});

test("a taken name reads as such on the setup screen, naming the table", () => {
  const error = foreignTableError("polishd_events", ["id", "name"]);
  const failure = describeStoreFailure({ tried: "postgres", host: "db.example.com:5432", error });
  assert.equal(failure.kind, "taken");
  assert.equal(failure.host, "db.example.com:5432");
  assert.match(failure.hint ?? "", /^This database already has a table named "polishd_events" that isn't Polishd's \(it has no session_id, type, ts, path, received_at columns\)\.$/);
});
