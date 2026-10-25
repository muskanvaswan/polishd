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
const { getBuilds, getCurrentBuild, getElementStats, getOverview, getRecentErrors, getSessionJourneys } =
  await import("./queries.ts");
const { ingest } = await import("./ingest.ts");
const { getDesignData } = await import("./design.ts");

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
  assert.equal(element?.sampleIsNear, true, "flagged, so it isn't rendered or read as the element's text");

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
  assert.equal(stats.find((e) => e.selector === "div.card")?.sampleIsNear, undefined);
  assert.equal(stats.find((e) => e.selector === "div.plain")?.sampleText, null);
});

// ── Builds ───────────────────────────────────────────────────────────────────

const OLD_BUILD = "1111111111111111111111111111111111111111";
const NEW_BUILD = "2222222222222222222222222222222222222222";

/** A design_scan event with the minimum payload the aggregate accepts. */
const designScan = (path: string, ts: number): PolishdEvent =>
  event({
    type: "design_scan",
    ts,
    path,
    meta: {
      el: 12,
      payload: JSON.stringify({
        v: 1,
        el: 12,
        fonts: [["Inter", 16, 400, 10, "Body", "p"]],
        text: [["#111111", 10]],
        bg: [["#ffffff", 4]],
        border: [],
        pairs: [["#111111", "#ffffff", 10, 16, 0]],
        radii: [["8px", 3]],
        pad: [[8, 6]],
      }),
    },
  });

test("every event is stamped with its batch's build, and a build is new when first seen", async () => {
  await insertEvents("build-a", [event({ type: "page_view", path: "/b" })], { build: OLD_BUILD });
  await new Promise((r) => setTimeout(r, 5));
  await insertEvents(
    "build-b",
    [event({ type: "page_view", path: "/b" }), event({ type: "rage_click", path: "/b", selector: "button.x" })],
    { build: NEW_BUILD },
  );
  await new Promise((r) => setTimeout(r, 5));
  // The old build reporting again (a tab left open across the deploy) must
  // not make it current again.
  await insertEvents("build-a", [event({ type: "page_view", path: "/b" })], { build: OLD_BUILD });

  const builds = await getBuilds();
  assert.deepEqual(
    builds.map((b) => b.build),
    [NEW_BUILD, OLD_BUILD],
    "ordered by first appearance, newest first",
  );
  assert.equal((await getCurrentBuild())?.build, NEW_BUILD);
  const newest = builds[0];
  assert.equal(newest.sessions, 1);
  assert.equal(newest.pageViews, 1);
  assert.equal(newest.rageClicks, 1);
  assert.equal(builds[1].events, 2);
  assert.ok(builds[1].lastSeen >= newest.firstSeen, "the old build's last event came after the new build appeared");
});

test("the overview scopes to a build or a window", async () => {
  const all = await getOverview();
  const onNew = await getOverview({ build: NEW_BUILD });
  assert.equal(onNew.rageClicks, 1);
  assert.equal(onNew.sessions, 1);
  assert.ok(all.totalEvents > onNew.totalEvents);
  assert.equal((await getOverview({ since: 0 })).totalEvents, all.totalEvents);
  assert.equal((await getOverview({ since: Date.now() + 60_000 })).totalEvents, 0);
});

test("ingest takes the client's build when it's clean, and the server's otherwise", async () => {
  process.env.POLISHD_BUILD = "server-build";
  try {
    const ok = await ingest(
      { events: [{ type: "click", ts: 1, path: "/ingest", selector: "a.b" }], build: "client-build" },
      "session-ingest-1",
    );
    assert.equal(ok.stored, 1);
    const fallback = await ingest(
      { events: [{ type: "click", ts: 2, path: "/ingest", selector: "a.b" }], build: "not a build" },
      "session-ingest-2",
    );
    assert.equal(fallback.stored, 1);
  } finally {
    delete process.env.POLISHD_BUILD;
  }
  const builds = new Map((await getBuilds()).map((b) => [b.build, b]));
  assert.equal(builds.get("client-build")?.events, 1);
  assert.equal(builds.get("server-build")?.events, 1);
});

test("the Design tab merges the newest build's scans once they cover every page it serves", async () => {
  // Each page's newest scan is what counts, picked in SQL — not the newest
  // few hundred scans overall.
  await insertEvents("design-old", [designScan("/d/home", 100), designScan("/d/about", 100), designScan("/d/gone", 100)], {
    build: "d-old-build",
  });
  await new Promise((r) => setTimeout(r, 5));
  // The new build appears: /d/gone was removed, /d/home and /d/about viewed.
  await insertEvents(
    "design-new",
    [event({ type: "page_view", path: "/d/home", ts: 200 }), event({ type: "page_view", path: "/d/about", ts: 200 })],
    { build: "d-new-build" },
  );

  let data = await getDesignData();
  assert.equal(data.build?.build, "d-new-build");
  assert.equal(data.build?.complete, false);
  assert.deepEqual(data.build?.pending, ["/d/about", "/d/home"]);
  assert.ok(data.pages.some((p) => p.path === "/d/gone"), "the old build's scans still fill in");

  // One page rescanned on the new build: still mixed.
  await insertEvents("design-new", [designScan("/d/home", 300)], { build: "d-new-build" });
  data = await getDesignData();
  assert.equal(data.build?.scanned, 1);
  assert.deepEqual(data.build?.pending, ["/d/about"]);
  assert.equal(data.pages.find((p) => p.path === "/d/home")?.build, "d-new-build");
  assert.equal(data.pages.find((p) => p.path === "/d/about")?.build, "d-old-build");

  // Every served page scanned on it: only its scans, and the removed page is gone.
  await insertEvents("design-new", [designScan("/d/about", 300)], { build: "d-new-build" });
  data = await getDesignData();
  assert.equal(data.build?.complete, true);
  assert.deepEqual(
    data.pages.filter((p) => p.path.startsWith("/d/")).map((p) => p.path).sort(),
    ["/d/about", "/d/home"],
  );
});
