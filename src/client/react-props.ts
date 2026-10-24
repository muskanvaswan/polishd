/**
 * Polishd — does React think this element handles clicks?
 *
 * An element with a React `onClick` is as interactive as a `<button>`, but
 * nothing in the DOM says so: React delegates every listener to its root, so
 * the element carries no `onclick` attribute and no listener of its own. A
 * modal backdrop or a clickable card wired this way used to read as a dead
 * click on every press, even when the press closed the modal.
 *
 * React keeps each host element's current props on the node itself, under a
 * `__reactProps$<random>` key, which is the one place the handler is visible.
 * Reading it is a cheap first check; the outcome check in `click-outcome.ts`
 * still catches handlers this can't see (other frameworks, `addEventListener`).
 *
 * Import-free so `node --test` can load it directly.
 */

const REACT_PROPS_PREFIX = "__reactProps$";

/** True when `node` has a React `onClick` handler attached. */
export const hasReactClickHandler = (node: object | null | undefined): boolean => {
  if (!node) return false;
  for (const key of Object.keys(node)) {
    if (!key.startsWith(REACT_PROPS_PREFIX)) continue;
    const props = (node as Record<string, unknown>)[key] as { onClick?: unknown } | null;
    return typeof props?.onClick === "function";
  }
  return false;
};
