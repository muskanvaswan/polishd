/**
 * Tests for judging a click by its outcome.
 *
 * Run with `npm test`. No DOM: the judge sees the browser only through
 * `JudgeEnv`, so the clock, the URL, focus and mutation delivery are all fakes
 * driven by hand. Two families of case matter. The false alarms that started
 * this — a backdrop that closes its drawer, a layer that dismisses itself on
 * press — must read as clicks. And the page's own activity — a ticking clock,
 * a carousel, a streaming feed, the next click — must never make a genuinely
 * dead click read as one.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CHURN_BASELINE_MS,
  createClickJudge,
  type ClickJudge,
  type JudgeEnv,
  type MutationLike,
  type NodeLike,
} from "./click-outcome.ts";

interface FakeNode extends NodeLike {
  parentNode: FakeNode | null;
  children: FakeNode[];
  /** Covers too much of the screen to be a component. */
  big: boolean;
  role?: string;
  /** Part of polishd's own UI. */
  own: boolean;
}

/** Just enough selector matching for OVERLAY_SELECTOR: tag names and `[role="…"]`. */
const matchesSelector = (n: FakeNode, selector: string) =>
  selector.split(",").some((part) => {
    const role = /^\[role="([^"]+)"\]$/.exec(part);
    return role ? n.role === role[1] : part.toUpperCase() === n.nodeName;
  });

const node = (
  nodeName: string,
  parentNode: FakeNode | null = null,
  { big = false, role, own = false }: { big?: boolean; role?: string; own?: boolean } = {},
): FakeNode => {
  const self: FakeNode = {
    nodeName,
    nodeType: nodeName.startsWith("#") ? 3 : 1,
    parentNode,
    children: [],
    big,
    role,
    own,
    contains(other: unknown) {
      for (let n = other as FakeNode | null; n; n = n.parentNode) if (n === self) return true;
      return false;
    },
    matches: (selector: string) => matchesSelector(self, selector),
    querySelector(selector: string) {
      const stack = [...self.children];
      while (stack.length) {
        const n = stack.pop() as FakeNode;
        if (matchesSelector(n, selector)) return n;
        stack.push(...n.children);
      }
      return null;
    },
  };
  parentNode?.children.push(self);
  return self;
};

// A page: a full-screen drawer whose backdrop closes it, a card, a clock, a
// carousel and a feed that change on their own, and the report's row whose
// only control is a small button.
const html = node("HTML", null, { big: true });
const body = node("BODY", html, { big: true });
const drawer = node("DIV", body, { big: true });
const backdrop = node("DIV", drawer, { big: true });
const card = node("DIV", body);
const cardText = node("#text", card);
const clock = node("SPAN", body);
const clockText = node("#text", clock);
const carouselSlide = node("DIV", node("DIV", body));
const feed = node("UL", body);
const bar = node("DIV", body);
const button = node("BUTTON", bar);
const buttonText = node("#text", button);
const list = node("UL", body);
const panel = node("DIV", body);

/** A browser with a hand-cranked clock. */
function fakeBrowser() {
  let now = 0;
  let nextId = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let deliver: ((records: readonly MutationLike[]) => void) | null = null;
  const state = { href: "https://site.test/a", active: body as unknown };

  const env: JudgeEnv = {
    now: () => now,
    href: () => state.href,
    activeElement: () => state.active,
    isComponentSized: (n) => !(n as FakeNode).big,
    isOwn(n) {
      for (let x = n as FakeNode | null; x; x = x.parentNode) if (x.own) return true;
      return false;
    },
    observe(onRecords) {
      deliver = onRecords;
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
      const end = now + ms;
      for (;;) {
        const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        now = due[1].at;
        timers.delete(due[0]);
        due[1].fn();
      }
      now = end;
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

const added = (target: FakeNode, ...nodes: FakeNode[]): MutationLike => ({
  type: "childList",
  target,
  addedNodes: nodes,
});
const removed = (target: FakeNode, ...nodes: FakeNode[]): MutationLike => ({
  type: "childList",
  target,
  removedNodes: nodes,
});
const attr = (target: FakeNode, attributeName: string): MutationLike => ({
  type: "attributes",
  target,
  attributeName,
});
const text = (target: FakeNode): MutationLike => ({ type: "characterData", target });
const el = (name = "DIV", opts?: Parameters<typeof node>[2]) => node(name, null, opts);

/** A click as the capture layer reports it: press, then click. A control is released, not judged. */
const click = (judge: ClickJudge, target: FakeNode, done?: (worked: boolean) => void) => {
  judge.begin(target, "press");
  if (done) judge.arm(target);
  judge.begin(target, "click");
  if (done) judge.judge(target, done);
  else judge.release();
};

/** Let the page tick on its own: `mutations` every second for `seconds`. */
const runIdle = (
  b: ReturnType<typeof fakeBrowser>,
  seconds: number,
  mutations: () => MutationLike | MutationLike[],
) => {
  for (let i = 0; i < seconds; i++) {
    b.mutate(...[mutations()].flat());
    b.advance(1000);
  }
};

// ---- the basics ---------------------------------------------------------------

test("a click after which nothing happens is dead — after the hold, not before", () => {
  const b = fakeBrowser();
  const judge = createClickJudge(b.env, { holdMs: 1000 });
  const v = verdicts();
  click(judge, card, v.done);
  b.advance(999);
  assert.deepEqual(v.seen, []);
  b.advance(1);
  assert.deepEqual(v.seen, [false]);
  assert.equal(judge.pending(), 0);
});

test("a full-screen backdrop that closes its drawer worked, at once", () => {
  const b = fakeBrowser();
  const judge = createClickJudge(b.env);
  const v = verdicts();
  click(judge, backdrop, v.done);
  b.mutate(attr(drawer, "aria-hidden")); // state, outside the (page-sized) target
  assert.deepEqual(v.seen, [true]);
  b.advance(5000);
  assert.deepEqual(v.seen, [true], "settles exactly once");
});

test("a URL change or a focus move during the hold counts as a response", () => {
  const b = fakeBrowser();
  const judge = createClickJudge(b.env);
  const url = verdicts();
  click(judge, card, url.done);
  b.state.href = "https://site.test/b";
  b.advance(1000);
  assert.deepEqual(url.seen, [true]);

  const focus = verdicts();
  click(judge, card, focus.done);
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
  // A layer that dismisses on pointerdown is gone before the click fires,
  // and the click then lands on the body underneath.
  judge.begin(backdrop, "press");
  judge.arm(backdrop);
  b.mutate(removed(body, el()));
  judge.begin(body, "click");
  judge.judge(body, v.done);
  assert.deepEqual(v.seen, [true]);
});

// ---- the page's own activity ----------------------------------------------------

test("a clock ticking elsewhere on the page never makes a dead click a click", () => {
  const b = fakeBrowser();
  const judge = createClickJudge(b.env);
  // The clock re-renders as a new element every second, and its text too.
  const tick = () => added(clock, el("SPAN"));
  runIdle(b, 4, tick);
  const v = verdicts();
  click(judge, card, v.done);
  b.mutate(tick(), text(clockText));
  b.advance(500);
  b.mutate(tick());
  b.advance(500);
  assert.deepEqual(v.seen, [false]);
});

test("an autoplaying carousel or a streaming feed doesn't either", () => {
  const b = fakeBrowser();
  const judge = createClickJudge(b.env);
  // State attribute churn and structural churn, side by side.
  runIdle(b, 3, () => [attr(carouselSlide, "data-state"), added(feed, el("LI"))]);
  const v = verdicts();
  click(judge, card, v.done);
  b.mutate(attr(carouselSlide, "data-state"), attr(carouselSlide, "class"), added(feed, el("LI")));
  b.advance(1000);
  assert.deepEqual(v.seen, [false]);
});

test("a change made once at load doesn't make a node background", () => {
  const b = fakeBrowser();
  const judge = createClickJudge(b.env);
  b.mutate(added(panel, el()), added(panel, el())); // streamed in, one burst
  b.advance(1000);
  const v = verdicts();
  click(judge, card, v.done);
  b.mutate(added(panel, el()));
  assert.deepEqual(v.seen, [true]);
});

test("churn keeps being counted while the visitor clicks around", () => {
  const b = fakeBrowser();
  const judge = createClickJudge(b.env);
  // A clock re-rendering every 300ms, and someone clicking real buttons every
  // 400ms the whole time — the page is never idle.
  for (let t = 0; t < 3000; t += 100) {
    if (t % 300 === 0) b.mutate(added(clock, el("SPAN")));
    if (t % 400 === 0) click(judge, button);
    b.advance(100);
  }
  const v = verdicts();
  click(judge, card, v.done);
  b.mutate(added(clock, el("SPAN")));
  b.advance(300);
  b.mutate(added(clock, el("SPAN")));
  b.advance(700);
  assert.deepEqual(v.seen, [false]);
});

test("a panel a button toggled twice is still a response the third time", () => {
  const b = fakeBrowser();
  const judge = createClickJudge(b.env);
  click(judge, button);
  b.mutate(attr(panel, "hidden"));
  b.advance(1500);
  click(judge, button);
  b.mutate(attr(panel, "hidden"));
  b.advance(1500);
  const v = verdicts();
  click(judge, card, v.done); // the third toggle, from a plain div
  b.mutate(attr(panel, "hidden"));
  assert.deepEqual(v.seen, [true]);
});

test("what a judged click caused never counts as churn", () => {
  const b = fakeBrowser();
  const judge = createClickJudge(b.env);
  // A slideshow image with a plain listener: every click advances the slide.
  const seen: boolean[] = [];
  for (let i = 0; i < 5; i++) {
    click(judge, card, (worked) => seen.push(worked));
    b.mutate(added(list, el("LI")));
    b.advance(600);
  }
  assert.deepEqual(seen, [true, true, true, true, true]);
});

test("churn is per kind of change: a panel's animation doesn't make its state background", () => {
  const b = fakeBrowser();
  const judge = createClickJudge(b.env);
  runIdle(b, 4, () => attr(panel, "style")); // a JS animation on the panel
  const v = verdicts();
  click(judge, card, v.done);
  b.mutate(attr(panel, "hidden")); // the click closes it
  assert.deepEqual(v.seen, [true]);
});

test("churn older than the baseline is forgotten", () => {
  const b = fakeBrowser();
  const judge = createClickJudge(b.env);
  runIdle(b, 3, () => added(feed, el("LI")));
  b.advance(CHURN_BASELINE_MS + 1);
  const v = verdicts();
  click(judge, card, v.done);
  b.mutate(added(feed, el("LI")));
  assert.deepEqual(v.seen, [true]);
});

test("an overlay opening counts even inside a churning container", () => {
  const b = fakeBrowser();
  const judge = createClickJudge(b.env);
  runIdle(b, 3, () => added(body, el("IMG"))); // a pixel appended now and then
  const v = verdicts();
  click(judge, card, v.done);
  const portal = el("DIV");
  node("DIV", portal, { role: "dialog" });
  b.mutate(added(body, portal));
  assert.deepEqual(v.seen, [true]);

  const native = verdicts();
  click(judge, card, native.done);
  b.mutate(attr(node("DIALOG", body), "open"));
  assert.deepEqual(native.seen, [true]);
});

test("polishd's own UI appearing or changing is never a response", () => {
  const b = fakeBrowser();
  const judge = createClickJudge(b.env);
  const v = verdicts();
  click(judge, card, v.done);
  const consent = el("DIV", { role: "dialog", own: true });
  b.mutate(added(body, consent), attr(node("BUTTON", consent), "disabled"), removed(body, consent));
  b.advance(1000);
  assert.deepEqual(v.seen, [false]);
});

// ---- what counts, where ---------------------------------------------------------

test("inside a component-sized target, anything counts; elsewhere, only structure and state", () => {
  const cases: Array<[string, MutationLike, boolean]> = [
    ["class on the card", attr(card, "class"), true],
    ["style on the card", attr(card, "style"), true],
    ["text in the card", text(cardText), true],
    ["text node swapped in the card", added(card, node("#text")), true],
    ["class on the button's row (an ancestor)", attr(bar, "class"), true],
    ["style on an ancestor", attr(bar, "style"), false],
    ["element added elsewhere", added(list, el("LI")), true],
    ["aria-expanded elsewhere", attr(panel, "aria-expanded"), true],
    ["class elsewhere", attr(panel, "class"), false],
    ["style elsewhere", attr(panel, "style"), false],
    ["text elsewhere", text(clockText), false],
    ["text node swapped elsewhere", added(clock, node("#text")), false],
    ["a script, a style, a comment added", added(body, el("SCRIPT"), el("STYLE"), node("#comment")), false],
  ];
  for (const [name, mutation, expected] of cases) {
    const b = fakeBrowser();
    const judge = createClickJudge(b.env);
    const v = verdicts();
    const target = name.includes("ancestor") ? button : card;
    // A plain span inside the button's row stands in when judging the row.
    const subject = target === button ? node("SPAN", bar) : card;
    click(judge, subject, v.done);
    b.mutate(mutation);
    b.advance(1000);
    assert.deepEqual(v.seen, [expected], name);
  }
});

test("inside a page-sized target, text and animation don't count", () => {
  const b = fakeBrowser();
  const judge = createClickJudge(b.env);
  const v = verdicts();
  click(judge, body, v.done); // a click on the page background
  b.mutate(text(clockText), attr(card, "style"), attr(card, "class"));
  b.advance(1000);
  assert.deepEqual(v.seen, [false]);
});

// ---- the newest interaction takes the credit ----------------------------------------

test("a miss beside a button stays dead when the visitor then clicks the button", () => {
  const b = fakeBrowser();
  const judge = createClickJudge(b.env);
  const miss = verdicts();
  click(judge, bar, miss.done); // nothing happens…
  b.advance(400);
  click(judge, button); // …so the visitor clicks the button itself, which works:
  b.mutate(text(buttonText), added(list, el("LI"), el("LI"))); // its label flips, the list opens
  b.advance(600);
  assert.deepEqual(miss.seen, [false]);
});

test("a newer click's navigation or focus move doesn't credit an older one", () => {
  const b = fakeBrowser();
  const judge = createClickJudge(b.env);
  const miss = verdicts();
  click(judge, card, miss.done);
  b.advance(300);
  click(judge, button);
  b.state.href = "https://site.test/next";
  b.state.active = button;
  b.advance(700);
  assert.deepEqual(miss.seen, [false]);
});

test("an older click still gains credit from changes inside its own component", () => {
  const b = fakeBrowser();
  const judge = createClickJudge(b.env);
  const slow = verdicts();
  click(judge, card, slow.done);
  b.advance(300);
  click(judge, button); // something else is clicked meanwhile
  b.mutate(added(card, el())); // the card's own content arrives
  assert.deepEqual(slow.seen, [true]);
});

test("repeat clicks on the same element share the credit", () => {
  const b = fakeBrowser();
  const judge = createClickJudge(b.env);
  const first = verdicts();
  const second = verdicts();
  click(judge, card, first.done);
  b.advance(200);
  click(judge, card, second.done);
  b.mutate(added(list, el("LI"))); // a slow handler answers — which click, can't tell
  assert.deepEqual([first.seen, second.seen], [[true], [true]]);
});

test("typing, a keyboard click or a scroll is a newer interaction too", () => {
  for (const next of ["keyboard click", "keydown", "scroll"] as const) {
    const b = fakeBrowser();
    const judge = createClickJudge(b.env);
    const miss = verdicts();
    click(judge, bar, miss.done);
    b.advance(200);
    if (next === "keyboard click") {
      judge.begin(button, "click"); // Enter on the focused button: no press
      judge.release();
    } else {
      judge.interact();
    }
    // Search results update, content is revealed on scroll.
    b.mutate(added(list, el("LI")), attr(panel, "data-state"));
    b.advance(1000);
    assert.deepEqual(miss.seen, [false], next);
  }
});

test("a tap's touchmove jitter belongs to that tap", () => {
  const b = fakeBrowser();
  const judge = createClickJudge(b.env);
  const v = verdicts();
  judge.begin(card, "press");
  judge.arm(card);
  judge.interact(); // touchmove between press and click
  judge.begin(card, "click");
  judge.judge(card, v.done);
  b.mutate(added(list, el("LI")));
  assert.deepEqual(v.seen, [true]);
});

// ---- lifecycle ----------------------------------------------------------------------

test("a press released to a control, cancelled, or never clicked emits nothing", () => {
  const b = fakeBrowser();
  const judge = createClickJudge(b.env, { armMs: 3000 });
  judge.begin(card, "press");
  judge.arm(card);
  judge.release(); // pointercancel, or the click went to a control
  assert.equal(judge.pending(), 0);

  judge.begin(card, "press");
  judge.arm(card);
  judge.begin(backdrop, "press"); // a new press drops the one that never clicked
  judge.arm(backdrop);
  assert.equal(judge.pending(), 1);
  b.advance(3000); // and a press that never clicks expires
  assert.equal(judge.pending(), 0);
});

test("settleAll resolves every pending click as working, synchronously", () => {
  const b = fakeBrowser();
  const judge = createClickJudge(b.env);
  const first = verdicts();
  const second = verdicts();
  click(judge, card, first.done);
  click(judge, bar, second.done);
  judge.begin(card, "press");
  judge.arm(card); // a press with no click yet: nothing to emit
  judge.settleAll(); // pagehide: these must exist before the beacon flush
  assert.deepEqual([first.seen, second.seen], [[true], [true]]);
  assert.equal(judge.pending(), 0);
  b.advance(5000);
  assert.deepEqual([first.seen, second.seen], [[true], [true]]);
});
