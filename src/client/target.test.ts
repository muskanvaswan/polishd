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

/** How many elements carry each class, for the document the fakes live in. */
let classCounts: Record<string, number> = {};
const fakeDoc = {
  getElementsByClassName: (cls: string) => ({ length: classCounts[cls] ?? 0 }),
};

/** Just enough of an Element for the walks: tag, id, attributes, parent, document. */
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
    ownerDocument: fakeDoc,
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
  assert.equal(selectorOf(img), 'section[data-component="Hero"]>div.media>img.cover');
});

test("selectorOf picks each level's most distinctive class, not its first", () => {
  classCounts = { "text-white": 40, "min-h-screen": 60, "mb-8": 25, "settings-panel": 1, fixed: 3, "inset-0": 9, absolute: 30, "z-50": 4 };
  const main = el("main", { class: "text-white min-h-screen" });
  const section = el("section", { class: "mb-8 settings-panel" }, main);
  const overlay = el("div", { class: "fixed inset-0 z-50" }, section);
  const target = el("div", { class: "absolute inset-0" }, overlay);
  // Before: main.text-white>section.mb-8>div.fixed>div.absolute — nothing to grep for.
  assert.equal(selectorOf(target), "main.text-white>section.settings-panel>div.fixed>div.inset-0");
  classCounts = {};
});

test("variant, arbitrary and escaping-needed classes are skipped; never an empty class", () => {
  classCounts = { sticky: 2, "top-0": 50 };
  assert.equal(
    selectorOf(el("div", { class: "lg:sticky hover:bg-white bg-[#111] w-1/2 py-2.5 !mt-0 top-0" })),
    "div.top-0",
  );
  assert.equal(selectorOf(el("a", { class: "  lg:block [mask-type:luminance] " })), "a");
  assert.equal(selectorOf(el("a", { class: "" })), "a");
  assert.equal(selectorOf(el("span", {})), "span");
  classCounts = {};
});

test("with no document to count in, the first plain class wins", () => {
  const detached = { ...el("img", { class: "md:hidden cover thumb" }), ownerDocument: null } as unknown as Element;
  assert.equal(selectorOf(detached), "img.cover");
});

test("the walk stops at the nearest anchor: a data-component, or an id a person wrote", () => {
  const page = el("div", { id: "app" });
  const card = el("article", { "data-component": "note-card", class: "card" }, page);
  const row = el("div", { class: "row" }, card);
  assert.equal(selectorOf(el("button", { class: "btn" }, row)), 'article[data-component="note-card"]>div.row>button.btn');
  assert.equal(selectorOf(card), 'article[data-component="note-card"]');
  const settings = el("section", { id: "settings", class: "panel" });
  assert.equal(selectorOf(el("span", {}, settings)), "section#settings>span");
});

test("generated ids and unquotable component names are not anchors", () => {
  for (const id of [":r1:", "«r5»", "radix-:r2:", "headlessui-menu-button-:r3:"]) {
    const outer = el("nav", { class: "top" });
    const generated = el("div", { id, class: "menu" }, outer);
    assert.equal(selectorOf(generated), "nav.top>div.menu", id);
  }
  const odd = el("div", { "data-component": 'a>b"c', class: "odd" });
  assert.equal(selectorOf(el("i", {}, odd)), "div.odd>i");
});

test("the path stays capped at four levels and stops at <body>", () => {
  let node: Element = el("body");
  for (const tag of ["main", "div", "section", "ul", "li"]) node = el(tag, {}, node);
  assert.equal(selectorOf(node), "div>section>ul>li");
  assert.equal(selectorOf(el("p", {}, el("body"))), "p");
});

test("labelOf reads an element's text, collapsed and capped", () => {
  const button = el("button", {}, null, "  Save\n   changes  ");
  assert.equal(labelOf(button), "Save changes");
  assert.equal(labelOf(el("p", {}, null, "x".repeat(200)))?.length, 80);
});
