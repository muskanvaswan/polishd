/**
 * Tests for the design review's suggestion check.
 *
 * Run with `npm test`. The case worth guarding hardest is the one that
 * started this: a review that praised the site's 22px and 28px headings,
 * then suggested a 12/14/16/20/24 type scale that drops both. A coding agent
 * handed that suggestion implements it, so the check has to catch it — and
 * has to leave alone the ordinary "move this outlier onto that value" fix.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  checkSuggestion,
  designEvidenceKey,
  kindOf,
  valueMentions,
  type KnownDesignValues,
} from "./design-suggestions.ts";

const known: KnownDesignValues = {
  type: new Set(["12px", "14px", "15px", "16px", "17px", "22px", "28px"]),
  radius: new Set(["8px", "9999px"]),
  spacing: new Set(["8px", "16px", "24px"]),
  color: new Set(["#0a0a0a", "#ffffff", "#888888", "#e4e4e4"]),
};

const keys = (text: string) => valueMentions(text).map((m) => m.key);

test("values are read the way designers write them", () => {
  assert.deepEqual(keys("a 12/14/16/20/24px scale"), ["12px", "14px", "16px", "20px", "24px"]);
  assert.deepEqual(keys("headings at 22px/28px"), ["22px", "28px"]);
  assert.deepEqual(keys("collapse 15px and 17px into 16px."), ["15px", "17px", "16px"]);
  // A size and a weight: the unit doesn't spread forward.
  assert.deepEqual(keys("Inter 16px/400"), ["16px"]);
  // A bare scale still counts; bare weights and stray counts don't.
  assert.deepEqual(keys("a 12/14/16/20/24 type scale"), ["12px", "14px", "16px", "20px", "24px"]);
  assert.deepEqual(keys("weights 400/500/700"), []);
  assert.deepEqual(keys("on 3 pages, 2 times"), []);
  // Shorthand hex is spelled out; utility classes aren't values.
  assert.deepEqual(keys("#FFF on #0a0a0a, mt-2 and space-4"), ["#ffffff", "#0a0a0a"]);
});

test("a sentence's kind comes from its words, and is null when they disagree", () => {
  assert.equal(kindOf("22px and 28px headers, used consistently"), "type");
  assert.equal(kindOf("consistent 8px corner radii"), "radius");
  assert.equal(kindOf("padding sits on a 4px grid"), "spacing");
  assert.equal(kindOf("8px radius and 16px padding"), null);
});

test("a scale that drops the headings the review praised is withheld", () => {
  const strengths = ["Clear heading hierarchy: 22px and 28px headers, used consistently across pages."];
  const out = checkSuggestion(
    "Too many type sizes for body copy.",
    "Adopt a 12/14/16/20/24 type scale and map every style onto it.",
    strengths,
    known,
  );
  assert.equal(out.suggestion, undefined);
  assert.match(out.withheld!, /12\/14\/16\/20\/24px and leaves out 22px, which this review lists as a strength/);
});

test("naming a praised value as the one to replace is withheld", () => {
  const strengths = ["Headings hold to 22px and 28px."];
  const collapse = checkSuggestion("Heading sizes drift.", "Collapse 22px into 24px.", strengths, known);
  assert.match(collapse.withheld!, /replace 22px/);

  const instead = checkSuggestion("Heading sizes drift.", "Use 24px instead of 22px for headings.", strengths, known);
  assert.match(instead.withheld!, /replace 22px/);

  const palette = checkSuggestion(
    "Two near-black backgrounds.",
    "Replace #0a0a0a with #000000.",
    ["A disciplined near-black background, #0a0a0a, on every page."],
    known,
  );
  assert.match(palette.withheld!, /replace #0a0a0a/);
});

test("moving an outlier onto a praised value is the fix the review should give", () => {
  const strengths = ["Headings hold to 22px and 28px."];
  const out = checkSuggestion(
    "One heading is 23px.",
    "Move the 23px heading onto the existing 22px header size.",
    strengths,
    known,
  );
  assert.equal(out.withheld, undefined);
  assert.equal(out.suggestion, "Move the 23px heading onto the existing 22px header size.");
  assert.equal(out.newValues, undefined);
});

test("a partial list or a shared target isn't a removal", () => {
  const strengths = ["Headings hold to 22px and 28px."];
  // Body sizes below the headings: the praised sizes sit outside its range.
  const body = checkSuggestion("Body copy drifts.", "Use 14/16/18px for body copy.", strengths, known);
  assert.equal(body.withheld, undefined);
  assert.deepEqual(body.newValues, ["18px"]);

  // 22px is named among the values to unify, and as the one they unify on.
  const unify = checkSuggestion("Headings drift.", "Unify the 22px and 23px headings on 22px.", strengths, known);
  assert.equal(unify.withheld, undefined);

  // A text palette that leaves out the praised background doesn't remove it.
  const text = checkSuggestion(
    "Text colors drift.",
    "Keep text to the existing #ffffff, #e4e4e4 and #888888.",
    ["One near-black background, #0a0a0a, on every page."],
    known,
  );
  assert.equal(text.withheld, undefined);
});

test("a praised value of a different kind doesn't block an unrelated scale", () => {
  // 8px radii are praised; a type scale without 8 says nothing about corners.
  const out = checkSuggestion(
    "Body copy uses two near-identical sizes.",
    "Standardize body text on the 14/16/22px sizes already in use.",
    ["Consistent 8px corner radii on every card."],
    known,
  );
  assert.equal(out.withheld, undefined);
  assert.ok(out.suggestion);
});

test("a scale or palette the site mostly doesn't use is withheld as a redesign", () => {
  const scale = checkSuggestion("Type sizes are loose.", "Adopt a 13/18/21/26px type ramp.", [], known);
  assert.match(scale.withheld!, /new scale \(13\/18\/21\/26px\)/);

  const palette = checkSuggestion(
    "Grays drift.",
    "Introduce a neutral ramp: #111111, #333333, #555555, #777777.",
    [],
    known,
  );
  assert.match(palette.withheld!, /new palette/);
});

test("a kept suggestion reports any value the site doesn't render yet", () => {
  const out = checkSuggestion(
    "#888888 on #0a0a0a fails contrast for body text.",
    "Darken the text to #767676 (new) so it passes 4.5:1.",
    [],
    known,
  );
  assert.equal(out.withheld, undefined);
  assert.deepEqual(out.newValues, ["#767676"]);

  // The values being removed aren't "new", even when they're unmeasured.
  const collapse = checkSuggestion("Body sizes drift.", "Collapse 15px and 17px into 16px.", [], known);
  assert.equal(collapse.newValues, undefined);
});

test("design dismissals key on the values cited, not their wording", () => {
  assert.equal(designEvidenceKey("15px and 17px"), designEvidenceKey("17px / 15px"));
  assert.equal(designEvidenceKey("#FFF on /pricing"), "#ffffff /pricing");
  assert.notEqual(designEvidenceKey("#888 on #0a0a0a"), designEvidenceKey("#888"));
  assert.equal(designEvidenceKey("  Inconsistent Icons "), "inconsistent icons");
});
