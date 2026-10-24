/**
 * Tests for the event-target helpers.
 *
 * Run with `npm test`. No DOM: the targets are minimal fakes carrying only what
 * the helpers read. The case that matters is a runtime error, whose `error`
 * event targets `window` — reading it as an element threw inside the capture
 * listener, so the error never reached the store.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { componentOf, labelOf, selectorOf } from "./target.ts";

/** Just enough of an Element for the walks: tag, id, attributes, parent. */
const el = (
  tag: string,
  attrs: Record<string, string> = {},
  parentElement: Element | null = null,
  textContent = "",
): Element =>
  ({
    nodeType: 1,
    tagName: tag.toUpperCase(),
    id: attrs.id ?? "",
    parentElement,
    textContent,
    getAttribute: (name: string) => attrs[name] ?? null,
  }) as unknown as Element;

/** A Window: an event target with none of an element's methods. */
const fakeWindow = { window: null, document: {} } as unknown as EventTarget;
/** A Document is a node, but not an element — it has no `getAttribute`. */
const fakeDocument = { nodeType: 9, documentElement: null } as unknown as EventTarget;

test("a runtime error's window target describes as undefined, without throwing", () => {
  assert.equal(componentOf(fakeWindow), undefined);
  assert.equal(selectorOf(fakeWindow), undefined);
  assert.equal(labelOf(fakeWindow), undefined);
});

test("other non-element targets describe as undefined too", () => {
  for (const target of [fakeDocument, null]) {
    assert.equal(componentOf(target), undefined);
    assert.equal(selectorOf(target), undefined);
    assert.equal(labelOf(target), undefined);
  }
});

test("a failed resource load is still attributed to its component", () => {
  const section = el("section", { "data-component": "Hero", class: "hero wide" });
  const img = el("img", { class: "cover" }, el("div", { class: "media" }, section));
  assert.equal(componentOf(img), "Hero");
  assert.equal(selectorOf(img), "section.hero>div.media>img.cover");
});

test("labelOf reads an element's text, collapsed and capped", () => {
  const button = el("button", {}, null, "  Save\n   changes  ");
  assert.equal(labelOf(button), "Save changes");
  assert.equal(labelOf(el("p", {}, null, "x".repeat(200)))?.length, 80);
});
