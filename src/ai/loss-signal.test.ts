/**
 * Tests for looking a loss's citation up in the analytics.
 *
 * Run with `npm test`. What's pinned is what the fix prompt passes on: the
 * counts behind a citation, and that a citation naming two things (an element
 * on a page) resolves to the more specific one.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { PolishdDashboardData } from "../server/queries";
import { lossSignal } from "./loss-signal.ts";

type SignalData = Pick<PolishdDashboardData, "elements" | "topUsed" | "monitored" | "pages" | "errors">;

const data: SignalData = {
  elements: [
    {
      label: "div.feature-card>span",
      selector: "div.feature-card>span",
      sampleText: "Compare plans side by side and pick the one that fits your team",
      pages: 2,
      clicks: 3,
      rageClicks: 0,
      deadClicks: 14,
      frictionSessions: 9,
      score: 28,
      lastInteraction: 1,
    },
  ],
  topUsed: [
    {
      label: "plan-toggle",
      isComponent: true,
      selector: "button.plan-toggle",
      sampleText: "Annual",
      clicks: 210,
      sessions: 140,
      pages: 1,
    },
  ],
  monitored: [],
  pages: [
    {
      path: "/pricing",
      sessions: 600,
      pageViews: 900,
      rageClicks: 4,
      deadClicks: 20,
      jsErrors: 1,
      avgScrollDepth: 62.4,
      trend: [],
    },
  ],
  errors: [
    {
      path: "/checkout",
      message: "TypeError: Cannot read properties of undefined (reading 'price')",
      ts: 1,
      count: 37,
      paths: ["/checkout", "/pricing"],
    },
  ],
};

test("a selector citation carries the element's friction counts and text", () => {
  const s = lossSignal("div.feature-card>span", data)!;
  assert.equal(s.kind, "element");
  assert.equal(s.deadClicks, 14);
  assert.equal(s.sessions, 9);
  assert.equal(s.text, "Compare plans side by side and pick the one that fits your team");
});

test("the digest's clipped label still matches", () => {
  // digest.ts prints the first 40 characters of an element's text.
  const s = lossSignal("Compare plans side by side and pick the ", data)!;
  assert.equal(s.kind, "element");
  assert.equal(s.deadClicks, 14);
});

test("a citation naming an element on a page resolves to the element", () => {
  const s = lossSignal("button.plan-toggle on /pricing", data)!;
  assert.equal(s.kind, "component");
  assert.equal(s.component, "plan-toggle");
  assert.equal(s.sessions, 140);
});

test("pages and errors carry their own volumes", () => {
  const page = lossSignal("/pricing", data)!;
  assert.deepEqual(
    { kind: page.kind, sessions: page.sessions, deadClicks: page.deadClicks, scrollDepth: page.scrollDepth },
    { kind: "page", sessions: 600, deadClicks: 20, scrollDepth: 62 },
  );
  const error = lossSignal("TypeError: Cannot read properties of undefined", data)!;
  assert.equal(error.kind, "error");
  assert.equal(error.occurrences, 37);
  assert.deepEqual(error.paths, ["/checkout", "/pricing"]);
});

test("a citation naming nothing in the data has no signal", () => {
  assert.equal(lossSignal("the whole site", data), undefined);
  assert.equal(lossSignal("", data), undefined);
});
