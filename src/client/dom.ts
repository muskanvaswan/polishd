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
  PROSE_MIN_CHARS,
  PROSE_TAGS,
} from "../shared/text-signals";

export const isInteractive = (el: Element | null): boolean => {
  let node: Element | null = el;
  for (let depth = 0; node && depth < 4; depth++) {
    if (INTERACTIVE_TAGS.has(node.tagName.toLowerCase())) return true;
    const role = node.getAttribute("role");
    if (role && /button|link|menuitem|tab|checkbox|radio|switch/.test(role)) return true;
    if (node.hasAttribute("onclick") || (node as HTMLElement).isContentEditable) return true;
    node = node.parentElement;
  }
  return false;
};

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

/** Walk up for the nearest `data-component`, the key synthesis signal. */
export const componentOf = (el: Element | null): string | undefined => {
  let node: Element | null = el;
  for (let depth = 0; node && depth < 8; depth++) {
    const c = node.getAttribute("data-component");
    if (c) return c;
    node = node.parentElement;
  }
  return undefined;
};

/** Compact, stable-ish selector path (tag + id + first class), capped. */
export const selectorOf = (el: Element | null): string | undefined => {
  if (!el) return undefined;
  const parts: string[] = [];
  let node: Element | null = el;
  for (let depth = 0; node && depth < 4 && node.tagName !== "BODY"; depth++) {
    let part = node.tagName.toLowerCase();
    if (node.id) {
      parts.unshift(`${part}#${node.id}`);
      break;
    }
    const cls = (node.getAttribute("class") || "").trim().split(/\s+/)[0];
    if (cls) part += `.${cls}`;
    parts.unshift(part);
    node = node.parentElement;
  }
  return parts.join(">");
};

export const labelOf = (el: Element | null): string | undefined => {
  const t = (el as HTMLElement | null)?.innerText || (el as HTMLElement | null)?.textContent || "";
  const trimmed = t.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed.slice(0, 80) : undefined;
};

/**
 * Coarse device buckets keyed off CSS-pixel width. Aligns with common
 * breakpoints (Tailwind sm/lg) so categories read intuitively on the
 * dashboard.
 */
export const deviceCategory = (w: number): string =>
  w < 640 ? "mobile" : w < 1024 ? "tablet" : "desktop";
