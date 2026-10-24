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
 * Only the node's own keys are read — React sets the props directly on the
 * node, so nothing inherited can be one — and any throw (an exotic host
 * object, a getter) reads as "no handler": this runs inside the host's click
 * listener and must never break it. `controlOf` in dom.ts applies it to the
 * same four-level ancestor walk as every other interactivity rule.
 *
 * Import-free so `node --test` can load it directly.
 */

const REACT_PROPS_PREFIX = "__reactProps$";

/** True when `node` has a React `onClick` handler attached. */
export const hasReactClickHandler = (node: object | null | undefined): boolean => {
  if (!node) return false;
  try {
    for (const key of Object.keys(node)) {
      if (!key.startsWith(REACT_PROPS_PREFIX)) continue;
      const props = (node as Record<string, unknown>)[key] as { onClick?: unknown } | null;
      return typeof props?.onClick === "function";
    }
  } catch {
    /* unreadable: treat as no handler */
  }
  return false;
};
