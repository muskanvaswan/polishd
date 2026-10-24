/**
 * Polishd — click capture: click, rage click, dead click.
 *
 * Shared by the host site's capture layer (`init.ts`) and the dashboard's own
 * telemetry emitter (`dashboard/telemetry.tsx`), so a click is classified the
 * same way on both and the two can't drift apart. Each supplies where events
 * go and which path they belong to; everything about what a click *was* lives
 * here.
 *
 *   click       on a control, or on anything after which the page responded
 *   rage_click  the same element (the same node, not just the same selector)
 *               hit `rageCount` times inside `rageWindowMs`, decided and
 *               emitted at the click itself (rage.ts)
 *   dead_click  on something that isn't a control, after which nothing
 *               happened for a second (click-outcome.ts) — with the control it
 *               narrowly missed, if any, in `meta.near`
 *
 * `selector` is the stable key every event carries. Rage and dead clicks also
 * carry `meta.handle`, a path to find the element in the source by (target.ts
 * `handleOf`) — and a near miss `meta.nearHandle`, the missed control's. A
 * handle reads the whole document, so plain clicks, which are only counted,
 * never pay for one.
 *
 * Clicks on text (reading, selecting) are neither and are not recorded.
 *
 * Every listener body is guarded: capture runs inside the host's pages, and a
 * throw from it would surface as the host's error — and be recorded as one.
 */
import { createClickJudge, DEAD_CLICK_HOLD_MS, type JudgeEnv, type MutationLike, type NodeLike } from "./click-outcome";
import {
  componentOf,
  handleOf,
  hasTextSelection,
  isComponentSized,
  isInteractive,
  isSelectionGesture,
  isTextTarget,
  labelOf,
  nearMissOf,
  selectorOf,
} from "./dom";
import type { InteractionLike } from "./error-context";
import type { Point } from "./near-miss";
import { createRageTracker } from "./rage";

/** Cap on `meta.near`, well inside ingest's 500-char per-value limit. */
const MAX_NEAR_LEN = 120;

/** Marks polishd's own UI; mutations inside it are never a click's response. */
const OWN_UI_SELECTOR = "[data-polishd-ui]";

export interface ClickCaptureEvent {
  type: "click" | "rage_click" | "dead_click";
  /** Click time — a judged click is emitted up to a second later. */
  ts: number;
  /** The path at click time, which a judged click may have navigated away from. */
  path: string;
  selector?: string;
  component?: string;
  text?: string;
  meta?: { near?: string; handle?: string; nearHandle?: string };
}

export interface ClickCaptureOptions {
  rageCount: number;
  rageWindowMs: number;
  /** Path to stamp on this click's events, read at click time. */
  path: () => string;
  /** Whether to capture at all right now. Checked at press and at click. */
  active?: () => boolean;
  emit: (event: ClickCaptureEvent) => void;
}

export interface ClickCapture {
  /** The most recent click captured, for attributing errors that follow it. */
  lastInteraction(): InteractionLike | null;
  /**
   * Settle every click still being judged, emitting each as a click before
   * returning. Call as the page hides or unloads, then flush.
   */
  settle(): void;
}

const elementOf = (node: NodeLike): Element | null => {
  const n = node as unknown as Node;
  return n.nodeType === 1 ? (n as Element) : n.parentElement;
};

const browserJudgeEnv = (): JudgeEnv => ({
  now: () => Date.now(),
  href: () => location.href,
  activeElement: () => document.activeElement,
  isComponentSized: (node) => {
    const el = elementOf(node);
    return !!el && isComponentSized(el);
  },
  isUnderPoint(node, point) {
    const el = elementOf(node);
    if (!el || !isComponentSized(el)) return false;
    const r = el.getBoundingClientRect();
    return point.x >= r.left && point.x <= r.right && point.y >= r.top && point.y <= r.bottom;
  },
  isOwn: (node) => !!elementOf(node)?.closest(OWN_UI_SELECTOR),
  observe(onRecords) {
    if (typeof MutationObserver === "undefined") return;
    new MutationObserver((records) => {
      try {
        onRecords(records as unknown as MutationLike[]);
      } catch {
        /* a judging failure must never surface on the host page */
      }
    }).observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
  },
  setTimeout: (fn, ms) =>
    setTimeout(() => {
      try {
        fn();
      } catch {
        /* as above */
      }
    }, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
});

/** Where the pointer was; a keyboard or scripted click (`detail` 0) has no position. */
const pointOf = (ev: MouseEvent): Point | null =>
  ev.detail === 0 ? null : { x: ev.clientX, y: ev.clientY };

/** Run a listener body; capture must never throw into the host page. */
const guarded =
  <E extends Event>(fn: (ev: E) => void) =>
  (ev: E) => {
    try {
      fn(ev);
    } catch {
      /* drop this event rather than break the page or record our own error */
    }
  };

export function startClickCapture(opts: ClickCaptureOptions): ClickCapture {
  // Observes for the page's lifetime: the background-churn baseline has to be
  // running before the click it protects.
  const judge = createClickJudge(browserJudgeEnv(), { holdMs: DEAD_CLICK_HOLD_MS });
  const rage = createRageTracker(opts.rageCount, opts.rageWindowMs);
  const active = opts.active ?? (() => true);
  let last: { ts: number; component?: string; label?: string; selector?: string; el: Element } | null =
    null;
  const listen = { capture: true, passive: true } as const;

  // Watch from the press, so a widget that acts on pointerdown still counts.
  document.addEventListener(
    "pointerdown",
    guarded((ev: PointerEvent) => {
      if (ev.button !== 0 || !active()) return;
      const target = ev.target as Element | null;
      if (!target) return;
      // Every press starts a new interaction, control or not: what happens
      // from here is this press's doing, not an earlier click's.
      judge.begin(target as unknown as NodeLike, "press");
      if (!isInteractive(target)) judge.arm(target as unknown as NodeLike, pointOf(ev));
    }),
    listen,
  );
  // Where the pointer goes after a click is hover, not the click's doing.
  document.addEventListener(
    "pointerover",
    guarded((ev: PointerEvent) => {
      if (ev.target) judge.hover(ev.target as unknown as NodeLike);
    }),
    listen,
  );
  document.addEventListener("pointercancel", guarded(() => judge.release()), listen);

  // Typing and scrolling are interactions too: what changes after them (a
  // search updating, content revealed on scroll) isn't an earlier click's.
  const interact = guarded(() => judge.interact());
  document.addEventListener("keydown", interact, listen);
  addEventListener("wheel", interact, { passive: true });
  addEventListener("touchmove", interact, { passive: true });

  document.addEventListener(
    "click",
    guarded((ev: MouseEvent) => {
      const target = ev.target as Element | null;
      if (!target || !active()) {
        judge.release();
        return;
      }
      judge.begin(target as unknown as NodeLike, "click");
      const selector = selectorOf(target);
      const component = componentOf(target);
      const text = labelOf(target);
      const now = Date.now();
      const path = opts.path();
      last = { ts: now, component, label: text, selector, el: target };

      // Rage is decided here and now, never held: the burst is the signal. It
      // counts hits on this node, so an element whose classes change as it's
      // clicked (a like button gaining `liked`) is still one element.
      // Double/triple-clicking prose selects a word or paragraph — that burst
      // is intent to copy, not frustration.
      if (rage.hit(target, now) && !isSelectionGesture(target)) {
        const handle = handleOf(target);
        opts.emit({
          type: "rage_click",
          ts: now,
          path,
          selector,
          component,
          text,
          ...(handle ? { meta: { handle } } : {}),
        });
      }

      if (isInteractive(target)) {
        judge.release();
        opts.emit({ type: "click", ts: now, path, selector, component, text });
        return;
      }

      // Two shapes of click are about the text, not a dead control: a
      // drag-to-highlight firing its click on mouse-up, and a click landing on
      // a text element (cursor placement, the start of a selection). Neither
      // is confusion — don't log them as dead clicks.
      if (hasTextSelection() || isTextTarget(target)) {
        judge.release();
        return;
      }

      // Not recognisably a control: judge it by what happens next. The near
      // miss is measured now, while the layout is the one the visitor saw.
      const point = pointOf(ev);
      let miss: ReturnType<typeof nearMissOf> = null;
      try {
        miss = nearMissOf(target, point, text);
      } catch {
        /* no near miss rather than no event */
      }
      judge.judge(
        target as unknown as NodeLike,
        (worked) => {
          if (worked) {
            opts.emit({ type: "click", ts: now, path, selector, component, text });
            return;
          }
          // Dead: the DOM is as it was, so the handles read the layout clicked.
          const meta: NonNullable<ClickCaptureEvent["meta"]> = {};
          const handle = handleOf(target);
          if (handle) meta.handle = handle;
          if (miss) {
            meta.near = miss.near.slice(0, MAX_NEAR_LEN);
            const nearHandle = handleOf(miss.control);
            if (nearHandle) meta.nearHandle = nearHandle;
          }
          opts.emit({
            type: "dead_click",
            ts: now,
            path,
            selector,
            component,
            text: miss ? miss.text : text,
            ...(Object.keys(meta).length ? { meta } : {}),
          });
        },
        point,
      );
    }),
    listen,
  );

  return {
    lastInteraction() {
      if (!last) return null;
      const { el, ...click } = last;
      return { ...click, handle: () => handleOf(el) };
    },
    settle: () => judge.settleAll(),
  };
}
