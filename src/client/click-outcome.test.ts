/**
 * Tests for judging a click by its outcome.
 *
 * Run with `npm test`. No DOM: the judge sees the browser only through
 * `JudgeEnv`, so the clock, the URL, focus, layout and mutation delivery are
 * all fakes driven by hand. Two families of case matter. The false alarms that
 * started this — a backdrop that closes its drawer, a layer that dismisses
 * itself on press — must read as clicks. And the page's own activity — a
 * carousel, a polling spinner, a chat stream, a hover card, the next click —
 * must never make a genuinely dead click read as one.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BACKGROUND_MS,
  createClickJudge,
  type ClickJudge,
  type JudgeEnv,
  type MutationLike,
  type NodeLike,
  type Point,
} from "./click-outcome.ts";

interface FakeNode extends NodeLike {
  parentNode: FakeNode | null;
  children: FakeNode[];
  /** Covers too much of the screen to be a component. */
  big: boolean;
  role?: string;
  /** Part of polishd's own UI. */
  own: boolean;
  /** Where it is on screen, if anywhere. */
  rect?: { left: number; top: number; right: number; bottom: number };
  /** Its first class, for the kind of child it is. */
  cls?: string;
  /** Not rendered (display: none, `hidden`). */
  hidden?: boolean;
  /** Rendered but unseen: `opacity: 0` or `visibility: hidden`. */
  faded?: boolean;
  /** Carries a React click handler. */
  handler?: boolean;
}

/** Every fake node, for the "visible surfaces" query. */
const allNodes: FakeNode[] = [];

/** Just enough selector matching for the judge's selectors: tag names and `[role="…"]`. */
const matchesSelector = (n: FakeNode, selector: string) =>
  selector.split(",").some((part) => {
    const role = /^\[role="([^"]+)"\]$/.exec(part);
    return role ? n.role === role[1] : part.toUpperCase() === n.nodeName;
  });

const node = (
  nodeName: string,
  parentNode: FakeNode | null = null,
  opts: {
    big?: boolean;
    role?: string;
    own?: boolean;
    rect?: FakeNode["rect"];
    cls?: string;
    hidden?: boolean;
    faded?: boolean;
    handler?: boolean;
  } = {},
): FakeNode => {
  const self: FakeNode = {
    nodeName,
    nodeType: nodeName.startsWith("#") ? 3 : 1,
    parentNode,
    children: [],
    big: opts.big ?? false,
    role: opts.role,
    own: opts.own ?? false,
    rect: opts.rect,
    cls: opts.cls,
    hidden: opts.hidden,
    faded: opts.faded,
    handler: opts.handler,
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
  allNodes.push(self);
  return self;
};

// The page. Rects only where layout matters (the click point).
const html = node("HTML", null, { big: true });
const body = node("BODY", html, { big: true });
const drawer = node("DIV", body, { big: true }); // fixed inset-0 wrapper
const backdrop = node("DIV", drawer, { big: true });
const main = node("MAIN", body, { big: true });
const card = node("DIV", main, { rect: { left: 0, top: 0, right: 300, bottom: 200 } });
const cardText = node("#text", card);
const bar = node("DIV", main);
const button = node("BUTTON", bar);
const buttonText = node("#text", button);
const table = node("TBODY", main);
const row = node("TR", table);
const cell = node("TD", row);
const carousel = node("DIV", main);
const slide = node("DIV", carousel);
const slideImage = node("IMG", slide);
const chat = node("UL", main);
const panel = node("DIV", main);
const toaster = node("SECTION", body);
const spinnerBox = node("DIV", main, { rect: { left: 0, top: 0, right: 300, bottom: 200 } });

/** A browser with a hand-cranked clock. */
function fakeBrowser() {
  let now = 0;
  let nextId = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let deliver: ((records: readonly MutationLike[]) => void) | null = null;
  const state = { href: "https://site.test/a", active: body as unknown };
  let layoutReads = 0;
  const ownedBy = (n: FakeNode | null, test: (x: FakeNode) => boolean) => {
    for (let x = n; x; x = x.parentNode) if (test(x)) return x;
    return null;
  };

  const env: JudgeEnv = {
    now: () => now,
    href: () => state.href,
    activeElement: () => state.active,
    isComponentSized: (n) => {
      layoutReads++;
      return !(n as FakeNode).big;
    },
    isVisible: (n) => {
      layoutReads++;
      return !ownedBy(n as FakeNode, (x) => !!x.hidden);
    },
    isShown: (n) => {
      layoutReads++;
      return !ownedBy(n as FakeNode, (x) => !!x.hidden || !!x.faded);
    },
    // A fake's rect stands for both its live box and the one remembered at
    // the click, so a node hidden since still has its place; else its parent's.
    rectOf(n) {
      layoutReads++;
      const el = ownedBy(n as FakeNode, (x) => x.nodeType === 1);
      return el?.rect ?? el?.parentNode?.rect ?? null;
    },
    remember() {},
    handlerOf(n) {
      let x = (n as FakeNode).parentNode?.parentNode ?? null;
      for (let depth = 2; x && depth < 4; depth++, x = x.parentNode) if (x.handler) return x;
      return null;
    },
    visibleSurfaces: () =>
      allNodes.filter((n) => n.role === "dialog" && !ownedBy(n, (x) => !!x.hidden || !!x.faded)),
    kindOf: (n) => (n as FakeNode).nodeName + ((n as FakeNode).cls ? `.${(n as FakeNode).cls}` : ""),
    isOwn: (n) => !!ownedBy(n as FakeNode, (x) => x.own),
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
    layoutReads: () => layoutReads,
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

const CENTER: Point = { x: 150, y: 100 };

/** A click as the capture layer reports it: press, then click. A control is released, not judged. */
const click = (
  judge: ClickJudge,
  target: FakeNode,
  done?: (worked: boolean) => void,
  point: Point | null = CENTER,
) => {
  judge.begin(target, "press");
  if (done) judge.arm(target, point);
  judge.begin(target, "click");
  if (done) judge.judge(target, done, point);
  else judge.release();
};

/** The page changing on its own, with nobody interacting: `mutations` every `everyMs`. */
const ambient = (
  b: ReturnType<typeof fakeBrowser>,
  forMs: number,
  everyMs: number,
  mutations: () => MutationLike | MutationLike[],
) => {
  for (let t = 0; t < forMs; t += everyMs) {
    b.mutate(...[mutations()].flat());
    b.advance(everyMs);
  }
};

/** Judge one click on `target` after `setup`, deliver `during`, and return the verdict. */
const verdictAfter = (
  setup: (b: ReturnType<typeof fakeBrowser>, judge: ClickJudge) => void,
  target: FakeNode,
  during: MutationLike[] | (() => MutationLike[]),
  point: Point | null = CENTER,
): boolean | undefined => {
  const b = fakeBrowser();
  const judge = createClickJudge(b.env);
  setup(b, judge);
  const v = verdicts();
  click(judge, target, v.done, point);
  // A function runs after the click: for changes that flip state on the page.
  b.mutate(...(typeof during === "function" ? during() : during));
  b.advance(1000);
  return v.seen[0];
};
const idle = () => {};

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
  b.mutate(attr(drawer, "aria-hidden")); // an ancestor's state
  assert.deepEqual(v.seen, [true]);
  b.advance(5000);
  assert.deepEqual(v.seen, [true], "settles exactly once");
});

test("…even when a button opened that drawer three seconds earlier", () => {
  const worked = verdictAfter(
    (b, judge) => {
      click(judge, button); // the open button, a real control
      b.mutate(attr(drawer, "aria-hidden"), attr(drawer, "class"));
      b.advance(3000);
    },
    backdrop,
    [attr(drawer, "aria-hidden")],
  );
  assert.equal(worked, true);
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
  judge.arm(card, CENTER);
  b.state.active = body; // …and pressing a plain div blurred it
  judge.begin(card, "click");
  judge.judge(card, v.done, CENTER);
  b.advance(1000);
  assert.deepEqual(v.seen, [false]);
});

test("a layer that dismisses itself on press worked, though the click lands elsewhere", () => {
  const b = fakeBrowser();
  const judge = createClickJudge(b.env);
  const overlay = node("DIV", body, { big: true });
  const v = verdicts();
  judge.begin(overlay, "press");
  judge.arm(overlay, CENTER);
  b.mutate(removed(body, overlay)); // gone before the click fires…
  judge.begin(body, "click");
  judge.judge(body, v.done, CENTER); // …which lands on the body underneath
  assert.deepEqual(v.seen, [true]);
});

// ---- what's related to the click ------------------------------------------------

test("related changes count: inside the target, on an ancestor, under the click point", () => {
  const cases: Array<[string, FakeNode, MutationLike, boolean]> = [
    ["class on the card", card, attr(card, "class"), true],
    ["style on the card", card, attr(card, "style"), true],
    ["text in the card", card, text(cardText), true],
    ["content added to the card", card, added(card, el()), true],
    ["a row expanding below the clicked cell", cell, added(table, el("TR")), true],
    ["details revealed right below the click", node("SPAN", main), attr(node("DIV", main, { rect: { left: 0, top: 140, right: 300, bottom: 500 } }), "hidden"), true],
    ["the same, too far below", node("SPAN", main), attr(node("DIV", main, { rect: { left: 0, top: 400, right: 300, bottom: 500 } }), "hidden"), false],
    ["state on the row (an ancestor)", cell, attr(row, "aria-expanded"), true],
    ["style on an ancestor", cell, attr(row, "style"), false],
    ["a portal appended to the page", card, added(body, el()), false],
    ["something removed from the page", card, removed(body, el()), true],
    ["an image swapped under the click point", node("SPAN", main), added(spinnerBox, el("IMG")), true],
    ["the same, away from the click point", node("SPAN", main), added(panel, el("IMG")), false],
    ["state elsewhere", card, attr(panel, "aria-expanded"), false],
    ["class elsewhere", card, attr(panel, "class"), false],
    ["content elsewhere", card, added(panel, el()), false],
    ["text elsewhere", card, text(node("#text", panel)), false],
    ["a script, a style, a comment in the card", card, added(card, el("SCRIPT"), el("STYLE"), node("#comment")), false],
  ];
  for (const [name, target, mutation, expected] of cases) {
    assert.equal(verdictAfter(idle, target, [mutation]), expected, name);
  }
});

test("inside a page-sized target, only something closing counts", () => {
  assert.equal(verdictAfter(idle, body, [text(node("#text", panel)), attr(card, "style")]), false);
  assert.equal(verdictAfter(idle, body, [added(body, el())]), false, "a portal opening");
  assert.equal(verdictAfter(idle, body, [removed(body, el())]), true, "a layer closing");
});

test("a dialog, menu or listbox opening anywhere counts", () => {
  for (const role of ["dialog", "menu", "listbox"]) {
    const portal = el();
    node("DIV", portal, { role });
    assert.equal(verdictAfter(idle, card, [added(body, portal)]), true, role);
  }
  assert.equal(verdictAfter(idle, card, [attr(node("DIALOG", body), "open")]), true, "<dialog open>");
});

test("a toast counts within 300ms in a quiet container, or under the click point", () => {
  const toast = () => el("LI", { role: "status" });
  const b = fakeBrowser();
  const judge = createClickJudge(b.env);
  const quick = verdicts();
  click(judge, card, quick.done);
  b.advance(200);
  b.mutate(added(toaster, toast()));
  assert.deepEqual(quick.seen, [true]);

  const late = verdicts();
  click(judge, card, late.done);
  b.advance(400);
  b.mutate(added(toaster, toast()));
  b.advance(600);
  assert.deepEqual(late.seen, [false], "too late, and not beside the click");

  assert.equal(verdictAfter(idle, card, [added(card, toast())]), true, "inside the target");
});

test("polishd's own UI appearing or changing is never a response", () => {
  const consent = el("DIV", { role: "dialog", own: true });
  assert.equal(
    verdictAfter(idle, card, [added(body, consent), attr(node("BUTTON", consent), "disabled"), removed(body, consent)]),
    false,
  );
});

// ---- the page's own activity (the reviewer's probes) ---------------------------------

test("probe (a): a carousel rotating aria-hidden every 5s doesn't make a dead click a click", () => {
  const worked = verdictAfter(
    (b) => ambient(b, 12_000, 5000, () => attr(slide, "aria-hidden")),
    slideImage, // a dead click on the slide's image; the slide is its ancestor
    [attr(slide, "aria-hidden")],
  );
  assert.equal(worked, false);
});

test("probe (b): a polling spinner re-adding role=status every second doesn't either", () => {
  const spin = () => added(spinnerBox, el("DIV", { role: "status" }));
  // Beside the click (under the point) and elsewhere.
  assert.equal(verdictAfter((b) => ambient(b, 4000, 1000, spin), card, [spin()]), false);
  assert.equal(verdictAfter((b) => ambient(b, 4000, 1000, spin), node("SPAN", main), [spin()]), false);
});

test("probe (c): a chat stream appending during the hold doesn't either", () => {
  const message = () => added(chat, el("LI"));
  assert.equal(verdictAfter((b) => ambient(b, 8000, 4000, message), card, [message()]), false);
  // Even its first message ever, and even for a click on the page itself.
  assert.equal(verdictAfter(idle, card, [message()]), false);
  assert.equal(verdictAfter(idle, body, [message()]), false);
});

test("probe (d): a hover card or menu shown as the pointer moves on doesn't either", () => {
  for (const role of [undefined, "menu"]) {
    const b = fakeBrowser();
    const judge = createClickJudge(b.env);
    const v = verdicts();
    click(judge, card, v.done);
    b.advance(150);
    const trigger = node("A", main); // the pointer moves onto a link…
    judge.hover(trigger);
    b.mutate(attr(trigger, "data-state")); // …which restyles itself
    b.advance(500); // and after the hover delay its card opens
    // Opening right beside the click point — a portal, appended to the page.
    const hoverCard = el("DIV", { rect: { left: 0, top: 210, right: 300, bottom: 300 } });
    node("DIV", hoverCard, { role });
    b.mutate(added(body, hoverCard));
    b.advance(400);
    assert.deepEqual(v.seen, [false], `hover card (role ${role ?? "none"})`);
  }
});

test("moving within the clicked element, or onto its container, isn't hover elsewhere", () => {
  const b = fakeBrowser();
  const judge = createClickJudge(b.env);
  const v = verdicts();
  click(judge, card, v.done);
  judge.hover(cardText);
  judge.hover(main);
  b.advance(500);
  b.mutate(added(card, el()));
  assert.deepEqual(v.seen, [true]);
});

test("a click's own dialog still counts when the pointer moves on right away", () => {
  const b = fakeBrowser();
  const judge = createClickJudge(b.env);
  const v = verdicts();
  click(judge, card, v.done);
  judge.hover(node("A", main));
  b.advance(100);
  const portal = el();
  node("DIV", portal, { role: "dialog" });
  b.mutate(added(body, portal));
  assert.deepEqual(v.seen, [true]);
});

test("background takes two separate changes in the ten seconds before", () => {
  // Page script collapsing the panels once, three seconds before a click that
  // opens one, is not churn.
  const once = (b: ReturnType<typeof fakeBrowser>) => {
    b.mutate(attr(row, "aria-expanded"));
    b.advance(3000);
  };
  assert.equal(verdictAfter(once, cell, [attr(row, "aria-expanded")]), true);
  // Twice is: something keeps doing this.
  const twice = (b: ReturnType<typeof fakeBrowser>) => {
    b.mutate(attr(row, "aria-expanded"));
    b.advance(4000);
    b.mutate(attr(row, "aria-expanded"));
    b.advance(4000);
  };
  assert.equal(verdictAfter(twice, cell, [attr(row, "aria-expanded")]), false);
  // One instant is one change, however many records it took.
  const batch = (b: ReturnType<typeof fakeBrowser>) => {
    b.mutate(attr(row, "aria-expanded"), attr(row, "aria-expanded"), attr(row, "aria-expanded"));
    b.advance(3000);
  };
  assert.equal(verdictAfter(batch, cell, [attr(row, "aria-expanded")]), true);
  const longAgo = (b: ReturnType<typeof fakeBrowser>) => {
    twice(b);
    b.advance(BACKGROUND_MS + 1);
  };
  assert.equal(verdictAfter(longAgo, cell, [attr(row, "aria-expanded")]), true, "forgotten after ten");
});

test("residual: a carousel turning once every 6s is too slow to be background", () => {
  const worked = verdictAfter(
    (b) => ambient(b, 12_000, 6000, () => attr(slide, "aria-hidden")),
    slideImage,
    [attr(slide, "aria-hidden")],
  );
  // One change in the ten seconds before: not enough to call it background,
  // so its next turn credits a dead click on it (the safe direction).
  assert.equal(worked, true);
});

test("the clicked element's own changes always count, busy or not", () => {
  const hoverAnimation = (b: ReturnType<typeof fakeBrowser>) => ambient(b, 3000, 100, () => attr(card, "style"));
  assert.equal(verdictAfter(hoverAnimation, card, [attr(card, "aria-expanded")]), true);
  // Documented residual: its hover animation counts too — tier 1 never asks
  // about background, because a working click must never read as dead.
  assert.equal(verdictAfter(hoverAnimation, card, [attr(card, "style")]), true);
});

test("what a judged click caused never counts as background", () => {
  const b = fakeBrowser();
  const judge = createClickJudge(b.env);
  // A slideshow image with a plain listener: every click advances the slide.
  const seen: boolean[] = [];
  for (let i = 0; i < 5; i++) {
    click(judge, slideImage, (worked) => seen.push(worked));
    b.mutate(attr(slide, "data-index"));
    b.advance(2000);
  }
  assert.deepEqual(seen, [true, true, true, true, true]);
});

// ---- final-round probes: clicks that work must read as working ------------------------

test("a dialog that opens late, after the pointer moved on, still counts", () => {
  const b = fakeBrowser();
  const judge = createClickJudge(b.env);
  const v = verdicts();
  click(judge, card, v.done);
  judge.hover(node("A", main)); // the pointer moves away at once…
  b.advance(700); // …and the dialog arrives after a slow fetch, focus untouched
  for (const role of ["dialog"]) {
    const portal = el();
    node("DIV", portal, { role });
    b.mutate(added(body, portal));
  }
  assert.deepEqual(v.seen, [true]);
  for (const surface of [el("DIV", { role: "alertdialog" }), el("DIALOG")]) {
    const late = fakeBrowser();
    const j = createClickJudge(late.env);
    const w = verdicts();
    click(j, card, w.done);
    j.hover(node("A", main));
    late.advance(900);
    late.mutate(added(body, surface));
    assert.deepEqual(w.seen, [true], surface.nodeName + (surface.role ?? ""));
  }
});

test("an accordion directly in <main> expanding below its header counts", () => {
  // The header is a plain div with a listener; the panel is its sibling, and
  // their parent is the page-sized <main>.
  const header = node("DIV", main, { rect: { left: 0, top: 80, right: 900, bottom: 120 } });
  const body = node("DIV", main, { rect: { left: 0, top: 120, right: 900, bottom: 600 } });
  assert.equal(verdictAfter(idle, header, [attr(body, "hidden")]), true, "revealed below");
  assert.equal(verdictAfter(idle, header, [added(body, el("P", { rect: { left: 0, top: 124, right: 900, bottom: 160 } }))]), true);
  const far = node("DIV", main, { rect: { left: 0, top: 700, right: 900, bottom: 800 } });
  assert.equal(verdictAfter(idle, header, [attr(far, "hidden")]), false, "far from the click");
});

test("a modal closing isn't hidden by tooltips that came and went on the page", () => {
  const modal = node("DIV", body, { cls: "modal-root", big: true });
  const overlay = node("DIV", modal, { big: true });
  const worked = verdictAfter(
    (b) => ambient(b, 6000, 2000, () => [added(body, el("DIV", { cls: "tooltip" })), removed(body, el("DIV", { cls: "tooltip" }))]),
    overlay,
    [removed(body, modal)],
  );
  assert.equal(worked, true);
});

test("a modal opened onto a tooltip-busy page still answers clicks inside it", () => {
  const b = fakeBrowser();
  const judge = createClickJudge(b.env);
  ambient(b, 6000, 2000, () => [added(body, el("DIV", { cls: "tooltip" })), removed(body, el("DIV", { cls: "tooltip" }))]);
  // A button opens the modal: appended to the same <body> the tooltips use.
  const modal = node("DIV", null, { cls: "modal-root" });
  const tabs = node("DIV", modal);
  const tab = node("SPAN", tabs);
  click(judge, button);
  b.mutate(added(body, modal));
  b.advance(2000);
  // A plain-div tab inside it swaps the panel.
  const v = verdicts();
  click(judge, tab, v.done);
  b.mutate(added(tabs, el("SECTION")));
  assert.deepEqual(v.seen, [true]);
});

// ---- final-round probes: background the page keeps making -----------------------------

const fadeCarousel = (slides: number) => {
  const deck = node("DIV", main);
  const all = Array.from({ length: slides }, () =>
    node("DIV", deck, { rect: { left: 0, top: 0, right: 300, bottom: 200 } }),
  );
  return { deck, all };
};

for (const slides of [4, 5]) {
  test(`a ${slides}-slide fading carousel is background, though its next slide last moved long ago`, () => {
    const { all } = fadeCarousel(slides);
    // One slide turns every 5s, so each slide's own last change is
    // (slides - 1) × 5s ago — past the ten-second baseline on its own.
    const worked = verdictAfter(
      (b) => {
        for (let t = 0; t < slides * 5000; t += 5000) {
          const i = (t / 5000) % slides;
          b.mutate(attr(all[i], "aria-hidden"), attr(all[(i + 1) % slides], "aria-hidden"));
          b.advance(5000);
        }
      },
      node("SPAN", main),
      [attr(all[0], "aria-hidden"), attr(all[1], "aria-hidden")],
    );
    assert.equal(worked, false);
  });
}

test("residual: a carousel swapping out the very slide clicked credits the click", () => {
  const deck = node("DIV", main);
  const b = fakeBrowser();
  const judge = createClickJudge(b.env);
  let current = node("DIV", deck, { cls: "slide" });
  for (let i = 0; i < 3; i++) {
    const next = node("DIV", deck, { cls: "slide" });
    b.mutate({ type: "childList", target: deck, addedNodes: [next], removedNodes: [current] });
    current = next;
    b.advance(3000);
  }
  const image = node("IMG", current);
  const v = verdicts();
  click(judge, image, v.done);
  b.mutate({ type: "childList", target: deck, addedNodes: [node("DIV", deck, { cls: "slide" })], removedNodes: [current] });
  b.advance(1000);
  // The clicked element was removed: always the click's (accepted residual).
  assert.deepEqual(v.seen, [true]);
});

test("background keeps being learned while the visitor scrolls or types", () => {
  const { all } = fadeCarousel(3);
  const worked = verdictAfter(
    (b, judge) => {
      // Twelve seconds of steady scrolling, the carousel turning every 5s.
      for (let t = 0; t < 12_000; t += 250) {
        judge.interact();
        if (t % 5000 === 0) b.mutate(attr(all[(t / 5000) % 3], "aria-hidden"));
        b.advance(250);
      }
    },
    node("SPAN", main),
    [attr(all[0], "aria-hidden")],
  );
  assert.equal(worked, false);
});

test("typing in the focused element isn't learned as the page's churn", () => {
  const editor = node("DIV", main, { rect: { left: 0, top: 0, right: 300, bottom: 200 } });
  const worked = verdictAfter(
    (b) => {
      b.state.active = editor; // focused, and being typed into
      ambient(b, 3000, 300, () => text(node("#text", editor)));
      b.state.active = body;
    },
    node("SPAN", main), // a plain "clear" control beside it, without a role
    [text(node("#text", editor))],
  );
  assert.equal(worked, true);
});

test("a chat message's paragraphs, appended next to the clicked bubble, are background", () => {
  const thread = node("UL", main);
  const bubble = node("LI", thread, { cls: "msg", rect: { left: 0, top: 0, right: 300, bottom: 200 } });
  const worked = verdictAfter(
    (b) => ambient(b, 8000, 4000, () => added(thread, node("LI", null, { cls: "msg" }))),
    node("SPAN", bubble),
    (() => {
      const message = node("LI", thread, { cls: "msg", rect: { left: 0, top: 205, right: 300, bottom: 260 } });
      return [added(thread, message), added(message, el("P", { rect: { left: 0, top: 205, right: 300, bottom: 230 } }))];
    })(),
  );
  assert.equal(worked, false);
});

// ---- last round: regressions that must read as working -------------------------------

test("regression 1: a list rendered in one batch — card 3 expands a minute later", () => {
  const list = node("UL", main);
  const cards = Array.from({ length: 10 }, () => node("LI", list, { cls: "card" }));
  const b = fakeBrowser();
  const judge = createClickJudge(b.env);
  // One render: ten records in one batch, the same instant.
  b.mutate(...cards.map((c) => added(list, c)));
  // Infinite scroll appends the next page five seconds later.
  b.advance(5000);
  const more = Array.from({ length: 10 }, () => node("LI", list, { cls: "card" }));
  b.mutate(...more.map((c) => added(list, c)));
  b.advance(60_000);
  for (const card of [cards[2], more[3]]) {
    const v = verdicts();
    click(judge, node("DIV", card), v.done); // the card's title
    b.mutate(added(card, el("SECTION"))); // its details open
    b.advance(1000);
    assert.deepEqual(v.seen, [true]);
  }
});

test("regression 1b: …and two seconds after that one render, too", () => {
  const list = node("UL", main);
  const cards = Array.from({ length: 10 }, () => node("LI", list, { cls: "card" }));
  const b = fakeBrowser();
  const judge = createClickJudge(b.env);
  b.mutate(...cards.map((c) => added(list, c))); // one batch: not background to itself
  b.advance(2000);
  const v = verdicts();
  click(judge, node("DIV", cards[2]), v.done);
  b.mutate(added(cards[2], el("SECTION")));
  assert.deepEqual(v.seen, [true]);
});

test("infinite scroll: a card appended to a busy grid expands like any other", () => {
  const grid = node("UL", main);
  const b = fakeBrowser();
  const judge = createClickJudge(b.env);
  // Two pages already arrived — the grid is busy — then a third of twenty.
  for (let page = 0; page < 2; page++) {
    b.mutate(...Array.from({ length: 20 }, () => added(grid, node("LI", grid, { cls: "card" }))));
    b.advance(3000);
  }
  const third = Array.from({ length: 20 }, () => node("LI", grid, { cls: "card" }));
  b.mutate(...third.map((c) => added(grid, c)));
  b.advance(3000);
  // Every card of the batch, not just the first few.
  for (const card of [third[0], third[3], third[4], third[19]]) {
    const v = verdicts();
    click(judge, node("DIV", card), v.done); // its title
    b.mutate(added(card, el("SECTION"))); // its details
    b.advance(1000);
    assert.deepEqual(v.seen, [true]);
  }
});

test("a node born into a busy container is filled in as part of that insertion", () => {
  // The chat case again, at the boundary: the new message's paragraphs are
  // background while it's being filled in, its own once that's over.
  const thread = node("UL", main);
  const bubble = node("LI", thread, { cls: "msg", rect: { left: 0, top: 0, right: 300, bottom: 200 } });
  const message = node("LI", thread, { cls: "msg", rect: { left: 0, top: 205, right: 300, bottom: 260 } });
  const paragraph = () => added(message, el("P", { rect: { left: 0, top: 205, right: 300, bottom: 230 } }));
  const busy = (b: ReturnType<typeof fakeBrowser>) =>
    ambient(b, 8000, 4000, () => added(thread, node("LI", null, { cls: "msg" })));
  const later = verdictAfter(
    (b) => {
      busy(b);
      b.mutate(added(thread, message)); // arrived well before the click
      b.advance(1500);
    },
    node("SPAN", bubble),
    [paragraph()],
  );
  assert.equal(later, true, "its own change, a second and a half after it arrived");
});

test("an in-page dialog revealed by fading in (opacity, visibility) counts", () => {
  // Already rendered, so it has a box before and after; far from the click.
  for (const how of ["at once", "after the transition"]) {
    const dialog = node("DIV", body, { role: "dialog", faded: true, rect: { left: 600, top: 400, right: 900, bottom: 700 } });
    const b = fakeBrowser();
    const judge = createClickJudge(b.env);
    const v = verdicts();
    click(judge, card, v.done);
    b.advance(200);
    if (how === "at once") dialog.faded = false; // `opacity-0` → `opacity-100`
    b.mutate(attr(dialog, "class"));
    if (how !== "at once") {
      b.advance(150); // the fade-in starts at 0 and climbs
      dialog.faded = false;
    }
    b.advance(1000);
    assert.deepEqual(v.seen, [true], how);
  }
  // A class change on a dialog that stays faded out is not it appearing.
  const stillHidden = node("DIV", body, { role: "dialog", faded: true });
  assert.equal(verdictAfter(idle, card, [attr(stillHidden, "class")]), false);
});

test("regression 2: a 200px card revealing details just below itself, and an accordion closing", () => {
  // Clicked in the middle: the details' top edge is 100px from the pointer,
  // but flush with the card.
  const tile = node("DIV", main, { rect: { left: 0, top: 0, right: 300, bottom: 200 } });
  const details = node("DIV", main, { rect: { left: 0, top: 204, right: 300, bottom: 400 } });
  assert.equal(verdictAfter(idle, tile, [attr(details, "hidden")]), true);
  // Closing: the panel is hidden by the click, so it measures by where it was.
  const header = node("DIV", main, { rect: { left: 0, top: 80, right: 900, bottom: 120 } });
  const open = node("DIV", main, { rect: { left: 0, top: 120, right: 900, bottom: 600 } });
  assert.equal(
    verdictAfter(idle, header, () => {
      open.hidden = true;
      return [attr(open, "hidden")];
    }),
    true,
  );
});

test("regression 3: a plain dot in a five-slide autoplay carousel", () => {
  const dots = node("DIV", main);
  const all = Array.from({ length: 5 }, () => node("SPAN", dots, { cls: "dot" }));
  const worked = verdictAfter(
    (b) => {
      // Autoplay moves the active class from dot to dot every 3s.
      for (let i = 0; i < 5; i++) {
        b.mutate(attr(all[i], "class"), attr(all[(i + 1) % 5], "class"));
        b.advance(3000);
      }
    },
    all[3],
    [attr(all[3], "class")], // the clicked dot becomes the active one
  );
  assert.equal(worked, true);
});

test("regression 4: dismissing a toast by clicking it, though another arrived 3s before", () => {
  const stack = node("OL", body);
  const toast = node("LI", stack, { cls: "toast", role: "status" });
  const message = node("SPAN", toast);
  const worked = verdictAfter(
    (b) => {
      b.mutate(added(stack, node("LI", stack, { cls: "toast", role: "status" })));
      b.advance(3000);
    },
    message,
    [removed(stack, toast)],
  );
  assert.equal(worked, true);
});

test("regression 5: a dialog already in the page, shown by hidden / aria-hidden / class", () => {
  for (const name of ["hidden", "aria-hidden", "class"]) {
    const wrapper = node("DIV", body, { big: true, hidden: true });
    node("DIV", wrapper, { role: "dialog" });
    const worked = verdictAfter(
      (b) => b.advance(200),
      card,
      () => {
        wrapper.hidden = false; // shown, away from the click, pointer still
        return [attr(wrapper, name)];
      },
    );
    assert.equal(worked, true, name);
  }
  // …and one that was open, hidden by a click on a backdrop beside it.
  const open = node("DIV", body, { role: "dialog" });
  const backdropBeside = node("DIV", body, { big: true });
  assert.equal(
    verdictAfter(idle, backdropBeside, () => {
      open.hidden = true;
      return [attr(open, "aria-hidden")];
    }),
    true,
  );
});

test("with no click pending, mutations cost no layout reads", () => {
  const b = fakeBrowser();
  createClickJudge(b.env);
  b.state.active = node("INPUT", main); // focused, but not where the changes are
  const before = b.layoutReads();
  for (let i = 0; i < 100; i++) {
    b.mutate(added(chat, el("LI")), attr(panel, "class"), text(node("#text", panel)));
    b.advance(50);
  }
  assert.equal(b.layoutReads() - before, 0);
});

// ---- the newest interaction takes the credit ----------------------------------------

test("a miss beside a button stays dead when the visitor then clicks the button", () => {
  const b = fakeBrowser();
  const judge = createClickJudge(b.env);
  const miss = verdicts();
  click(judge, bar, miss.done); // nothing happens…
  b.advance(400);
  click(judge, button); // …so the visitor clicks the button itself, which works:
  b.mutate(text(buttonText), added(bar, el("UL")), attr(bar, "data-open")); // its label flips, a list opens
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
  b.mutate(added(card, el())); // a slow handler answers — which click, can't tell
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
    b.mutate(removed(body, el())); // a search overlay closing, a reveal on scroll
    b.advance(1000);
    assert.deepEqual(miss.seen, [false], next);
  }
});

test("a tap's touchmove jitter belongs to that tap", () => {
  const b = fakeBrowser();
  const judge = createClickJudge(b.env);
  const v = verdicts();
  judge.begin(card, "press");
  judge.arm(card, CENTER);
  judge.interact(); // touchmove between press and click
  judge.begin(card, "click");
  judge.judge(card, v.done, CENTER);
  b.mutate(added(card, el()));
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
