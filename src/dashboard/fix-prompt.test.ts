/**
 * Tests for the Overview's fix prompt.
 *
 * Run with `npm test`. The prompt is pasted straight into a coding agent, so
 * what's pinned here is what that agent relies on: every finding arrives with
 * its evidence and source, each scope carries only its own half, and a scope
 * with nothing to fix produces no prompt rather than an empty one. And what it
 * needs to judge a finding rather than just carry it out: the volume behind
 * it, how it was detected and what that can't see, handles to search for, a
 * warning when the reviews are out of date, and a verdict block to answer in.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { PolishdDesignReview, PolishdSummary } from "../ai/types";
import {
  buildFixPrompt,
  fixableCounts,
  fixPromptFindings,
  type FixPromptInput,
} from "./fix-prompt.ts";

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
  now: Date.UTC(2026, 9, 22),
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
  assert.match(prompt, /one entry for each of A1, A2, D1:/);
  assert.ok(prompt.endsWith("\n") && !prompt.endsWith("\n\n"));
  // Reviews a day apart and two days old: nothing to warn about.
  assert.doesNotMatch(prompt, /## How current this is/);
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

test("reviews far apart in time, or old, or behind their data, say so up front", () => {
  // The real report: a design review from August next to October's analytics.
  const apart: FixPromptInput = {
    ...input,
    summary: { ...summary, generatedAt: Date.UTC(2026, 9, 24) },
    review: { ...review, generatedAt: Date.UTC(2026, 7, 15) },
    now: Date.UTC(2026, 9, 24),
  };
  const prompt = buildFixPrompt(apart, "all")!;
  assert.match(
    prompt,
    /## How current this is\n\n- The design review is from 2026-08-15, 70 days before the analytics summary \(2026-10-24\)\./,
  );
  // The gap line already dates the design review; no second line for its age.
  assert.doesNotMatch(prompt, /design review is 70 days old/);
  assert.match(prompt, /One that no longer holds is `not_real` in your verdicts\./);
  // It comes before the findings, where it can still change how they're read.
  assert.ok(prompt.indexOf("## How current this is") < prompt.indexOf("## Analytics"));

  // A single-half prompt has no gap to report, but still dates an old review.
  assert.match(buildFixPrompt(apart, "design")!, /- The design review is 70 days old \(2026-08-15\)\./);

  const behind = buildFixPrompt({ ...input, summaryStale: true, reviewStale: true }, "all")!;
  assert.match(behind, /New analytics have arrived since the summary was generated/);
  assert.match(behind, /design measurements have changed since the review was generated/);
  // A stale flag only speaks for a half the prompt carries.
  assert.doesNotMatch(
    buildFixPrompt({ ...input, reviewStale: true }, "analytics")!,
    /## How current this is/,
  );
});

test("an analytics finding carries its volume, kind and search handles", () => {
  const withSignals: FixPromptInput = {
    ...input,
    summary: {
      ...summary,
      losses: [
        {
          issue: "Feature cards look clickable but aren't.",
          evidence: "div.feature-card>span",
          verified: false,
          signal: {
            kind: "element",
            clicks: 0,
            rageClicks: 0,
            deadClicks: 14,
            sessions: 9,
            pages: 2,
            selector: "div.feature-card>span.flex",
            text: "Compare plans",
          },
        },
        {
          issue: "Visitors abandon the pricing page.",
          evidence: "/pricing",
          verified: false,
          signal: { kind: "page", sessions: 600, pageViews: 900, deadClicks: 20, scrollDepth: 41 },
        },
        {
          issue: "The plan toggle draws rage clicks.",
          evidence: "plan-toggle",
          location: "src/components/PlanToggle.tsx",
          verified: true,
          signal: { kind: "component", clicks: 210, rageClicks: 31, deadClicks: 0, sessions: 1, component: "plan-toggle" },
        },
      ],
    },
  };
  const prompt = buildFixPrompt(withSignals, "analytics")!;

  assert.match(prompt, /\*\*A1\.\*\* Feature cards[^\n]*\n  - Evidence: `div\.feature-card>span`\n  - Kind: dead click\n  - Volume: 14 dead clicks from 9 sessions, on 2 pages\n/);
  // Utility classes aren't handles; the visible text and the real class are.
  assert.match(prompt, /  - Search for: the text `Compare plans` · class `feature-card`\n/);
  assert.match(prompt, /  - Source: not matched to a file — start from the evidence and the handles above/);

  assert.match(prompt, /  - Kind: page-level signal\n  - Volume: 600 sessions · 900 page views · 20 dead clicks · 41% average scroll depth/);
  assert.match(prompt, /the route's page file, `app\/pricing\/page\.\*`/);

  assert.match(prompt, /  - Kind: rage click\n  - Volume: 31 rage clicks · 210 working clicks from 1 session/);
  assert.match(prompt, /  - Search for: `data-component="plan-toggle"`/);
  assert.match(prompt, /  - Source: `src\/components\/PlanToggle\.tsx`/);
});

test("each kind of finding present gets one line on how it was detected and its blind spot", () => {
  const prompt = buildFixPrompt(input, "all")!;
  const section = prompt.slice(prompt.indexOf("## How these were detected"), prompt.indexOf("## How to work"));
  // A1's text says rage clicks; A2 carries no signal and names no kind.
  assert.match(section, /\*\*Rage click\*\* — the same element clicked several times/);
  assert.match(section, /\*\*Design measurement\*\* — .*Blind spot: a value can come from a theme token/);
  assert.doesNotMatch(section, /\*\*Dead click\*\*|\*\*JS error\*\*/);

  const dead = buildFixPrompt(
    {
      ...input,
      summary: {
        ...summary,
        losses: [{ issue: "Dead clicks on the feature cards.", evidence: "div.feature-card", verified: false }],
      },
    },
    "analytics",
  )!;
  assert.match(
    dead,
    /\*\*Dead click\*\* — a click on an element with no interactive tag .*Blind spot: handlers attached through React's `onClick` or `addEventListener` are invisible to it.*Check for a handler first\./,
  );
  assert.doesNotMatch(dead, /\*\*Design measurement\*\*/);
});

test("a design finding names its values to search for, and flags new or withheld fixes", () => {
  const checked: FixPromptInput = {
    ...input,
    review: {
      ...review,
      issues: [
        {
          issue: "Body text uses two near-identical sizes.",
          evidence: "15px and 16px",
          suggestion: "Collapse 15px into the 16px body size.",
        },
        {
          issue: "Too many heading sizes.",
          evidence: "22px, 28px, 30px",
          suggestionWithheld:
            "it proposes 12/14/16/20/24px and leaves out 22px, which this review lists as a strength",
        },
        {
          issue: "#888888 on #0a0a0a fails AA for body text.",
          evidence: "#888888 on #0a0a0a",
          suggestion: "Darken the text to #767676 (new).",
          newValues: ["#767676"],
        },
      ],
    },
  };
  const prompt = buildFixPrompt(checked, "design")!;
  assert.match(prompt, /  - Search for: `15px` \(`0\.9375rem`\), `16px` \(`1rem`\)\n/);
  assert.match(
    prompt,
    /  - Suggested fix: withheld — it proposes 12\/14\/16\/20\/24px and leaves out 22px, which this review lists as a strength\. Fix it with values the site already uses, or leave it\./,
  );
  assert.match(prompt, /  - New to the site: `#767676` — not measured anywhere on it yet\./);
  assert.match(prompt, /Don't remove or change a value listed under "Working — don't regress these"/);
});

test("the prompt ends by asking for a verdict block Polishd can read back", () => {
  const prompt = buildFixPrompt(input, "all")!;
  assert.match(prompt, /```json\n   \[\n     \{ "id": "A1", "verdict": "fixed", "reason": "[^"]+", "files": \["[^"]+"\] \}\n   \]\n   ```/);
  assert.match(prompt, /`verdict` is `fixed` \(you changed the code\), `not_real` \(the code shows the finding is wrong\) or `deliberate`/);
  assert.match(prompt, /`not_real` and `deliberate` findings, with your reasons, stop being reported\.\n$/);

  // Numbering is per half and the same in every scope.
  assert.deepEqual(
    fixPromptFindings(input, "all").map((f) => [f.id, f.evidence]),
    [
      ["A1", "button.plan-toggle"],
      ["A2", "div.feature-card"],
      ["D1", "15px and 16px"],
    ],
  );
  assert.deepEqual(fixPromptFindings(input, "design").map((f) => f.id), ["D1"]);
  assert.match(buildFixPrompt(input, "design")!, /one entry for each of D1:\n/);
});
