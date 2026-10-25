/**
 * Tests for the Overview paragraph's cleanup.
 *
 * Run with `npm test`. The model is asked for one paragraph of plain prose and
 * mostly complies; what's pinned here is the tidy-up for when it doesn't — a
 * fence, a heading, a label, a bulleted list or paragraph breaks all come out
 * as one paragraph, and prose that's already one paragraph is left alone.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { oneParagraph } from "./overview.ts";

test("plain prose is returned as written", () => {
  const text = "Visitors head for pricing and stall on the plan toggle. Protect the hero CTA.";
  assert.equal(oneParagraph(`  ${text}\n`), text);
});

test("fences, headings and labels are stripped", () => {
  assert.equal(oneParagraph("```\nOne story.\n```"), "One story.");
  assert.equal(oneParagraph("## Overview\n\nOne story."), "One story.");
  assert.equal(oneParagraph("**Summary:** One story."), "One story.");
  assert.equal(oneParagraph("Summary: One story."), "One story.");
});

test("paragraph breaks and bullets fold into one paragraph", () => {
  assert.equal(
    oneParagraph("First sentence.\n\nSecond sentence.\n- Third point.\n2) Fourth point."),
    "First sentence. Second sentence. Third point. Fourth point.",
  );
});
