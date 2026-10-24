/**
 * Tests for the analytics digest the AI layer reads.
 *
 * Run with `npm test`. Only the near-miss line is pinned here: a dead click
 * that landed beside a control must reach the model as "beside" that
 * control, not as the control's own label — which reads as "this button is
 * broken" when the button works.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { ElementStat, PolishdDashboardData } from "../server/queries.ts";
import { buildDigest } from "./digest.ts";

const element = (e: Partial<ElementStat>): ElementStat => ({
  label: "div.row",
  selector: "div.row",
  sampleText: null,
  pages: 1,
  clicks: 0,
  rageClicks: 0,
  deadClicks: 3,
  score: 6,
  lastInteraction: 0,
  ...e,
});

const data = (elements: ElementStat[]) =>
  ({
    overview: { ready: true, totalEvents: 10, sessions: 2, pageViews: 4, rageClicks: 0, deadClicks: 3, jsErrors: 0 },
    pages: [],
    elements,
    devices: [],
    topUsed: [],
    errors: [],
    monitored: [],
  }) as unknown as PolishdDashboardData;

test("a near miss reads as clicks beside the control, not as the control's label", () => {
  const digest = buildDigest(
    data([
      element({
        label: "div.border-t",
        sampleText: "beside “Show # more”",
        near: "Show # more",
        sampleIsNear: true,
      }),
      element({ label: "div.card", sampleText: "Weekly report" }),
    ]),
  );
  assert.match(digest, /- div\.border-t \(clicks land beside "Show # more"\): 0 rage, 3 dead/);
  assert.match(digest, /- Weekly report: 0 rage, 3 dead/, "an element's own text is unchanged");
  assert.doesNotMatch(digest, /- beside/);
});
