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
 *   rage_click  the same element hit `rageCount` times inside `rageWindowMs`
 *   dead_click  on something that isn't a control, after which nothing
 *               happened for a second (see click-outcome.ts) — with the
 *               control it narrowly missed, if any, in `meta.near`
 *
 * Clicks on text (reading, selecting) are neither and are not recorded.
 */
import { createClickJudge, DEAD_CLICK_HOLD_MS, type JudgeEnv, type MutationLike } from "./click-outcome";
import {
  componentOf,
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

export interface ClickCaptureEvent {
  type: "click" | "rage_click" | "dead_click";
  /** Click time — a judged click is emitted up to a second later. */
  ts: number;
  /** The path at click time, which a judged click may have navigated away from. */
  path: string;
  selector?: string;
  component?: string;
  text?: string;
  meta?: { near: string };
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
  /** Settle every click still being judged; call as the page hides or unloads. */
  settle(): void;
}

const browserJudgeEnv = (): JudgeEnv => ({
  href: () => location.href,
  activeElement: () => document.activeElement,
  isComponentSized: (node) => isComponentSized(node as unknown as Element),
  observe(onRecords) {
    if (typeof MutationObserver === "undefined") return () => {};
    const observer = new MutationObserver((records) => onRecords(records as MutationLike[]));
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    return () => observer.disconnect();
  },
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
});

/** Where the pointer was; a keyboard or scripted click (`detail` 0) has no position. */
const pointOf = (ev: MouseEvent): Point | null =>
  ev.detail === 0 ? null : { x: ev.clientX, y: ev.clientY };

export function startClickCapture(opts: ClickCaptureOptions): ClickCapture {
  const judge = createClickJudge(browserJudgeEnv(), { holdMs: DEAD_CLICK_HOLD_MS });
  const active = opts.active ?? (() => true);
  let lastClick = { selector: "", time: 0, count: 0 };
  let last: InteractionLike | null = null;

  // Watch from the press, so a widget that acts on pointerdown still counts.
  document.addEventListener(
    "pointerdown",
    (ev) => {
      if (ev.button !== 0 || !active()) return;
      const target = ev.target as Element | null;
      if (!target) return;
      // Every press starts a new interaction, control or not: what happens
      // from here is this press's doing, not an earlier click's.
      judge.begin(target, "press");
      if (!isInteractive(target)) judge.arm(target);
    },
    { capture: true, passive: true },
  );

  document.addEventListener(
    "click",
    (ev) => {
      const target = ev.target as Element | null;
      if (!target || !active()) {
        judge.release();
        return;
      }
      judge.begin(target, "click");
      const selector = selectorOf(target);
      const component = componentOf(target);
      const text = labelOf(target);
      const now = Date.now();
      const path = opts.path();
      last = { ts: now, component, label: text, selector };

      // Rage: same selector clicked `rageCount` times inside `rageWindowMs`.
      if (selector === lastClick.selector && now - lastClick.time < opts.rageWindowMs) {
        lastClick.count++;
        lastClick.time = now;
        if (lastClick.count === opts.rageCount && !isSelectionGesture(target)) {
          // Double/triple-clicking prose selects a word or paragraph — that
          // burst is intent to copy, not frustration.
          opts.emit({ type: "rage_click", ts: now, path, selector, component, text });
        }
      } else {
        lastClick = { selector: selector ?? "", time: now, count: 1 };
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
      const miss = nearMissOf(target, pointOf(ev), text);
      judge.judge(target, (worked) => {
        if (worked) {
          opts.emit({ type: "click", ts: now, path, selector, component, text });
        } else {
          opts.emit({
            type: "dead_click",
            ts: now,
            path,
            selector,
            component,
            text: miss ? miss.text : text,
            ...(miss ? { meta: { near: miss.near } } : {}),
          });
        }
      });
    },
    { capture: true, passive: true },
  );

  return {
    lastInteraction: () => last,
    settle: () => judge.settleAll(),
  };
}
