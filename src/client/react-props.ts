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
 * Not every `onClick` makes a control. A modal's panel carries
 * `onClick={(e) => e.stopPropagation()}` so clicks inside it don't reach the
 * backdrop — a guard, not a response — so a handler whose whole body is
 * `stopPropagation()`/`preventDefault()` doesn't count. And `controlOf` in
 * dom.ts only looks for a handler on the clicked element and its parent: a
 * handler further up is as likely to be a container's guard or delegation, so
 * a click deeper than that is judged by its outcome instead.
 *
 * Only the node's own keys are read — React sets the props directly on the
 * node, so nothing inherited can be one — and any throw (an exotic host
 * object, a getter) reads as "no handler": this runs inside the host's click
 * listener and must never break it.
 *
 * Import-free so `node --test` can load it directly.
 */

const REACT_PROPS_PREFIX = "__reactProps$";

/** A handler's parameter, then its body: `e=>…`, `(e)=>…`, `function name(e){…}`. */
const HANDLER = /^(?:async)?(?:function\w*)?\(?(\w+)\)?(?:=>)?(.*)$/;
const GUARD_CALL = /^(\w+)\.(?:stopPropagation|preventDefault|stopImmediatePropagation)\(\)$/;

/**
 * True for a handler that does nothing but stop the event:
 * `(e) => e.stopPropagation()`, `function (e) { e.preventDefault(); e.stopPropagation(); }`,
 * and what minifiers make of them, including the comma form
 * `e=>(e.stopPropagation(),e.preventDefault())`.
 */
export const isPropagationGuard = (handler: unknown): boolean => {
  if (typeof handler !== "function") return false;
  try {
    const source = Function.prototype.toString.call(handler);
    if (source.length > 200) return false;
    const parts = HANDLER.exec(source.replace(/\s+/g, ""));
    if (!parts) return false;
    const [, param, rawBody] = parts;
    // Unwrap one block and one parenthesised sequence: `{…}`, `(…)`.
    const body = rawBody.replace(/^\{(.*)\}$/, "$1").replace(/^\((.*)\)$/, "$1");
    const calls = body.split(/[;,]/).filter(Boolean);
    return calls.length > 0 && calls.every((c) => GUARD_CALL.exec(c)?.[1] === param);
  } catch {
    return false;
  }
};

/** True when `node` has a React `onClick` handler that does something. */
export const hasReactClickHandler = (node: object | null | undefined): boolean => {
  if (!node) return false;
  try {
    for (const key of Object.keys(node)) {
      if (!key.startsWith(REACT_PROPS_PREFIX)) continue;
      const props = (node as Record<string, unknown>)[key] as { onClick?: unknown } | null;
      return typeof props?.onClick === "function" && !isPropagationGuard(props.onClick);
    }
  } catch {
    /* unreadable: treat as no handler */
  }
  return false;
};
