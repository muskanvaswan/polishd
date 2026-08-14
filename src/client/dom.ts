/**
 * Polishd — DOM inspection helpers shared by every browser-side capture layer.
 *
 * Extracted from the main capture layer (`init.ts`) so the dashboard's own
 * telemetry emitter describes a click the same way the host site's capture
 * does — same selector shape, same component walk, same interactivity rules —
 * and the two can never drift apart.
 */

const INTERACTIVE = new Set(["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "LABEL", "SUMMARY"]);

export const isInteractive = (el: Element | null): boolean => {
  let node: Element | null = el;
  for (let depth = 0; node && depth < 4; depth++) {
    if (INTERACTIVE.has(node.tagName)) return true;
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
