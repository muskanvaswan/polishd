/**
 * Tests for the Overview's fix prompt.
 *
 * Run with `npm test`. The prompt is pasted straight into a coding agent, so
 * what's pinned here is what that agent relies on: every finding arrives with
 * its evidence and source, each scope carries only its own half, and a scope
 * with nothing to fix produces no prompt rather than an empty one.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { PolishdDesignReview, PolishdSummary } from "../ai/types";
import { buildFixPrompt, fixableCounts, type FixPromptInput } from "./fix-prompt.ts";

const summary: PolishdSummary = {
  text: "Visitors find pricing quickly, but the plan toggle frustrates them.",
  wins: ["The hero CTA converts: most sessions reach /pricing."],
  losses: [
    {
      issue: "The annual/monthly toggle draws rage clicks.",
      evidence: "button.plan-toggle",
      location: "src/components/PlanToggle.tsx",
      verified: true,
      issueUrl: "https://github.com/acme/site/issues/12",
      issueNumber: 12,
    },
    {
      issue: "Feature cards look clickable but aren't.",
      evidence: "div.feature-card",
      verified: false,
    },
  ],
  provider: "anthropic",
  model: "claude-opus-5-5",
  generatedAt: Date.UTC(2026, 9, 20, 15, 30),
  fingerprint: "f1",
};

const review: PolishdDesignReview = {
  text: "A disciplined palette undercut by a loose type scale.",
  strengths: ["Two families, used consistently."],
  issues: [
    {
      issue: "Body text uses two near-identical sizes.",
      evidence: "15px and 16px",
      suggestion: "Collapse 15px into the 16px body size.",
    },
  ],
  provider: "anthropic",
  model: "claude-opus-5-5",
  generatedAt: Date.UTC(2026, 9, 21),
  fingerprint: "d1",
};

const input: FixPromptInput = {
  context: "A pricing site for a B2B scheduling tool.",
  audience: "Operations leads at mid-size companies.",
  traffic: {
    sessions: 1200,
    pageViews: 4800,
    rageClicks: 31,
    deadClicks: 88,
    jsErrors: 4,
    devices: [
      { category: "mobile", pct: 35 },
      { category: "desktop", pct: 62 },
      { category: "tablet", pct: 3 },
    ],
  },
  summary,
  review,
};

test("the full prompt carries both halves, every finding, and the site context", () => {
  const prompt = buildFixPrompt(input, "all")!;
  assert.match(prompt, /^# Fix the analytics and design problems Polishd found\n/);
  assert.match(prompt, /A pricing site for a B2B scheduling tool\./);
  assert.match(prompt, /Audience: Operations leads/);
  assert.match(prompt, /1,200 sessions · 4,800 page views \(4\.0 per session\)/);
  assert.match(prompt, /Devices: 62% desktop · 35% mobile · 3% tablet/);
  assert.match(prompt, /31 rage clicks · 88 dead clicks · 4 JS errors/);

  assert.match(prompt, /\*\*A1\.\*\* The annual\/monthly toggle draws rage clicks\./);
  assert.match(prompt, /Evidence: `button\.plan-toggle`/);
  assert.match(prompt, /Source: `src\/components\/PlanToggle\.tsx`/);
  assert.match(prompt, /Tracked in: https:\/\/github\.com\/acme\/site\/issues\/12 \(#12\)/);
  assert.match(prompt, /\*\*A2\.\*\* Feature cards look clickable/);
  assert.match(prompt, /Source: not matched to a file — search the codebase/);

  assert.match(prompt, /\*\*D1\.\*\* Body text uses two near-identical sizes\./);
  assert.match(prompt, /Suggested fix: Collapse 15px into the 16px body size\./);
  assert.match(prompt, /Reviewed 2026-10-20 by anthropic\/claude-opus-5-5/);
  assert.match(prompt, /don't regress these:\n- The hero CTA converts/);
  assert.match(prompt, /one line per problem \(A1, D1, …\)/);
  assert.ok(prompt.endsWith("\n") && !prompt.endsWith("\n\n"));
});

test("a single-half prompt leaves the other half out entirely", () => {
  const analytics = buildFixPrompt(input, "analytics")!;
  assert.match(analytics, /^# Fix the analytics problems Polishd found/);
  assert.match(analytics, /A1\./);
  assert.doesNotMatch(analytics, /D1\.|## Design|design problems, move/);

  const design = buildFixPrompt(input, "design")!;
  assert.match(design, /^# Fix the design problems Polishd found/);
  assert.match(design, /D1\./);
  assert.doesNotMatch(design, /A1\.|## Analytics|rage clicks ·/);
  // Audience size still frames a design prompt.
  assert.match(design, /1,200 sessions/);
});

test("nothing to fix means no prompt, and 'all' falls back to the half that has work", () => {
  const noLosses = { ...input, summary: { ...summary, losses: [] } };
  assert.equal(buildFixPrompt(noLosses, "analytics"), null);
  assert.match(buildFixPrompt(noLosses, "all")!, /^# Fix the design problems Polishd found/);

  const nothing: FixPromptInput = { ...input, summary: null, review: null };
  assert.deepEqual(fixableCounts(nothing), { analytics: 0, design: 0 });
  assert.equal(buildFixPrompt(nothing, "all"), null);
  assert.equal(buildFixPrompt(nothing, "design"), null);
});

test("optional context is omitted cleanly", () => {
  const bare: FixPromptInput = { summary, review: null, traffic: null };
  const prompt = buildFixPrompt(bare, "all")!;
  assert.doesNotMatch(prompt, /## The site|## Traffic/);
  assert.doesNotMatch(prompt, /\n\n\n/);
});

test("evidence containing backticks stays one code span", () => {
  const odd = {
    ...input,
    summary: {
      ...summary,
      losses: [{ issue: "Odd selector.", evidence: "a[title=`x`]", verified: false }],
    },
  };
  assert.match(buildFixPrompt(odd, "analytics")!, /Evidence: `` a\[title=`x`\] ``/);
});
