/**
 * Tests for the dashboard queries, against a real SQLite store.
 *
 * Run with `npm test` (the test resolve hook lets this load the store and
 * queries as they ship). Each run writes a throwaway database file; a
 * configured Postgres is never touched. The Postgres path runs the same SQL —
 * `meta ->> 'key'` is spelled the same on `jsonb` — but isn't exercised here.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { PolishdEvent } from "../shared/types.ts";

for (const key of [
  "POLISHD_DATABASE_URL",
  "BUFFD_DATABASE_URL",
  "POLISH_DATABASE_URL",
  "POLISHD_ANALYTICS_SOURCE",
  "POLISHD_DASHBOARD_ROUTE",
]) {
  delete process.env[key];
}
process.env.POLISHD_DB_PATH = join(mkdtempSync(join(tmpdir(), "polishd-queries-")), "test.db");

const { insertEvents } = await import("./store.ts");
const { getElementStats, getRecentErrors, getSessionJourneys } = await import("./queries.ts");

const event = (e: Partial<PolishdEvent> & Pick<PolishdEvent, "type">): PolishdEvent => ({
  ts: 1_000,
  path: "/",
  ...e,
});

test("a frequent error with per-occurrence context doesn't push the others out", async () => {
  // An older, rarer error first…
  await insertEvents("errors-a", [
    event({ type: "js_error", path: "/settings", meta: { message: "Rare failure", source: "https://x/r.js", line: 9 } }),
  ]);
  // …then 250 throws of one error, each after a different click and delay —
  // under the old grouping by whole `meta`, each was its own group and the
  // window (limit × 20) held nothing else.
  const frequent = Array.from({ length: 250 }, (_, i) =>
    event({
      type: "js_error",
      ts: 2_000 + i,
      path: "/design",
      meta: {
        message: "An error occurred in the Server Components render.",
        source: "https://x/b.js",
        line: 1,
        frame: "/_next/static/chunks/b.js:1:777",
        digest: `digest-${i % 3}`,
        after: i % 2 ? "Save # items" : "Load",
        afterMs: (i % 20) * 100,
        afterSelector: i % 2 ? "button.save" : "button.load",
      },
    }),
  );
  await insertEvents("errors-b", frequent);

  const errors = await getRecentErrors(10);
  const byMessage = new Map(errors.map((e) => [e.message, e]));
  assert.ok(byMessage.has("Rare failure"), "the rare error is still listed");
  const frequentError = byMessage.get("An error occurred in the Server Components render.");
  assert.equal(frequentError?.count, 250);

  // Context comes from the newest occurrence (i = 249).
  assert.equal(frequentError?.digest, "digest-0");
  assert.equal(frequentError?.frame, "/_next/static/chunks/b.js:1:777");
  assert.equal(frequentError?.after, "Save # items");
  assert.equal(frequentError?.afterMs, 900);
  assert.equal(frequentError?.afterSelector, "button.save");
  assert.equal(byMessage.get("Rare failure")?.after, undefined, "older rows have no context, and that's fine");
});

test("journeys order by when things happened, not when they arrived", async () => {
  // A dead click on /a is held for a second, so it's queued after the link
  // click and the /b page view that followed it.
  await insertEvents("journey-1", [
    event({ type: "page_view", ts: 10_000, path: "/a" }),
    event({ type: "click", ts: 10_600, path: "/a", selector: "a.next", text: "Next" }),
    event({ type: "page_view", ts: 10_650, path: "/b" }),
    event({ type: "dead_click", ts: 10_200, path: "/a", selector: "div.hero", text: "Hero" }),
  ]);
  const journey = (await getSessionJourneys(20)).find((j) => j.steps.some((s) => s.label === "Hero"));
  assert.deepEqual(
    journey?.steps.map((s) => `${s.type} ${s.path}`),
    ["page_view /a", "dead_click /a", "click /a", "page_view /b"],
  );
});

test("a near miss with no label of its own reads as “beside” the control", async () => {
  await insertEvents("near-1", [
    event({ type: "page_view", ts: 20_000, path: "/design" }),
    event({
      type: "dead_click",
      ts: 20_100,
      path: "/design",
      selector: "div.border-t",
      meta: { near: "Show # more type styles ↓", handle: "div.show-more-row" },
    }),
  ]);
  const element = (await getElementStats(50)).find((e) => e.selector === "div.border-t");
  assert.equal(element?.sampleText, "beside “Show # more type styles ↓”");
  assert.equal(element?.near, "Show # more type styles ↓");

  const steps = (await getSessionJourneys(20)).flatMap((j) => j.steps);
  assert.ok(steps.some((s) => s.type === "dead_click" && s.label === "beside “Show # more type styles ↓”"));
});

test("an element's own text still wins over its near miss", async () => {
  await insertEvents("near-2", [
    event({ type: "dead_click", ts: 30_000, selector: "div.card", text: "Weekly report", meta: { near: "Read more" } }),
    event({ type: "dead_click", ts: 30_100, selector: "div.plain" }),
  ]);
  const stats = await getElementStats(50);
  assert.equal(stats.find((e) => e.selector === "div.card")?.sampleText, "Weekly report");
  assert.equal(stats.find((e) => e.selector === "div.plain")?.sampleText, null);
});
