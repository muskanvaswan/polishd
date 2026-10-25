/**
 * Tests for what counts as a control (dom.ts `controlOf` / `isInteractive`).
 *
 * Run with `npm test`. No DOM: the elements are fakes carrying only what the
 * walk reads. The case that matters is a modal: its panel's
 * `onClick={(e) => e.stopPropagation()}`, and any other React handler far up
 * the tree, must not make every element inside it a "control" — that hid
 * every dead click inside a modal.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { controlOf, isControl, isInteractive } from "./dom.ts";

const el = (
  tag: string,
  parentElement: Element | null = null,
  { attrs = {}, onClick }: { attrs?: Record<string, string>; onClick?: (e: Event) => void } = {},
): Element =>
  ({
    nodeType: 1,
    tagName: tag.toUpperCase(),
    parentElement,
    getAttribute: (name: string) => attrs[name] ?? null,
    hasAttribute: (name: string) => name in attrs,
    isContentEditable: false,
    ...(onClick ? { "__reactProps$t1": { onClick } } : {}),
  }) as unknown as Element;

const act = () => {};

test("markup controls count up to four levels up", () => {
  const button = el("button");
  const deep = el("span", el("span", el("span", button)));
  assert.equal(controlOf(deep), button);
  assert.equal(isInteractive(el("i", deep)), false, "five levels is too far");
  const role = el("div", null, { attrs: { role: "menuitem" } });
  assert.equal(controlOf(el("span", role)), role);
});

test("a React onClick counts on the clicked element or its parent", () => {
  const card = el("div", null, { onClick: act });
  assert.equal(controlOf(card), card);
  assert.equal(controlOf(el("img", card)), card);
});

test("…but not further up: a click deeper inside is judged by its outcome", () => {
  const panel = el("div", null, { onClick: act });
  const body = el("div", panel);
  const row = el("p", body);
  assert.equal(controlOf(el("span", row)), null);
  assert.equal(isInteractive(el("span", row)), false);
});

test("a modal panel that only stops propagation is not a control at all", () => {
  const panel = el("div", null, { onClick: (e) => e.stopPropagation() });
  assert.equal(isControl(panel), false);
  assert.equal(isInteractive(panel), false);
  assert.equal(isInteractive(el("div", panel)), false);
  // A real control inside it still is.
  const close = el("button", panel);
  assert.equal(isInteractive(el("svg", close)), true);
});

test("near-miss candidates: a React onClick still makes an element itself a control", () => {
  assert.equal(isControl(el("div", null, { onClick: act })), true);
  assert.equal(isControl(el("div")), false);
});
