/**
 * Wiring test for the host capture layer: `initPolishd` against a stubbed
 * browser.
 *
 * Run with `npm test` (the test resolve hook lets this load init.ts as it
 * ships). The judge's own tests cover what a held click resolves to; this
 * covers what happens to one when the page goes away mid-hold — it must leave
 * in the pagehide beacon, as a click, before `session_end`, not be dropped
 * with the timer that would have settled it.
 *
 * The stub is the minimum init.ts touches: event targets for `window` and
 * `document`, a location, a history, a beacon that records what it was sent,
 * and elements carrying only what the click helpers read. There is no
 * MutationObserver, so the judge decides on URL, focus and time alone.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

// ---- a stub browser ------------------------------------------------------------------

const windowTarget = new EventTarget();
const documentTarget = new EventTarget();
const beacons: Blob[] = [];

const rect = { left: 0, top: 0, right: 200, bottom: 100, width: 200, height: 100 };

/** An element with just what the click helpers read. */
const element = (tag: string, attrs: Record<string, string>, parentElement: object | null) => {
  const self = {
    nodeType: 1,
    nodeName: tag.toUpperCase(),
    tagName: tag.toUpperCase(),
    id: attrs.id ?? "",
    parentElement,
    parentNode: parentElement,
    children: [],
    childNodes: [],
    textContent: "",
    innerText: "",
    isContentEditable: false,
    getAttribute: (name: string) => attrs[name] ?? null,
    hasAttribute: (name: string) => name in attrs,
    getBoundingClientRect: () => rect,
    contains(other: unknown) {
      for (let n = other as { parentNode?: unknown } | null; n; n = n.parentNode as typeof n) {
        if (n === self) return true;
      }
      return false;
    },
    closest: () => null,
    get ownerDocument() {
      return fakeDocument;
    },
  };
  return self;
};

const body = element("body", {}, null);
const fakeDocument = Object.assign(documentTarget, {
  documentElement: { clientWidth: 1280, clientHeight: 800, scrollHeight: 800, scrollTop: 0 },
  body,
  readyState: "complete",
  visibilityState: "visible",
  activeElement: body,
  querySelector: () => null,
  elementFromPoint: () => null,
  getElementsByClassName: () => ({ length: 1 }),
});

Object.assign(globalThis, {
  window: globalThis,
  document: fakeDocument,
  location: { pathname: "/", href: "http://site.test/", search: "", origin: "http://site.test" },
  history: { pushState() {}, replaceState() {} },
  innerWidth: 1280,
  innerHeight: 800,
  devicePixelRatio: 1,
  addEventListener: windowTarget.addEventListener.bind(windowTarget),
  removeEventListener: windowTarget.removeEventListener.bind(windowTarget),
  dispatchEvent: windowTarget.dispatchEvent.bind(windowTarget),
  // The periodic flush would keep this test process alive forever.
  setInterval: () => 0,
  fetch: async () => new Response('{"ok":true}'),
});
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    sendBeacon: (_url: string, blob: Blob) => {
      beacons.push(blob);
      return true;
    },
  },
});

/** Dispatch `type` on the document as though it happened on `target`. */
const fire = (type: string, target: object, init: Record<string, number> = {}) => {
  const ev = new Event(type);
  for (const [key, value] of Object.entries({ target, button: 0, detail: 1, clientX: 50, clientY: 50, ...init })) {
    Object.defineProperty(ev, key, { value });
  }
  documentTarget.dispatchEvent(ev);
};
const click = (target: object) => {
  fire("pointerdown", target);
  fire("click", target);
};

const { initPolishd } = await import("./init.ts");

test("a click still being judged when the page goes away leaves as a click", async () => {
  initPolishd({ maxBatchSize: 1000, flushIntervalMs: 1e9 });

  const dead = element("div", { class: "hero" }, body);
  const leaving = element("div", { class: "card" }, body);

  click(dead); // nothing happens: after the hold this is a dead click
  await new Promise((resolve) => setTimeout(resolve, 1100));
  click(leaving); // the page unloads while this one is still held
  windowTarget.dispatchEvent(new Event("pagehide"));

  assert.equal(beacons.length, 1, "the pagehide flush went out as a beacon");
  const { events } = JSON.parse(await beacons[0].text()) as {
    events: Array<{ type: string; selector?: string; ts: number }>;
  };
  const clicks = events.filter((e) => /click/.test(e.type)).map((e) => `${e.type} ${e.selector}`);
  assert.deepEqual(clicks, ["dead_click div.hero", "click div.card"]);

  const types = events.map((e) => e.type);
  assert.ok(types.indexOf("session_end") > types.lastIndexOf("click"), "settled before session_end");
});

test("hammering an icon toggle whose svg is re-created every click is rage", async () => {
  // React swaps the icon on each toggle, so every click lands on a new
  // <path>; the button around it is the element being hammered.
  const toggle = element("button", { class: "fav" }, body);
  for (let i = 0; i < 3; i++) {
    const svg = element("svg", {}, toggle);
    fire("click", element("path", {}, svg));
  }
  windowTarget.dispatchEvent(new Event("pagehide"));
  const { events } = JSON.parse(await beacons[beacons.length - 1].text()) as {
    events: Array<{ type: string; selector?: string }>;
  };
  assert.equal(events.filter((e) => e.type === "rage_click").length, 1);
});
