/**
 * Tests for turning dismissed review issues into the values the rule-based
 * checks leave out.
 *
 * Run with `npm test`. The dismissals go through the same signature reading
 * the review's own filter uses, so an issue is placed in the section its
 * wording and the measured data say it's about.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { designIssueSignature, type DismissedDesignIssue, type KnownDesignValues } from "../ai/design-suggestions.ts";
import type { PolishdIgnoredDesignIssue } from "../ai/types";
import type { PolishdDesignData } from "./design";
import { contrastDismissal, dismissedDesignValues, radiusDismissal } from "./design-dismissals.ts";
import { withDesignDismissals } from "./design.ts";

const known: KnownDesignValues = {
  type: new Set(["12px", "13px", "16px"]),
  radius: new Set(["6px", "8px"]),
  spacing: new Set(["8px", "13px"]),
  color: new Set(["#ffffff", "#888888", "#0a0a0a", "#fafafa"]),
};

const dismissed = (issue: string, evidence: string, extra: Partial<DismissedDesignIssue> = {}): DismissedDesignIssue => ({
  issue,
  signature: designIssueSignature(issue, evidence, known),
  ...extra,
});

test("each issue dismisses the values it cites, in its own section", () => {
  const out = dismissedDesignValues(
    [
      dismissed("Card padding is hand-typed", "13px padding ×4 (p-[13px])", { reason: "Optical inset" }),
      dismissed("Caption size drifts", "12px captions on /pricing"),
      dismissed("Stray corner radius", "6px radius on one card", { fixed: true }),
      dismissed("One-off background", "#fafafa background on /about"),
      dismissed("Muted text fails contrast", "#888888 on #0a0a0a at 12px"),
    ],
    known,
  );
  assert.deepEqual(out, {
    "spacing:13px": { issue: "Card padding is hand-typed", reason: "Optical inset" },
    "type:12px": { issue: "Caption size drifts" },
    "radius:6px": { issue: "Stray corner radius", fixed: true },
    "color:#fafafa": { issue: "One-off background" },
    "contrast:#0a0a0a #888888": { issue: "Muted text fails contrast" },
  });
  assert.equal(contrastDismissal(out, "#888888", "#0a0a0a")?.issue, "Muted text fails contrast");
  assert.equal(contrastDismissal(out, "#888888", "#ffffff"), undefined);
  assert.equal(radiusDismissal(out, "6px (mixed)")?.fixed, true);
  assert.equal(radiusDismissal(out, "full"), undefined);
});

test("a value the data can't place is dismissed wherever it renders; one with no values, nowhere", () => {
  // 13px is both a type size and a padding here, and nothing says which.
  const out = dismissedDesignValues([dismissed("Values drift", "13px on /pricing"), dismissed("Too many families", "Inter, Georgia")], known);
  assert.deepEqual(Object.keys(out).sort(), ["spacing:13px", "type:13px"]);
});

test("evidence that names no values falls back to the issue's wording", () => {
  // The review quoted the count; the values are in what it said about them.
  const out = dismissedDesignValues(
    [dismissed("Radii mix 4, 6, 8, 10 and 12px with no clear rule.", "5 distinct radii")],
    known,
  );
  assert.deepEqual(Object.keys(out).sort(), ["radius:10px", "radius:12px", "radius:4px", "radius:6px", "radius:8px"]);
});

test("the newest dismissal citing a value is the one it carries", () => {
  const out = dismissedDesignValues(
    [
      dismissed("Newer", "13px padding", { reason: "newer reason" }),
      dismissed("Older", "13px padding", { reason: "older reason" }),
    ],
    known,
  );
  assert.equal(out["spacing:13px"].reason, "newer reason");
});

test("dismissals rerun the flags; data nothing touches comes back as it was", () => {
  const data: PolishdDesignData = {
    ready: true,
    pages: [{ path: "/", scannedAt: 1, elements: 100 }],
    fonts: [],
    families: [],
    colors: [],
    contrast: [],
    radii: [],
    spacing: [
      { px: 8, count: 100, declarations: 10, handTyped: 0, pages: ["/"], offScale: false, outlier: false },
      { px: 13, count: 4, declarations: 1, handTyped: 1, pages: ["/"], offScale: true, outlier: false },
    ],
    flags: [{ section: "spacing", severity: "info", message: "stale" }],
  };
  const ignored = (issue: string, evidence: string): PolishdIgnoredDesignIssue => ({
    issue,
    evidence,
    reason: "Deliberate",
    ignoredAt: 1,
  });
  assert.equal(withDesignDismissals(data, []), data);
  assert.equal(withDesignDismissals(data, [ignored("Families", "Inter and Georgia")]), data);
  const out = withDesignDismissals(data, [ignored("Hand-typed card padding", "13px padding (p-[13px])")]);
  assert.deepEqual(out.dismissed, { "spacing:13px": { issue: "Hand-typed card padding", reason: "Deliberate" } });
  assert.deepEqual(out.flags, []);
});
