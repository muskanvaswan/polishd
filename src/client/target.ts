/**
 * Polishd — describe what an event landed on: its component, a selector path,
 * its visible label. Re-exported from `dom.ts`, which every capture layer
 * imports; kept free of imports itself so `node --test` can load it directly.
 *
 * An event's target isn't always an element. A runtime throw dispatches its
 * `error` event on `window`; only a failed resource load targets the
 * `<img>`/`<script>` that failed. So each helper takes any target and answers
 * `undefined` for one that isn't an element, rather than calling element
 * methods it doesn't have — a throw inside the error listener loses the very
 * error it was reporting.
 */

/**
 * `nodeType` rather than `instanceof Element`: it holds for elements from
 * another realm, and needs no DOM globals to exist.
 */
const isElement = (target: EventTarget | null): target is Element =>
  (target as Node | null)?.nodeType === 1; /* ELEMENT_NODE */

/** Walk up for the nearest `data-component`, the key synthesis signal. */
export const componentOf = (target: EventTarget | null): string | undefined => {
  let node: Element | null = isElement(target) ? target : null;
  for (let depth = 0; node && depth < 8; depth++) {
    const c = node.getAttribute("data-component");
    if (c) return c;
    node = node.parentElement;
  }
  return undefined;
};

/** Compact, stable-ish selector path (tag + id + first class), capped. */
export const selectorOf = (target: EventTarget | null): string | undefined => {
  if (!isElement(target)) return undefined;
  const parts: string[] = [];
  let node: Element | null = target;
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

export const labelOf = (target: EventTarget | null): string | undefined => {
  if (!isElement(target)) return undefined;
  const t = (target as HTMLElement).innerText || target.textContent || "";
  const trimmed = t.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed.slice(0, 80) : undefined;
};
