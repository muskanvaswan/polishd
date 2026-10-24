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

/**
 * A class worth naming: a plain CSS identifier. Skips Tailwind variants
 * (`lg:sticky`, `hover:bg-white`), arbitrary values (`bg-[#111]`), and
 * anything else that would need escaping (`w-1/2`, `py-2.5`, `!mt-0`) — an
 * escaped class is valid CSS but no longer greps.
 */
const PLAIN_CLASS = /^-?[A-Za-z_][\w-]*$/;
/** An id a person wrote — not React's `:r1:`/`«r1»` or Radix's `radix-:r2:`. */
const PLAIN_ID = /^[A-Za-z][\w-]*$/;
/** A `data-component` value safe to quote inside a `>`-separated path. */
const SAFE_COMPONENT = /^[^"\\>\n]+$/;
/** Classes weighed per element; past this, Tailwind lists are all utilities. */
const MAX_CLASSES_WEIGHED = 12;

/** How many elements in the document carry `cls`; 0 when there's no document to ask. */
const classCount = (el: Element, cls: string): number => {
  try {
    return el.ownerDocument?.getElementsByClassName?.(cls)?.length ?? 0;
  } catch {
    return 0;
  }
};

/**
 * The element's most distinctive class: the plain one fewest elements in the
 * document share. With Tailwind the first class is usually a generic utility
 * (`text-white`, `absolute`) that names nothing; a component's own class, or
 * the rarest utility on it, is what lets the selector be found in the source.
 */
const distinctiveClass = (el: Element): string | undefined => {
  const classes = (el.getAttribute("class") || "")
    .split(/\s+/)
    .filter((c) => PLAIN_CLASS.test(c))
    .slice(0, MAX_CLASSES_WEIGHED);
  let best: string | undefined;
  let bestRank = Infinity;
  for (const cls of classes) {
    // A class on a connected element counts at least itself; 0 means the
    // count couldn't be taken, which ranks behind any real one.
    const count = classCount(el, cls);
    const rank = count > 0 ? count : Infinity;
    if (best === undefined || rank < bestRank) [best, bestRank] = [cls, rank];
    if (count === 1) break; // unique: nothing beats it
  }
  return best;
};

/** The first class worth naming, in the order the markup lists them. */
const firstPlainClass = (el: Element): string | undefined =>
  (el.getAttribute("class") || "").split(/\s+/).find((c) => PLAIN_CLASS.test(c));

/**
 * Compact, stable selector path: at most four levels, tag plus first class,
 * stopping at an id. The dashboard's element stats group by it and rage
 * clicks used to compare it, so it depends only on the element's own markup,
 * never on the rest of the document — a button toggling `liked` stays one
 * selector, today and in last month's rows.
 *
 * The first *plain* class, not the first class: a Tailwind variant
 * (`lg:sticky`) or arbitrary value (`bg-[#111]`) is not a valid class
 * selector, and a class attribute with nothing usable gives the bare tag
 * rather than `a.`. Likewise generated ids (`:r1:`) are skipped, not anchored
 * on. For a path a person can grep for, see {@link handleOf}.
 */
export const selectorOf = (target: EventTarget | null): string | undefined => {
  if (!isElement(target)) return undefined;
  const parts: string[] = [];
  let node: Element | null = target;
  for (let depth = 0; node && depth < 4 && node.tagName !== "BODY"; depth++) {
    const tag = node.tagName.toLowerCase();
    if (node.id && PLAIN_ID.test(node.id)) {
      parts.unshift(`${tag}#${node.id}`);
      break;
    }
    const cls = firstPlainClass(node);
    parts.unshift(cls ? `${tag}.${cls}` : tag);
    node = node.parentElement;
  }
  return parts.join(">");
};

/** Cap on a handle, well inside ingest's 500-char per-value limit. */
const MAX_HANDLE_LEN = 200;

/**
 * A path to find the element in the source by — `meta.handle` on dead and
 * rage clicks, near misses and errors. At most four levels, it stops at the
 * nearest `data-component` (`section[data-component="hero"]`, the name the
 * source uses) or hand-written id, and names every other level by its most
 * distinctive plain class: with Tailwind the first class is usually a generic
 * utility (`text-white`, `absolute`) that names nothing.
 *
 * Because "most distinctive" depends on the rest of the document, a handle
 * can differ between two clicks on the same element. That's why it is
 * evidence, never a key: nothing groups or compares by it, and it's only
 * computed for the events that get reported.
 */
export const handleOf = (target: EventTarget | null): string | undefined => {
  if (!isElement(target)) return undefined;
  const parts: string[] = [];
  let node: Element | null = target;
  for (let depth = 0; node && depth < 4 && node.tagName !== "BODY"; depth++) {
    const tag = node.tagName.toLowerCase();
    const component = node.getAttribute("data-component");
    if (component && SAFE_COMPONENT.test(component)) {
      parts.unshift(`${tag}[data-component="${component}"]`);
      break;
    }
    if (node.id && PLAIN_ID.test(node.id)) {
      parts.unshift(`${tag}#${node.id}`);
      break;
    }
    const cls = distinctiveClass(node);
    parts.unshift(cls ? `${tag}.${cls}` : tag);
    node = node.parentElement;
  }
  const handle = parts.join(">");
  return handle.length > MAX_HANDLE_LEN ? handle.slice(-MAX_HANDLE_LEN) : handle;
};

export const labelOf = (target: EventTarget | null): string | undefined => {
  if (!isElement(target)) return undefined;
  const t = (target as HTMLElement).innerText || target.textContent || "";
  const trimmed = t.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed.slice(0, 80) : undefined;
};
