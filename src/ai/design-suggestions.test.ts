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
  designIssueSignature,
  dismissedIndexes,
  sameDesignIssue,
  kindOf,
  valueMentions,
  type KnownDesignValues,
} from "./design-suggestions.ts";

const known: KnownDesignValues = {
  type: new Set(["9px", "10px", "12px", "14px", "15px", "16px", "17px", "22px", "28px"]),
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
  const collapse = checkSuggestion("Heading sizes drift.", "Collapse 22px into 20px.", strengths, known);
  assert.equal(collapse.withheld, "it would replace 22px with 20px, and this review lists 22px as a strength");

  const replace = checkSuggestion("Heading sizes drift.", "Replace the 28px headings with 24px.", strengths, known);
  assert.match(replace.withheld!, /replace 28px with 24px/);

  const drop = checkSuggestion("Too many heading sizes.", "Drop 22px.", strengths, known);
  assert.equal(drop.withheld, "it would drop 22px, which this review lists as a strength");

  const instead = checkSuggestion("Heading sizes drift.", "Use 24px instead of 22px for headings.", strengths, known);
  assert.match(instead.withheld!, /replace 22px with 24px/);

  // Replacement written with "for", "become" or a bare arrow.
  const swap = checkSuggestion("Heading sizes drift.", "Swap 22px for 24px.", strengths, known);
  assert.match(swap.withheld!, /replace 22px with 24px/);
  const become = checkSuggestion(
    "Too many heading sizes.",
    "Consolidate headings: 22px and 28px become 24px.",
    strengths,
    known,
  );
  assert.match(become.withheld!, /replace 22px with 24px/);
  const arrow = checkSuggestion("Heading sizes drift.", "Headings: 28px → 24px.", strengths, known);
  assert.match(arrow.withheld!, /replace 28px with 24px/);

  // Its own property named alongside another is still a change to it.
  const sizeAndWeight = checkSuggestion(
    "Heading sizes drift.",
    "Reduce the 28px heading's size and weight to 24px.",
    strengths,
    known,
  );
  assert.match(sizeAndWeight.withheld!, /replace 28px with 24px/);
  // A property in a modifier belongs to something else, not the praised value.
  const modifier = checkSuggestion(
    "Heading sizes drift.",
    "Change the 22px headings with a border to 20px.",
    strengths,
    known,
  );
  assert.match(modifier.withheld!, /replace 22px with 20px/);

  // A praised value's own property still counts.
  const radius = checkSuggestion(
    "Corners drift.",
    "Change the 8px card radius to 6px.",
    ["Consistent 8px corner radii on every card."],
    known,
  );
  assert.match(radius.withheld!, /replace 8px with 6px/);

  const palette = checkSuggestion(
    "Two near-black backgrounds.",
    "Replace #0a0a0a with #000000.",
    ["A disciplined near-black background, #0a0a0a, on every page."],
    known,
  );
  assert.match(palette.withheld!, /replace #0a0a0a with #000000/);
});

test("a praised value that's only the subject of another change is left alone", () => {
  const strengths = [
    "Steady 16px body text on every page.",
    "Clear heading pair: 22px/28px headings, used consistently.",
  ];
  for (const suggestion of [
    "Change the 16px body text color from #888888 to #a3a3a3.",
    "Bump the line-height of 16px body text to 1.5.",
    "Convert 16px body text to rem.",
    "Reduce the weight of the 28px hero heading.",
    "Replace the hard-coded 16px with the existing body token.",
    // Another property's new value in px: still not the praised size.
    "Bump the line-height of 16px body text to 24px.",
    "Change the 16px body text's letter-spacing to 0.5px.",
    "Reduce the 28px hero heading margin to 16px.",
  ]) {
    const out = checkSuggestion("Body text could read better.", suggestion, strengths, known);
    assert.equal(out.withheld, undefined, suggestion);
    assert.equal(out.suggestion, suggestion, suggestion);
  }
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

test("known residual: with no kind named anywhere, a replacement measured as another kind is kept", () => {
  // 24px is only a padding here and nothing says the 22px or the 24px is a
  // type size, so by policy the suggestion stands (see design-suggestions.ts).
  const out = checkSuggestion("Values drift.", "Swap 22px for 24px.", ["Steady 22px and 28px headings."], known);
  assert.equal(out.withheld, undefined);
});

test("a legitimate outlier fix is kept, even next to praised values of its kind", () => {
  const strengths = [
    "Consistent 10px captions and 12px labels across every page.",
    "Headings hold to 22px and 28px.",
  ];
  for (const suggestion of [
    "9px → 10px",
    "Bump the one-off 9px label to the 10px caption size.",
    "Move the 9px badge text onto the existing 10px caption style.",
  ]) {
    const out = checkSuggestion("A 9px label is a one-off.", suggestion, strengths, known);
    assert.equal(out.withheld, undefined, suggestion);
    assert.equal(out.suggestion, suggestion);
    assert.equal(out.newValues, undefined, suggestion);
  }
});

test("strengths only praise values written as values", () => {
  // Bare numbers in a strength are prose, not praised sizes.
  const out = checkSuggestion(
    "Type sizes are loose.",
    "Use a 12/14/16/24px type scale.",
    ["A tidy 16, 20 and 22 rhythm in headings, 3 families at most."],
    known,
  );
  assert.equal(out.withheld, undefined);
});

test("a scale or palette the site mostly doesn't use is flagged, not dropped", () => {
  const scale = checkSuggestion("Type sizes are loose.", "Adopt a 13/18/21/26px type ramp.", [], known);
  assert.equal(scale.withheld, undefined);
  assert.deepEqual(scale.newValues, ["13px", "18px", "21px", "26px"]);

  const palette = checkSuggestion(
    "Grays drift.",
    "Introduce a neutral ramp: #111111, #333333, #555555, #777777.",
    [],
    known,
  );
  assert.equal(palette.withheld, undefined);
  assert.deepEqual(palette.newValues, ["#111111", "#333333", "#555555", "#777777"]);
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

// ── Recognising a dismissed issue ────────────────────────────────────────────

const sig = (issue: string, evidence: string, values = known) => designIssueSignature(issue, evidence, values);
const same = (a: [string, string], b: [string, string], values = known) =>
  sameDesignIssue(sig(...a, values), sig(...b, values));
/** Whether dismissing `a` hides `b`, as the review filter applies it. */
const hides = (a: [string, string], b: [string, string], values = known) =>
  dismissedIndexes([{ issue: b[0], evidence: b[1] }], [{ issue: a[0], signature: sig(...a, values) }], values).has(0);

test("a design issue's signature is its kind and its values, never its pages", () => {
  assert.deepEqual(sig("Body text uses two near-identical sizes.", "15px and 17px"), {
    category: "type",
    values: "15px 17px",
    sizes: [],
    role: null,
  });
  // Hex is normalized; page paths never enter it.
  assert.deepEqual(sig("A stray white.", "#FFF on /pricing"), {
    category: "palette",
    values: "#ffffff",
    sizes: [],
    role: null,
  });
  assert.deepEqual(sig("Captions fail AA.", "#444 text on #0A0A0A at 11px (2.03:1)"), {
    category: "contrast",
    values: "#0a0a0a #444444",
    sizes: ["11px"],
    role: null,
  });
  assert.equal(sig("Inconsistent icons.", "  Inconsistent   Icons ").values, "inconsistent icons");
});

test("a px issue's kind comes from explicit words, then the design data, then other wording", () => {
  // 15px and 16px are only font sizes here, so with no category named it's type.
  assert.equal(sig("Body text uses two near-identical sizes.", "15px and 16px").category, "type");
  assert.equal(sig("Two near-identical sizes.", "15px and 16px").category, "type");
  // 8px is a radius and a padding: the words decide, and without any it's just a size.
  assert.equal(sig("Cards drift.", "8px on cards").category, "size");
  assert.equal(sig("Card corners drift.", "8px").category, "radius");
  assert.equal(sig("Cards are cramped.", "8px padding").category, "spacing");
  // Explicit wording beats the data: 11px is only a font size here, but this is a radius.
  assert.equal(sig("Corners drift.", "11px radius").category, "radius");
  assert.equal(sig("Captions are tiny.", "11px captions").category, "type");
});

test("a dismissed design issue is still recognised when a regenerate rewords it", () => {
  // Drops the size, shortens the hex, changes case.
  assert.ok(
    hides(
      ["Captions fail AA contrast.", "#444444 on #0a0a0a (2.03:1 contrast at 11px)"],
      ["Low-contrast caption text.", "#444 text on #0A0A0A"],
    ),
  );
  // Rewords the issue completely.
  assert.ok(
    hides(["Body text uses two near-identical sizes.", "15px and 16px"], ["Two near-identical sizes.", "15px and 16px"]),
  );
  // Adds a page and reorders the values.
  assert.ok(hides(["Body sizes drift.", "15px and 17px"], ["Body sizes drift.", "17px / 15px on /blog"]));
  // Two pairs, reworded every way at once: order, shorthand, joiner, ratios, sizes.
  const pairs: [string, string] = [
    "Captions fail AA contrast.",
    "#444444 on #0a0a0a (2.03:1 contrast at 11px) and #555555 on #0a0a0a (2.6:1 at 12px)",
  ];
  assert.ok(hides(pairs, ["Low-contrast captions.", "#555 and #444 text on #0A0A0A"]));
  assert.ok(hides(pairs, ["Low-contrast captions.", "#555 at 12px and #444 at 11px, both on #0A0A0A"]));
  assert.ok(hides(pairs, ["Muted copy on black.", "#0a0a0a background under #444444 / #555555 copy"]));
  // A different pairing is a different issue.
  assert.ok(!same(["Captions fail AA contrast.", "#444444 on #0a0a0a at 11px"], ["Captions fail AA contrast.", "#444444 on #ffffff at 11px (9.7:1)"]));
});

test("issues citing the same value for different things don't share a dismissal", () => {
  // A one-off background and a border color, both #0a0a0a.
  assert.ok(
    !hides(
      ["One page has its own background.", "#0a0a0a one-off background on /about"],
      ["Borders use the page color.", "#0a0a0a used for borders on /pricing"],
    ),
  );
  // A role on one side and none on the other is a non-match.
  assert.ok(!hides(["One page has its own background.", "#0a0a0a one-off background on /about"], ["A stray near-black.", "#0a0a0a on /pricing"]));
  assert.ok(hides(["A stray near-black.", "#0a0a0a"], ["A stray near-black, again.", "#0A0A0A on /pricing"]));

  // 11px type and an 11px radius, whether or not the site measures both.
  const both: KnownDesignValues = {
    ...known,
    type: new Set([...known.type, "11px"]),
    radius: new Set([...known.radius, "11px"]),
  };
  assert.ok(!same(["Captions are tiny.", "11px captions"], ["Corners drift.", "11px radius"], both));
  const typeOnly: KnownDesignValues = { ...known, type: new Set([...known.type, "11px"]) };
  assert.ok(!same(["Captions are tiny.", "11px captions"], ["Corners drift.", "11px radius"], typeOnly));

  // The same pair failing at different sizes: two failures.
  assert.ok(!hides(["Captions fail contrast.", "#888888 on #0a0a0a at 11px"], ["Body text fails contrast.", "#888888 on #0a0a0a at 16px"]));
  // Overlapping isn't enough: both list sizes, so the sets must be the same.
  assert.ok(
    !hides(
      ["Small text fails contrast.", "#888888 on #0a0a0a at 11px and 12px"],
      ["Small text fails contrast.", "#888888 on #0a0a0a at 12px and 16px"],
    ),
  );
  assert.ok(hides(["Captions fail contrast.", "#888888 on #0a0a0a at 11px"], ["Captions fail contrast.", "#888 on #0A0A0A, 11px"]));
});

test("one dismissal hides only the closest of two issues citing identical evidence", () => {
  const current = [
    { issue: "Captions fail AA contrast.", evidence: "#888888 on #0a0a0a" },
    { issue: "Placeholder text fails AA contrast.", evidence: "#888888 on #0a0a0a" },
  ];
  const placeholders = { issue: "Placeholder text is too faint.", signature: sig(current[1].issue, current[1].evidence) };
  assert.deepEqual([...dismissedIndexes(current, [placeholders], known)], [1]);
  // Both dismissed: both hidden, each by its own entry.
  const captions = { issue: "Captions fail AA contrast.", signature: sig(current[0].issue, current[0].evidence) };
  assert.deepEqual([...dismissedIndexes(current, [placeholders, captions], known)].sort(), [0, 1]);
});
