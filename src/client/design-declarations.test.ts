/**
 * Tests for how the design scan tells decisions apart from their copies.
 *
 * Run with `npm test`. No DOM: elements are minimal fakes carrying only a tag,
 * attributes and a parent. The cases worth pinning are the ones that inflated
 * a real review — a badge class repeated down a table read as 38 decisions,
 * Tailwind's half steps read as off-grid, and loading skeletons read as
 * palette colors.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  declarationId,
  declarationSignature,
  inheritedDeclarer,
  isHandTyped,
  readClassString,
  transientReason,
  type ElementLike,
} from "./design-declarations.ts";

const el = (tag: string, attrs: Record<string, string> = {}, parentElement: ElementLike | null = null): ElementLike => ({
  tagName: tag.toUpperCase(),
  parentElement,
  getAttribute: (name: string) => attrs[name] ?? null,
});

test("rows sharing a class string are one declaration, whatever the token order", () => {
  const table = el("table", { class: "w-full text-sm" });
  const rows = Array.from({ length: 38 }, () => el("span", { class: "rounded px-2 text-xs bg-[#1a1a1a]" }, table));
  const reordered = el("span", { class: "bg-[#1a1a1a]  text-xs rounded px-2 px-2" }, table);
  // A template literal's line breaks and indentation are whitespace like any other.
  const templated = el("span", { class: `\n    rounded px-2\n\ttext-xs ${""}\n    bg-[#1a1a1a]\n  ` }, table);
  const ids = new Set([...rows, reordered, templated].map((r) => declarationId(declarationSignature(r))));
  assert.equal(ids.size, 1);
  assert.notEqual(
    declarationId(declarationSignature(el("span", { class: "rounded px-2 text-xs" }, table))),
    [...ids][0],
  );
});

test("an unclassed element is its tag path from the nearest classed ancestor", () => {
  const prose = el("article", { class: "prose" });
  const ul = el("ul", {}, prose);
  const li = el("li", {}, ul);
  assert.equal(declarationSignature(li), ".prose>ul>li");
  // Past three hops it stops looking; the path alone is the identity.
  const deep = el("span", {}, el("em", {}, el("b", {}, el("i", {}, el("div", { class: "far" })))));
  assert.equal(declarationSignature(deep), "i>b>em>span");
});

test("an inherited value is declared where its run of equal values starts", () => {
  const body = el("body", { class: "font-sans text-gray-900" });
  const card = el("div", { class: "text-[#555]" }, body);
  const a = el("span", { class: "truncate" }, card);
  const b = el("span", { class: "font-mono" }, card);
  const heading = el("h2", { class: "text-gray-900" }, card);
  const color = new Map<ElementLike, string>([
    [body, "#111"],
    [card, "#555"],
    [a, "#555"],
    [b, "#555"],
    [heading, "#111"],
  ]);
  const memo = new Map<ElementLike, ElementLike>();
  const of = (e: ElementLike) => color.get(e) ?? "";
  assert.equal(inheritedDeclarer(a, of, memo), card);
  assert.equal(inheritedDeclarer(b, of, memo), card);
  // Same value as the body, but its parent broke the run — its own decision.
  assert.equal(inheritedDeclarer(heading, of, memo), heading);
  assert.equal(inheritedDeclarer(card, of, memo), card);
});

test("arbitrary values are read per property; token references are not", () => {
  const props = (cls: string) => [...readClassString(cls).arbitrary.keys()].sort();
  assert.deepEqual(props("text-[#555] bg-[#111] border-[#2e2e2e] rounded-[2px]"), [
    "background",
    "border",
    "color",
    "radius",
  ]);
  assert.deepEqual(props("text-[11px]"), ["fontSize"]);
  assert.deepEqual(props("text-[clamp(1rem,2vw,2rem)]"), ["fontSize"]);
  assert.deepEqual(props("px-[13px] pt-[9px]"), ["padLeft", "padRight", "padTop"]);
  assert.deepEqual(props("p-[13px]"), ["padBottom", "padLeft", "padRight", "padTop"]);
  // Theme references and non-color brackets.
  assert.deepEqual(props("text-[color:var(--muted)] bg-[var(--brand)] text-[--fg] border-[2px] bg-[url(/a.png)]"), []);
  assert.deepEqual(props("text-gray-500 bg-white rounded-md p-2"), []);
  // Breakpoints and dark mode can describe what renders; hover and other states can't.
  assert.deepEqual(props("md:p-[13px]"), ["padBottom", "padLeft", "padRight", "padTop"]);
  assert.deepEqual(props("dark:bg-[#111]"), ["background"]);
  assert.deepEqual(props("hover:bg-[#222] group-hover:text-[#fff] focus:p-[3px] aria-expanded:bg-[#333]"), []);
  assert.deepEqual(props("!text-[#555] text-[#666]!"), ["color"]);
  assert.deepEqual(props("bg-[#111]/80"), ["background"]);
});

test("an arbitrary value is hand-typed only when it's what renders", () => {
  const typed = (cls: string, prop: Parameters<typeof isHandTyped>[1], rendered: string | number, remPx = 16) =>
    isHandTyped(readClassString(cls), prop, rendered, remPx);
  // Unprefixed and showing.
  assert.equal(typed("text-[#555]", "color", "#555555"), true);
  assert.equal(typed("p-[13px]", "padTop", 13), true);
  assert.equal(typed("text-[0.8125rem]", "fontSize", 13), true);
  assert.equal(typed("bg-[#111]/80", "background", "#111111cc"), true);
  // A breakpoint's arbitrary value counts when the breakpoint is live, and only then.
  assert.equal(typed("p-2 sm:p-[13px]", "padTop", 13), true);
  assert.equal(typed("p-2 sm:p-[13px]", "padTop", 8), false);
  // A base arbitrary value a breakpoint overrides isn't what renders.
  assert.equal(typed("p-[13px] md:p-4", "padTop", 16), false);
  assert.equal(typed("text-[#555] dark:text-[#eee]", "color", "#eeeeee"), true);
  // A state variant never counts at rest, even when the literal happens to match.
  assert.equal(typed("text-[#fff] hover:text-[#fff]", "color", "#ffffff"), true);
  assert.equal(typed("text-white hover:text-[#fff]", "color", "#ffffff"), false);
  // Literals that can't be compared: unprefixed counts, prefixed doesn't.
  assert.equal(typed("text-[rgb(85,85,85)]", "color", "#555555"), true);
  assert.equal(typed("md:text-[clamp(1rem,2vw,2rem)]", "fontSize", 18), false);
  // No arbitrary class for the property: theme token, not hand-typed.
  assert.equal(typed("text-gray-600 p-[13px]", "color", "#4b5563"), false);
  assert.equal(isHandTyped(null, "color", "#555555"), false);
});

test("Tailwind is read from its utilities, not from any class at all", () => {
  for (const cls of ["flex items-center gap-2", "text-sm font-medium", "p-1.5", "bg-zinc-900/80", "hover:underline", "w-[37%]"]) {
    assert.equal(readClassString(cls).tailwind, true, cls);
  }
  for (const cls of ["btn btn-primary", "Card_root__a1b2c", "flex", "container"]) {
    assert.equal(readClassString(cls).tailwind, false, cls);
  }
});

test("loading states and closed overlays are transient; scroll-reveal content isn't", () => {
  const shown = { display: "block", opacity: "1", position: "static" };
  assert.equal(transientReason(el("div", { "aria-busy": "true" }), shown), "busy");
  assert.equal(transientReason(el("div", { class: "h-4 w-32 animate-pulse rounded bg-[#1a1a1a]" }), shown), "skeleton");
  assert.equal(transientReason(el("div", { class: "motion-safe:animate-pulse" }), shown), "skeleton");
  assert.equal(transientReason(el("span", { class: "MuiSkeleton-root" }), shown), "skeleton");
  assert.equal(transientReason(el("div"), { ...shown, display: "none" }), "unrendered");
  assert.equal(transientReason(el("div", { "aria-hidden": "true" }), { ...shown, opacity: "0" }), "invisible");
  assert.equal(transientReason(el("div", { inert: "" }), { ...shown, opacity: "0" }), "invisible");
  assert.equal(transientReason(el("div"), { ...shown, opacity: "0", position: "fixed" }), "invisible");
  // Waiting at opacity 0 to fade in on scroll is still the design.
  assert.equal(transientReason(el("section"), { ...shown, opacity: "0" }), null);
  assert.equal(transientReason(el("svg", { "aria-hidden": "true" }), shown), null);
  assert.equal(transientReason(el("div", { class: "rounded bg-white p-4" }), shown), null);
});
