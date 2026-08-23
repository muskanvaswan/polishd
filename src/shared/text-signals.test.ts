/**
 * Tests for the shared text-click heuristics.
 *
 * Run with `npm test`. The subject is deliberately pure — no DOM, no database —
 * so the retro classifier the server sweep relies on is pinned down here with
 * plain strings shaped like real stored `selector` / `text` columns.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  INTERACTIVE_TAGS,
  isTextualClickRow,
  PROSE_MIN_CHARS,
  reclassifiedClickType,
  selectorTags,
} from "./text-signals.ts";

const PROSE = "This sentence is comfortably past the prose length threshold.";

test("selectorTags strips classes, ids, and case", () => {
  assert.deepEqual(selectorTags("div.card>p.intro>span#hl"), ["div", "p", "span"]);
  assert.deepEqual(selectorTags("MAIN.page>DIV"), ["main", "div"]);
  assert.deepEqual(selectorTags(""), []);
});

test("a prose tag anywhere in the path classifies as textual", () => {
  assert.equal(isTextualClickRow("div.card>p.intro>span.hl", "word"), true);
  assert.equal(isTextualClickRow("h2.title", "Short"), true);
  assert.equal(isTextualClickRow("ul.list>li.item", "Item"), true);
});

test("short standalone labels stay eligible for dead/rage detection", () => {
  assert.equal(isTextualClickRow("div.btn", "Submit"), false);
  assert.equal(isTextualClickRow("span.link", "Click here"), false);
  assert.equal(isTextualClickRow("div.overlay", undefined), false);
});

test("long text classifies as textual regardless of tag", () => {
  assert.ok(PROSE.length >= PROSE_MIN_CHARS);
  assert.equal(isTextualClickRow("div.card", PROSE), true);
  assert.equal(isTextualClickRow(undefined, PROSE), true);
});

test("boundary: exactly the threshold is prose, one short is not", () => {
  assert.equal(isTextualClickRow("span.x", "a".repeat(PROSE_MIN_CHARS)), true);
  assert.equal(isTextualClickRow("span.x", "a".repeat(PROSE_MIN_CHARS - 1)), false);
});

test("reclassifiedClickType retypes text clicks and nothing else", () => {
  // Dead/rage on text → text_click.
  assert.equal(reclassifiedClickType("dead_click", "div.card>p.x>span", "word"), "text_click");
  assert.equal(reclassifiedClickType("rage_click", "h2.title", "Pricing"), "text_click");
  assert.equal(reclassifiedClickType("dead_click", "div.card", PROSE), "text_click");
  // Short fake controls keep their friction types.
  assert.equal(reclassifiedClickType("dead_click", "div.btn", "Submit"), "dead_click");
  assert.equal(reclassifiedClickType("rage_click", "div.btn", "Buy now"), "rage_click");
  // Rage with an interactive element in the path stays rage, even on long text.
  assert.equal(reclassifiedClickType("rage_click", "button.cta>span.label", PROSE), "rage_click");
  // Other types pass through untouched.
  assert.equal(reclassifiedClickType("click", "a.nav", PROSE), "click");
  assert.equal(reclassifiedClickType("page_view", undefined, undefined), "page_view");
});

test("interactive tags are disjoint from the retro rage guard's blind spots", () => {
  // The sweep skips rage rows whose selector path contains an interactive tag;
  // these are the tags it must recognize (mirrors isInteractive's tag set).
  for (const t of ["a", "button", "input", "select", "textarea", "label", "summary"]) {
    assert.ok(INTERACTIVE_TAGS.has(t), `missing interactive tag: ${t}`);
  }
  assert.ok(selectorTags("button.cta>span.label").some((t) => INTERACTIVE_TAGS.has(t)));
});
