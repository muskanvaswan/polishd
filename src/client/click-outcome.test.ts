/**
 * Tests for judging a click by its outcome.
 *
 * Run with `npm test`. No DOM: the judge sees the browser only through
 * `JudgeEnv`, so the clock, the URL, focus and mutation delivery are all fakes
 * driven by hand. The cases that matter are the false alarms that started
 * this — a backdrop that closes its drawer, a layer that dismisses itself on
 * press — and the ambient noise that must not hide a genuinely dead click.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createClickJudge,
  isMeaningfulMutation,
  type JudgeEnv,
  type MutationLike,
  type NodeLike,
} from "./click-outcome.ts";

interface FakeNode extends NodeLike {
  parent: FakeNode | null;
  /** Covers too much of the screen to be a component. */
  big: boolean;
}

/** A node whose `contains` follows its parent chain, inclusively. */
const node = (nodeName: string, parent: FakeNode | null = null, big = false): FakeNode => {
  const self: FakeNode = {
    nodeName,
    parent,
    big,
    contains(other: unknown) {
      for (let n = other as FakeNode | null; n; n = n.parent) if (n === self) return true;
      return false;
    },
  };
  return self;
};

const html = node("HTML", null, true);
const body = node("BODY", html, true);
const drawer = node("DIV", body, true);
const backdrop = node("DIV", drawer, true);
const card = node("DIV", body);
const cardText = node("#text", card);
const clock = node("#text", node("SPAN", body));
// The report's layout: a full-width row whose only control is a small button.
const bar = node("DIV", body);
const button = node("BUTTON", bar);
const buttonText = node("#text", button);
const list = node("UL", body);

/** A browser with a hand-cranked clock. */
function fakeBrowser() {
  let now = 0;
  let nextId = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let deliver: ((records: readonly MutationLike[]) => void) | null = null;
  const state = { href: "https://site.test/a", active: body as unknown, observers: 0 };

  const env: JudgeEnv = {
    href: () => state.href,
    activeElement: () => state.active,
    isComponentSized: (n) => !(n as FakeNode).big,
    observe(onRecords) {
      deliver = onRecords;
      state.observers++;
      return () => {
        deliver = null;
        state.observers--;
      };
    },
    setTimeout(fn, ms) {
      timers.set(++nextId, { at: now + ms, fn });
      return nextId;
    },
    clearTimeout(handle) {
      timers.delete(handle as number);
    },
  };

  return {
    env,
    state,
    advance(ms: number) {
      now += ms;
      const due = [...timers].filter(([, t]) => t.at <= now).sort((a, b) => a[1].at - b[1].at);
      for (const [id, t] of due) {
        timers.delete(id);
        t.fn();
      }
    },
    mutate(...records: MutationLike[]) {
      deliver?.(records);
    },
  };
}

/** Collects the verdicts `judge` hands back. */
const verdicts = () => {
  const seen: boolean[] = [];
  return { seen, done: (worked: boolean) => seen.push(worked) };
};

const added = (target: FakeNode, ...names: string[]): MutationLike => ({
  type: "childList",
  target,
  addedNodes: names.map((nodeName) => ({ nodeName })),
});
const attr = (target: FakeNode, attributeName: string): MutationLike => ({
  type: "attributes",
  target,
  attributeName,
});
const text = (target: FakeNode): MutationLike => ({ type: "characterData", target });

test("a click after which nothing happens is dead — after the hold, not before", () => {
  const b = fakeBrowser();
  const judge = createClickJudge(b.env, { holdMs: 1000 });
  const v = verdicts();
  judge.judge(card, v.done);
  b.advance(999);
  assert.deepEqual(v.seen, []);
  b.advance(1);
  assert.deepEqual(v.seen, [false]);
  assert.equal(judge.pending(), 0);
  assert.equal(b.state.observers, 0, "stops observing once nothing is pending");
});

test("a DOM change settles the click as working at once", () => {
  const b = fakeBrowser();
  const judge = createClickJudge(b.env);
  const v = verdicts();
  judge.judge(backdrop, v.done);
  // The drawer closing: its class and aria-hidden flip on an ancestor.
  b.mutate(attr(drawer, "aria-hidden"));
  assert.deepEqual(v.seen, [true]);
  b.advance(5000);
  assert.deepEqual(v.seen, [true], "settles exactly once");
  assert.equal(b.state.observers, 0);
});

test("a URL change or a focus move during the hold counts as a response", () => {
  const b = fakeBrowser();
  const judge = createClickJudge(b.env);
  const url = verdicts();
  judge.judge(card, url.done);
  b.state.href = "https://site.test/b";
  b.advance(1000);
  assert.deepEqual(url.seen, [true]);

  const focus = verdicts();
  judge.judge(card, focus.done);
  b.state.active = node("INPUT", body);
  b.advance(1000);
  assert.deepEqual(focus.seen, [true]);
});

test("the browser's own focus change on mousedown is not a response", () => {
  const b = fakeBrowser();
  const judge = createClickJudge(b.env);
  const v = verdicts();
  b.state.active = node("INPUT", body); // an input was focused…
  judge.begin(card, "press");
  judge.arm(card);
  b.state.active = body; // …and pressing a plain div blurred it
  judge.begin(card, "click");
  judge.judge(card, v.done);
  b.advance(1000);
  assert.deepEqual(v.seen, [false]);
});

test("what the press did counts for the click, even when the click lands elsewhere", () => {
  const b = fakeBrowser();
  const judge = createClickJudge(b.env);
  const v = verdicts();
  // A layer that dismisses on pointerdown removes itself before the click
  // fires, and the click then lands on the body underneath.
  judge.begin(backdrop, "press");
  judge.arm(backdrop);
  b.mutate({ type: "childList", target: body, removedNodes: [{ nodeName: "DIV" }] });
  judge.begin(body, "click");
  judge.judge(body, v.done);
  assert.deepEqual(v.seen, [true]);
});

test("a press released to a control, or never clicked, emits nothing", () => {
  const b = fakeBrowser();
  const judge = createClickJudge(b.env, { armMs: 3000 });
  judge.arm(card);
  judge.release();
  assert.equal(judge.pending(), 0);

  judge.arm(card);
  judge.arm(backdrop); // a new press drops the one that never clicked
  assert.equal(judge.pending(), 1);
  b.advance(3000); // and a press that never clicks expires
  assert.equal(judge.pending(), 0);
  assert.equal(b.state.observers, 0);
});

test("settleAll resolves every pending click as working", () => {
  const b = fakeBrowser();
  const judge = createClickJudge(b.env);
  const first = verdicts();
  const second = verdicts();
  judge.judge(card, first.done);
  judge.judge(backdrop, second.done);
  judge.arm(card);
  judge.settleAll();
  assert.deepEqual([first.seen, second.seen], [[true], [true]]);
  assert.equal(judge.pending(), 0);
  b.advance(5000);
  assert.deepEqual([first.seen, second.seen], [[true], [true]]);
});

/** A real click as the capture layer reports it: press, then click. */
const press = (judge: ReturnType<typeof createClickJudge>, target: FakeNode, done?: (w: boolean) => void) => {
  judge.begin(target, "press");
  if (done) judge.arm(target);
  judge.begin(target, "click");
  if (done) judge.judge(target, done);
  else judge.release();
};

test("the newest click takes the credit: a miss beside a button stays dead", () => {
  const b = fakeBrowser();
  const judge = createClickJudge(b.env);
  const miss = verdicts();
  press(judge, bar, miss.done); // nothing happens…
  b.advance(400);
  press(judge, button); // …so the visitor clicks the button itself, which works:
  b.mutate(text(buttonText), added(list, "LI", "LI")); // its label flips, the list opens
  b.advance(600);
  assert.deepEqual(miss.seen, [false]);
});

test("nor does a newer click's navigation or focus move credit an older one", () => {
  const b = fakeBrowser();
  const judge = createClickJudge(b.env);
  const miss = verdicts();
  press(judge, card, miss.done);
  b.advance(300);
  press(judge, button);
  b.state.href = "https://site.test/next";
  b.state.active = button;
  b.advance(700);
  assert.deepEqual(miss.seen, [false]);
});

test("an older click still gains credit from changes inside its own component", () => {
  const b = fakeBrowser();
  const judge = createClickJudge(b.env);
  const slow = verdicts();
  press(judge, card, slow.done);
  b.advance(300);
  press(judge, button); // something else is clicked meanwhile
  b.mutate(added(card, "DIV")); // the card's own content arrives
  assert.deepEqual(slow.seen, [true]);
});

test("repeat clicks on the same element share the credit", () => {
  const b = fakeBrowser();
  const judge = createClickJudge(b.env);
  const first = verdicts();
  const second = verdicts();
  press(judge, card, first.done);
  b.advance(200);
  press(judge, card, second.done);
  b.mutate(added(list, "LI")); // a slow handler answers — which click, can't tell
  assert.deepEqual([first.seen, second.seen], [[true], [true]]);
});

test("a keyboard or scripted click is a new interaction too", () => {
  const b = fakeBrowser();
  const judge = createClickJudge(b.env);
  const miss = verdicts();
  press(judge, bar, miss.done);
  judge.begin(button, "click"); // Enter on the focused button: no press
  judge.release();
  b.mutate(added(list, "LI"));
  b.advance(1000);
  assert.deepEqual(miss.seen, [false]);
});

test("ambient text and animation inside a page-sized target don't count", () => {
  const b = fakeBrowser();
  const judge = createClickJudge(b.env);
  const v = verdicts();
  press(judge, body, v.done); // a click on the page background
  b.mutate(text(clock), attr(card, "style"));
  b.advance(1000);
  assert.deepEqual(v.seen, [false]);
  assert.equal(isMeaningfulMutation(text(clock), body, false), false);
  assert.equal(isMeaningfulMutation(added(body, "DIV"), body, false), true);
});

test("rapid clicks are judged independently", () => {
  const b = fakeBrowser();
  const judge = createClickJudge(b.env);
  const early = verdicts();
  const late = verdicts();
  judge.judge(card, early.done);
  b.advance(600);
  judge.judge(card, late.done);
  b.advance(400);
  assert.deepEqual([early.seen, late.seen], [[false], []]);
  b.mutate(added(body, "DIV"));
  assert.deepEqual(late.seen, [true]);
});

test("ambient animation and ticking text elsewhere don't mask a dead click", () => {
  assert.equal(isMeaningfulMutation(attr(drawer, "style"), card), false);
  assert.equal(isMeaningfulMutation(text(clock), card), false);
  // …but the same kinds of change inside the clicked element do count.
  assert.equal(isMeaningfulMutation(attr(card, "style"), card), true);
  assert.equal(isMeaningfulMutation(text(cardText), card), true);
});

test("structure and state attributes count wherever they change", () => {
  assert.equal(isMeaningfulMutation(added(body, "DIV"), card), true);
  assert.equal(isMeaningfulMutation(added(body, "#text"), card), true);
  assert.equal(isMeaningfulMutation(attr(drawer, "class"), card), true);
  assert.equal(isMeaningfulMutation(attr(drawer, "data-state"), card), true);
  assert.equal(isMeaningfulMutation(attr(drawer, "aria-expanded"), null), true);
});

test("nodes that render nothing don't count", () => {
  assert.equal(isMeaningfulMutation(added(body, "SCRIPT", "style", "#comment"), card), false);
  assert.equal(isMeaningfulMutation(added(body, "LINK", "DIV"), card), true);
  assert.equal(isMeaningfulMutation({ type: "childList", target: body }, card), false);
});
