/**
 * Tests for what the summary model reads (the digest) and what a loss carries
 * back out of the data (its signal).
 *
 * Run with `npm test`. The fixture is the shape of the report that prompted
 * these: a dashboard where a drawer backdrop collected dead clicks that
 * worked, and a wrapper bar beside a small "Show 9 more" button collected
 * dead clicks that missed it.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { foldFriction, type FrictionRow } from "../server/friction.ts";
import type { PolishdDashboardData } from "../server/queries.ts";
import { buildDigest, looksLikeOverlay } from "./digest.ts";
import { lossSignal } from "./signal.ts";

const BAR = "div.polishd-root>div.flex>div.flex";
const BACKDROP = "div.polishd-root>div.fixed>div.absolute";

function rows(withMeta: boolean): FrictionRow[] {
  const r = (p: Partial<FrictionRow> & Pick<FrictionRow, "type" | "session">): FrictionRow => ({
    path: "/~polishd",
    selector: null,
    component: null,
    text: null,
    meta: null,
    n: 1,
    ...p,
  });
  return [
    r({ type: "dead_click", session: "s1", selector: BAR, text: "Show 9 more", n: 6, meta: withMeta ? { near: "Show 9 more" } : null }),
    r({ type: "dead_click", session: "s2", selector: BAR, text: "Show 9 more", n: 4, meta: withMeta ? { near: "Show 9 more" } : null }),
    r({ type: "dead_click", session: "s3", selector: BAR, text: "Show 9 more", path: "/~polishd/design", n: 4 }),
    r({ type: "dead_click", session: "s1", selector: BACKDROP, n: 5 }),
    r({ type: "dead_click", session: "s4", selector: BACKDROP, n: 2 }),
    r({ type: "rage_click", session: "s2", selector: BAR, text: "Show 9 more", n: 3 }),
    r({
      type: "js_error",
      session: "s5",
      meta: withMeta
        ? { message: "Cannot read properties of undefined (reading 'map')", digest: "2938471", frame: "at Journeys (src/dashboard/journeys.tsx:88:12)", after: "journey-row", afterMs: 140 }
        : { message: "Cannot read properties of undefined (reading 'map')" },
      n: 2,
    }),
  ];
}

function data(withMeta: boolean): PolishdDashboardData {
  return {
    overview: { ready: true, totalEvents: 500, sessions: 40, pageViews: 120, rageClicks: 3, deadClicks: 21, jsErrors: 2 },
    health: {} as PolishdDashboardData["health"],
    pages: [
      { path: "/~polishd", sessions: 30, pageViews: 90, rageClicks: 3, deadClicks: 17, jsErrors: 2, avgScrollDepth: null, trend: [] },
      { path: "/~polishd/design", sessions: 12, pageViews: 30, rageClicks: 0, deadClicks: 4, jsErrors: 0, avgScrollDepth: null, trend: [] },
      { path: "/~polishd/settings", sessions: 9, pageViews: 11, rageClicks: 0, deadClicks: 0, jsErrors: 0, avgScrollDepth: 30, trend: [] },
    ],
    trends: {} as PolishdDashboardData["trends"],
    elements: [
      { label: BAR, selector: BAR, sampleText: "Show 9 more", pages: 2, clicks: 0, rageClicks: 3, deadClicks: 14, score: 37, lastInteraction: 2 },
      { label: BACKDROP, selector: BACKDROP, sampleText: null, pages: 1, clicks: 0, rageClicks: 0, deadClicks: 7, score: 14, lastInteraction: 1 },
    ],
    devices: [],
    topUsed: [],
    journeys: [],
    errors: [
      { path: "/~polishd", message: "Cannot read properties of undefined (reading 'map')", ts: 1, count: 2, paths: ["/~polishd"] },
    ],
    monitored: [],
    friction: foldFriction(rows(withMeta)),
  };
}

// ── Digest ───────────────────────────────────────────────────────────────────

test("the digest shows what was actually clicked, the sessions, and near misses when captured", () => {
  const digest = buildDigest(data(true));
  assert.match(
    digest,
    /- Show 9 more <div\.flex>: 3 rage in 1 session, 14 dead in 3 sessions, 2 pages; 10 of the dead clicks landed next to "Show 9 more" — near misses/,
  );
});

test("a text-less positioned layer is flagged as a possible backdrop", () => {
  const digest = buildDigest(data(false));
  assert.match(
    digest,
    /- div\.polishd-root>div\.fixed>div\.absolute: 0 rage, 7 dead in 2 sessions, 1 pages; no text, positioned layer — could be an overlay or backdrop/,
  );
  assert.equal(looksLikeOverlay("div.flex>div.absolute", null), true);
  assert.equal(looksLikeOverlay("div.flex>div.absolute", "Close"), false);
  assert.equal(looksLikeOverlay("div.flex>button.absolute", null), false);
  assert.equal(looksLikeOverlay("main>div.drawer-backdrop", null), true);
  assert.equal(looksLikeOverlay("div.flex>div.flex", null), false);
});

test("errors carry digest, frame and the preceding interaction when captured", () => {
  const line = buildDigest(data(true))
    .split("\n")
    .find((l) => l.includes("Cannot read properties"))!;
  assert.equal(
    line,
    `  - "Cannot read properties of undefined (reading 'map')" on /~polishd — 2× in 1 session; after "journey-row" (~140ms before); at Journeys (src/dashboard/journeys.tsx:88:12); digest 2938471`,
  );
});

test("without the new capture meta, the digest reads as it did — no empty clauses", () => {
  const digest = buildDigest(data(false));
  assert.doesNotMatch(digest, /near miss|after "|digest |; at /);
  assert.match(digest, /- "Cannot read properties of undefined \(reading 'map'\)" on \/~polishd — 2× in 1 session$/m);
  assert.match(digest, /- Show 9 more <div\.flex>: 3 rage in 1 session, 14 dead in 3 sessions, 2 pages$/m);
});

test("data without a friction index at all (an older caller) still digests", () => {
  const d = { ...data(false), friction: undefined } as unknown as PolishdDashboardData;
  const digest = buildDigest(d);
  assert.match(digest, /- Show 9 more <div\.flex>: 3 rage, 14 dead, 2 pages$/m);
  assert.match(digest, /- "Cannot read properties of undefined \(reading 'map'\)" on \/~polishd$/m);
});

// ── Signal ───────────────────────────────────────────────────────────────────

test("an element cited by its label gets the dead-click volume behind it", () => {
  assert.deepEqual(
    lossSignal("Show 9 more", "14 dead clicks on the bar beside Show 9 more — near misses", data(true)),
    { kind: "dead_click", count: 14, sessions: 3, pages: ["/~polishd", "/~polishd/design"] },
  );
});

test("the issue text can choose the kind, but only among real counts", () => {
  assert.deepEqual(lossSignal("Show 9 more", "Users rage-click Show 9 more", data(true)), {
    kind: "rage_click",
    count: 3,
    sessions: 1,
    pages: ["/~polishd"],
  });
  // Mentions both: the larger count wins.
  assert.equal(lossSignal("Show 9 more", "rage and dead clicks", data(true))?.kind, "dead_click");
});

test("a selector citation, quoted or with the clicked part appended, finds the same target", () => {
  const d = data(true);
  const bySelector = lossSignal(`\`${BACKDROP}\``, "dead clicks on the backdrop", d);
  assert.deepEqual(bySelector, { kind: "dead_click", count: 7, sessions: 2, pages: ["/~polishd"] });
  assert.equal(lossSignal("Show 9 more <div.flex>", "near misses", d)?.count, 14);
});

test("an error message, clipped or whole, gets the error's volume", () => {
  const d = data(true);
  const s = { kind: "js_error", count: 2, sessions: 1, pages: ["/~polishd"] };
  assert.deepEqual(lossSignal("Cannot read properties of undefined (reading 'map')", "crash", d), s);
  assert.deepEqual(lossSignal('"Cannot read properties of undefined"', "crash", d), s);
});

test("a page with friction reports it; a page without reports its views", () => {
  const d = data(true);
  assert.deepEqual(lossSignal("/~polishd", "dead clicks pile up on the analytics tab", d), {
    kind: "dead_click",
    count: 17,
    sessions: 3,
    pages: ["/~polishd"],
  });
  assert.deepEqual(lossSignal("/~polishd", "an error on load", d)?.kind, "js_error");
  assert.deepEqual(lossSignal("/~polishd/settings", "shallow scroll", d), {
    kind: "page_view",
    count: 11,
    sessions: 9,
    pages: ["/~polishd/settings"],
  });
});

test("evidence the aggregates don't count carries no signal", () => {
  assert.equal(lossSignal("the onboarding flow", "people drop off", data(true)), undefined);
  assert.equal(lossSignal("", "x", data(true)), undefined);
});
