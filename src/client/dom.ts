/**
 * Polishd — DOM inspection helpers shared by every browser-side capture layer.
 *
 * Extracted from the main capture layer (`init.ts`) so the dashboard's own
 * telemetry emitter describes a click the same way the host site's capture
 * does — same selector shape, same component walk, same interactivity rules —
 * and the two can never drift apart.
 */

import {
  INLINE_TEXT_TAGS,
  INTERACTIVE_TAGS,
  normalizeLabel,
  PROSE_MIN_CHARS,
  PROSE_TAGS,
} from "../shared/text-signals";
import {
  COMPONENT_MAX_VIEWPORT_SHARE,
  findNearMiss,
  rectArea,
  withoutLabel,
  type Point,
} from "./near-miss";
import { hasReactClickHandler } from "./react-props";
import { componentOf, labelOf as rawLabelOf, selectorOf } from "./target";

export { componentOf, selectorOf };

/**
 * An element's visible label, digit runs folded to `#` so a count in a label
 * ("Show 9 more") doesn't split one control into a row per value.
 */
export const labelOf = (target: EventTarget | null): string | undefined =>
  normalizeLabel(rawLabelOf(target));

/** Is this element itself a control? No ancestor walk — see `isInteractive`. */
export const isControl = (node: Element): boolean => {
  if (INTERACTIVE_TAGS.has(node.tagName.toLowerCase())) return true;
  const role = node.getAttribute("role");
  if (role && /button|link|menuitem|tab|checkbox|radio|switch/.test(role)) return true;
  if (node.hasAttribute("onclick") || (node as HTMLElement).isContentEditable) return true;
  // A React `onClick` leaves no trace in the DOM but its props (react-props.ts).
  return hasReactClickHandler(node);
};

/** The control at `el` or up to three levels above it, if any. */
export const controlOf = (el: Element | null): Element | null => {
  let node: Element | null = el;
  for (let depth = 0; node && depth < 4; depth++) {
    if (isControl(node)) return node;
    node = node.parentElement;
  }
  return null;
};

export const isInteractive = (el: Element | null): boolean => controlOf(el) !== null;

/** True when the click coincided with the user highlighting text. */
export const hasTextSelection = (): boolean => {
  const sel = typeof window.getSelection === "function" ? window.getSelection() : null;
  return !!sel && !sel.isCollapsed && sel.toString().trim().length > 0;
};

/** Does the element directly hold rendered text (not just element children)? */
const hasDirectText = (el: Element): boolean => {
  for (const child of el.childNodes) {
    if (child.nodeType === 3 /* TEXT_NODE */ && child.textContent?.trim()) return true;
  }
  return false;
};

/**
 * True when the click landed on text the user is reading.
 *
 * Two shapes qualify:
 *  1. Anything inside a block-level prose element (paragraph, heading, list
 *     item…) — including a bold word or code span nested in one. Same walk
 *     depth as `isInteractive`.
 *  2. A standalone inline text element or a generic container directly holding
 *     its own text (clicking the text in `<div>hello</div>` targets the div),
 *     but only past the prose length threshold. A short standalone label —
 *     `<div>Submit</div>`, `<span>Click here</span>` — is exactly what a
 *     mis-wired fake control looks like, so it stays eligible for dead/rage
 *     detection.
 */
export const isTextTarget = (el: Element | null): boolean => {
  let node: Element | null = el;
  for (let depth = 0; node && depth < 4; depth++) {
    if (PROSE_TAGS.has(node.tagName.toLowerCase())) return true;
    node = node.parentElement;
  }
  if (!el) return false;
  if (!INLINE_TEXT_TAGS.has(el.tagName.toLowerCase()) && !hasDirectText(el)) return false;
  return (el.textContent || "").replace(/\s+/g, " ").trim().length >= PROSE_MIN_CHARS;
};

/**
 * True when a rapid-click burst reads as select-a-word / select-a-paragraph
 * (double- and triple-clicking prose) rather than frustration. Deliberately
 * *not* based on `hasTextSelection()`: hammering a fake button selects its
 * label as a side effect, and that burst is exactly the rage we want to keep.
 * Interactive targets never match — hammering a real button is always rage.
 */
export const isSelectionGesture = (el: Element | null): boolean =>
  !isInteractive(el) && isTextTarget(el);

const viewportArea = (): number =>
  (window.innerWidth || document.documentElement.clientWidth || 0) *
  (window.innerHeight || document.documentElement.clientHeight || 0);

/** Is this element a component — a bar, a card — rather than page layout? */
export const isComponentSized = (el: Element): boolean =>
  rectArea(el.getBoundingClientRect()) <= viewportArea() * COMPONENT_MAX_VIEWPORT_SHARE;

/** What a control is called: its text, else its accessible name, else its selector. */
const controlLabel = (control: Element): string | undefined =>
  labelOf(control) ||
  normalizeLabel(
    (control.getAttribute("aria-label") || control.getAttribute("title") || "").trim().slice(0, 80) ||
      undefined,
  ) ||
  selectorOf(control);

/**
 * The near miss behind a dead click on `target`, if there is one: the label of
 * the control it missed (`near`), and the click's own label (`text`) with that
 * control's text taken out when the target contains it — a bar wrapping a
 * "Show 9 more" button has the button's text as its label, and a dead click on
 * the bar must not read as one on the button. See near-miss.ts.
 */
export const nearMissOf = (
  target: Element,
  point: Point | null,
  text: string | undefined,
): { near: string; text: string | undefined } | null => {
  const miss = findNearMiss<Element>(target, point, {
    isControl,
    controlOf,
    children: (el) => el.children,
    rect: (el) => el.getBoundingClientRect(),
    hitTest: (x, y) => document.elementFromPoint(x, y),
    viewportArea,
  });
  if (!miss) return null;
  const near = controlLabel(miss.control);
  if (!near) return null;
  return { near, text: miss.contained ? withoutLabel(text, labelOf(miss.control)) : text };
};

/**
 * Coarse device buckets keyed off CSS-pixel width. Aligns with common
 * breakpoints (Tailwind sm/lg) so categories read intuitively on the
 * dashboard.
 */
export const deviceCategory = (w: number): string =>
  w < 640 ? "mobile" : w < 1024 ? "tablet" : "desktop";
