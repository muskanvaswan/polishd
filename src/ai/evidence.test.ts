/**
 * Tests for what the summary model reads (the digest), what a loss may cite
 * from it, and the volume a loss carries back out of the data (its signal).
 *
 * Run with `npm test`. The fixture is the shape of the report that prompted
 * these: a dashboard where a drawer backdrop collected dead clicks that
 * worked, and a wrapper bar beside a small "Show 9 more" button collected
 * dead clicks that missed it.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { foldFriction, type FrictionIndex, type FrictionRow } from "../server/friction.ts";
import type { PolishdDashboardData } from "../server/queries.ts";
import {
  buildDigest,
  citedInPrompt,
  citedTarget,
  digestParts,
  looksLikeOverlay,
  lossSignal,
} from "./digest.ts";

const BAR = "div.polishd-root>div.flex>div.flex";
const BACKDROP = "div.polishd-root>div.fixed>div.absolute";

const row = (p: Partial<FrictionRow> & Pick<FrictionRow, "type" | "session">): FrictionRow => ({
  path: "/~polishd",
  selector: null,
  component: null,
  text: null,
  meta: null,
  n: 1,
  ...p,
});

function friction(withMeta: boolean): FrictionIndex {
  return foldFriction([
    row({ type: "dead_click", session: "s1", selector: BAR, text: "Show 9 more", n: 6, meta: withMeta ? { near: "Show 9 more" } : null }),
    row({ type: "dead_click", session: "s2", selector: BAR, text: "Show 9 more", n: 4, meta: withMeta ? { near: "Show 9 more" } : null }),
    row({ type: "dead_click", session: "s3", selector: BAR, text: "Show 9 more", path: "/~polishd/design", n: 4 }),
    row({ type: "dead_click", session: "s1", selector: BACKDROP, n: 5 }),
    row({ type: "dead_click", session: "s4", selector: BACKDROP, n: 2 }),
    row({ type: "rage_click", session: "s2", selector: BAR, text: "Show 9 more", n: 3 }),
  ]);
}

function data(): PolishdDashboardData {
  return {
    overview: { ready: true, totalEvents: 500, sessions: 40, pageViews: 120, rageClicks: 3, deadClicks: 21 },
    health: {} as PolishdDashboardData["health"],
    pages: [
      { path: "/~polishd", sessions: 30, pageViews: 90, rageClicks: 3, deadClicks: 17, avgScrollDepth: null, trend: [] },
      { path: "/~polishd/design", sessions: 12, pageViews: 30, rageClicks: 0, deadClicks: 4, avgScrollDepth: null, trend: [] },
      { path: "/~polishd/settings", sessions: 9, pageViews: 11, rageClicks: 0, deadClicks: 0, avgScrollDepth: 30, trend: [] },
    ],
    trends: {} as PolishdDashboardData["trends"],
    elements: [
      { label: BAR, selector: BAR, sampleText: "Show 9 more", pages: 2, clicks: 0, rageClicks: 3, deadClicks: 14, score: 37, lastInteraction: 2 },
      { label: BACKDROP, selector: BACKDROP, sampleText: null, pages: 1, clicks: 0, rageClicks: 0, deadClicks: 7, score: 14, lastInteraction: 1 },
    ],
    devices: [],
    topUsed: [],
    journeys: [],
    monitored: [],
  };
}

const targets = (withMeta = true) => digestParts(data(), undefined, friction(withMeta)).targets;

// ── Digest ───────────────────────────────────────────────────────────────────

test("the digest shows what was actually clicked, the sessions, and near misses when captured", () => {
  const digest = buildDigest(data(), undefined, friction(true));
  assert.match(
    digest,
    /- Show 9 more <div\.flex>: 3 rage in 1 session, 14 dead in 3 sessions, 2 pages; 10 of the dead clicks landed next to "Show 9 more" — near misses/,
  );
});

test("a text-less positioned layer is flagged as a possible backdrop", () => {
  const digest = buildDigest(data(), undefined, friction(false));
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

test("without the new capture meta, the digest reads as it did — no empty clauses", () => {
  const digest = buildDigest(data(), undefined, friction(false));
  assert.doesNotMatch(digest, /near miss|handle/);
  assert.match(digest, /- Show 9 more <div\.flex>: 3 rage in 1 session, 14 dead in 3 sessions, 2 pages$/m);
});

test("without a friction index — a dashboard render's fingerprint — the base digest is unchanged", () => {
  const digest = buildDigest(data());
  assert.match(digest, /- Show 9 more <div\.flex>: 3 rage, 14 dead, 2 pages$/m);
  assert.doesNotMatch(digest, /COMPONENTS USERS STRUGGLE WITH/);
});

test("a capture handle is shown on its line and can be cited", () => {
  const f = foldFriction([
    row({ type: "dead_click", session: "a", selector: BAR, text: "Show 9 more", meta: { handle: 'section[data-component="features"]>div.toggle-bar' } }),
  ]);
  const parts = digestParts(data(), undefined, f);
  assert.match(parts.lines.join("\n"), /; handle section\[data-component="features"\]>div\.toggle-bar$/m);
  const t = citedTarget('section[data-component="features"]>div.toggle-bar', parts.targets);
  assert.equal(t?.handle, 'section[data-component="features"]>div.toggle-bar');
});

test("clicks inside a non-monitored data-component get their own section", () => {
  const f = foldFriction([
    row({ type: "dead_click", session: "a", selector: "div.x", component: "toolbar", n: 4, meta: { near: "Export" } }),
    row({ type: "dead_click", session: "b", selector: "div.x", component: "toolbar", n: 1 }),
  ]);
  const digest = buildDigest(data(), undefined, f);
  assert.match(
    digest,
    /COMPONENTS USERS STRUGGLE WITH[^\n]*\n {2}- toolbar: 0 rage, 5 dead in 2 sessions, on \/~polishd; 4 of the dead clicks landed next to "Export" — near misses/,
  );
});

// ── Item 1: a signal is the cited line's own numbers ─────────────────────────

test("an element cited by its label gets the dead-click volume behind it", () => {
  assert.deepEqual(
    lossSignal("Show 9 more", "14 dead clicks on the bar beside Show 9 more — near misses", targets()),
    { kind: "dead_click", count: 14, sessions: 3, pages: ["/~polishd", "/~polishd/design"] },
  );
  assert.equal(lossSignal("Show 9 more <div.flex>", "near misses", targets())?.count, 14);
  assert.deepEqual(lossSignal(`\`${BACKDROP}\``, "dead clicks on the backdrop", targets()), {
    kind: "dead_click",
    count: 7,
    sessions: 2,
    pages: ["/~polishd"],
  });
});

test("a label shared by an element and a component's sample text attaches the element's counts, not the busier group's", () => {
  // The component's sample text is never printed, so it can't be what was cited.
  const f = foldFriction([
    row({ type: "dead_click", session: "a", selector: "div.bar>button", text: "Export", n: 2 }),
    row({ type: "dead_click", session: "b", selector: "div.y", component: "Toolbar", text: "Export", n: 40 }),
  ]);
  const d = data();
  d.elements = [
    { label: "div.bar>button", selector: "div.bar>button", sampleText: "Export", pages: 1, clicks: 0, rageClicks: 0, deadClicks: 2, score: 4, lastInteraction: 1 },
  ];
  const { targets: ts } = digestParts(d, undefined, f);
  assert.deepEqual(lossSignal("Export", "dead clicks on Export", ts), {
    kind: "dead_click",
    count: 2,
    sessions: 1,
    pages: ["/~polishd"],
  });
});

test("a citation that names two digest lines equally attaches nothing", () => {
  const f = foldFriction([
    row({ type: "dead_click", session: "a", selector: "div.a>button", text: "Export", n: 2 }),
    row({ type: "dead_click", session: "b", selector: "div.b>span", text: "Export", n: 40 }),
  ]);
  const d = data();
  d.elements = [
    { label: "div.a>button", selector: "div.a>button", sampleText: "Export", pages: 1, clicks: 0, rageClicks: 0, deadClicks: 2, score: 4, lastInteraction: 2 },
    { label: "div.b>span", selector: "div.b>span", sampleText: "Export", pages: 1, clicks: 0, rageClicks: 0, deadClicks: 40, score: 80, lastInteraction: 1 },
  ];
  const { targets: ts } = digestParts(d, undefined, f);
  assert.equal(lossSignal("Export", "dead clicks on Export", ts), undefined);
  assert.equal(lossSignal("Export <span>", "dead clicks", ts)?.count, 40, "the printed form tells them apart");
});

test("a citation that merely contains a printed name gets none of that line's numbers", () => {
  const d = data();
  d.elements.push({ label: "div.bar>button", selector: "div.bar>button", sampleText: "Export", pages: 1, clicks: 0, rageClicks: 0, deadClicks: 2, score: 4, lastInteraction: 0 });
  d.topUsed = [{ label: "Export CSV", isComponent: false, selector: "a.csv", sampleText: "Export CSV", clicks: 30, sessions: 9, pages: 1 }];
  d.pages.push({ path: "/docs", sessions: 50, pageViews: 70, rageClicks: 0, deadClicks: 0, avgScrollDepth: null, trend: [] });
  const f = foldFriction([row({ type: "dead_click", session: "a", selector: "div.bar>button", text: "Export", n: 2 })]);
  const { targets: ts } = digestParts(d, undefined, f);
  assert.equal(lossSignal("Export CSV", "people don't find the CSV export", ts), undefined);
  assert.equal(lossSignal("/docs/getting-started", "few people finish the guide", ts), undefined);
  assert.equal(lossSignal("Export", "dead clicks on Export", ts)?.count, 2, "the exact name still attaches");
});

// ── Item 2: the kind follows what the loss is about ──────────────────────────

test("an engagement loss on a page gets its views, never its friction", () => {
  const d = data();
  d.pages.push({ path: "/pricing", sessions: 400, pageViews: 500, rageClicks: 0, deadClicks: 1, avgScrollDepth: 20, trend: [] });
  const f = foldFriction([row({ type: "dead_click", session: "a", path: "/pricing", selector: "div.x" })]);
  const { targets: ts } = digestParts(d, undefined, f);
  assert.deepEqual(lossSignal("/pricing", "80% of visitors bounce from pricing", ts), {
    kind: "page_view",
    count: 500,
    sessions: 400,
    pages: ["/pricing"],
  });
  assert.equal(lossSignal("/pricing", "a dead click on the plan toggle", ts)?.kind, "dead_click");
});

test("the issue's wording picks the kind among the line's counts — and never supplies one", () => {
  assert.equal(lossSignal("Show 9 more", "Users rage-click Show 9 more", targets())?.kind, "rage_click");
  assert.equal(lossSignal("/~polishd", "dead clicks on load", targets())?.kind, "dead_click");
  // Names a kind the line doesn't have.
  assert.equal(lossSignal("/~polishd/design", "rage clicks on the design tab", targets()), undefined);
  // Names two kinds: unclear.
  assert.equal(lossSignal("Show 9 more", "rage and dead clicks", targets()), undefined);
  // A path's own words aren't wording: `/dead-ends` is a page.
  const d = data();
  d.pages.push({ path: "/dead-ends", sessions: 5, pageViews: 6, rageClicks: 0, deadClicks: 0, avgScrollDepth: null, trend: [] });
  assert.equal(lossSignal("/dead-ends", "few people reach it", digestParts(d, undefined, friction(true)).targets)?.kind, "page_view");
});

test("an element with both kinds and no wording for either carries no signal", () => {
  assert.equal(lossSignal("Show 9 more", "users struggle with it", targets()), undefined);
  assert.equal(lossSignal(BACKDROP, "users struggle with it", targets())?.kind, "dead_click");
});

test("evidence the digest doesn't show carries no signal", () => {
  assert.equal(lossSignal("the onboarding flow", "people drop off", targets()), undefined);
  assert.equal(lossSignal("", "x", targets()), undefined);
});

// ── Item 7: short labels can be cited ────────────────────────────────────────

test("a label too short for a token is grounded only as an exact copy of a printed label", () => {
  const d = data();
  d.elements.push(
    { label: "div.auth", selector: "div.auth", sampleText: "Log in", pages: 1, clicks: 0, rageClicks: 0, deadClicks: 3, score: 6, lastInteraction: 0 },
    { label: "div.cta", selector: "div.cta", sampleText: "OK", pages: 1, clicks: 0, rageClicks: 0, deadClicks: 2, score: 4, lastInteraction: 0 },
  );
  const { lines, targets: ts } = digestParts(d, undefined, friction(true));
  const prompt = lines.join("\n");
  assert.equal(citedInPrompt("Log in", prompt, ts), true);
  assert.equal(citedInPrompt('"OK"', prompt, ts), true);
  assert.equal(citedInPrompt("Pay", prompt, ts), false, "never printed");
  assert.equal(citedInPrompt("Log", prompt, ts), false, "a fragment of a label isn't the label");
  // Longer citations still ground on a token, as before.
  assert.equal(citedInPrompt("div.polishd-root>div.fixed>div.absolute", prompt, ts), true);
  assert.equal(citedInPrompt("/~polishd/settings", prompt, ts), true);
});
