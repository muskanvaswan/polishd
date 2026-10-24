/**
 * Tests for spotting a React `onClick` on a DOM node.
 *
 * Run with `npm test`. React stores a host element's props on the node under
 * a per-root random suffix; these fakes carry just that key.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { hasReactClickHandler } from "./react-props.ts";

test("a backdrop with a React onClick is a click handler", () => {
  const backdrop = { tagName: "DIV", "__reactProps$k3x9q1": { onClick: () => {}, className: "x" } };
  assert.equal(hasReactClickHandler(backdrop), true);
});

test("React props without onClick, or with a non-function one, are not", () => {
  assert.equal(hasReactClickHandler({ "__reactProps$a1": { className: "row" } }), false);
  assert.equal(hasReactClickHandler({ "__reactProps$a1": { onClick: undefined } }), false);
  assert.equal(hasReactClickHandler({ "__reactProps$a1": { onClick: "alert(1)" } }), false);
  assert.equal(hasReactClickHandler({ "__reactProps$a1": null }), false);
});

test("only the node's own props count", () => {
  const inherited = Object.create({ "__reactProps$a1": { onClick: () => {} } });
  assert.equal(hasReactClickHandler(inherited), false);
});

test("a node that throws when read is simply not a handler", () => {
  const hostile = new Proxy({}, {
    ownKeys() {
      throw new Error("no keys for you");
    },
  });
  assert.equal(hasReactClickHandler(hostile), false);
  const getter = Object.defineProperty({}, "__reactProps$a1", {
    enumerable: true,
    get() {
      throw new Error("no props for you");
    },
  });
  assert.equal(hasReactClickHandler(getter), false);
});

test("other React internals and plain nodes are not", () => {
  assert.equal(hasReactClickHandler({ "__reactFiber$a1": { onClick: () => {} } }), false);
  assert.equal(hasReactClickHandler({ onclick: () => {} }), false);
  assert.equal(hasReactClickHandler({}), false);
  assert.equal(hasReactClickHandler(null), false);
});
