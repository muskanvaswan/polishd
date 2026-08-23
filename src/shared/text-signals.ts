/**
 * Polishd — shared "was this click about text?" heuristics.
 *
 * One source of truth used from two sides that must never drift:
 *
 *   • Live, in the browser (`src/client/dom.ts`) — deciding whether a click
 *     records as dead/rage or is just reading.
 *   • Retroactively, on the server (`src/server/reclassify.ts`) — applying the
 *     same decision to rows stored by older clients, using the stored
 *     `selector` (which keeps the same 4-level tag path the live ancestor walk
 *     sees) and `text` label in place of the DOM.
 *
 * Dependency-free and runtime-agnostic, like the rest of `shared/`.
 */

/**
 * Block-level prose containers. A click anywhere inside one — including on a
 * bold word or code span nested in it — is reading, never a dead control.
 */
export const PROSE_TAGS: ReadonlySet<string> = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6",
  "blockquote", "pre", "li", "dt", "dd", "figcaption",
]);

/**
 * Inline / cell-level text elements. These carry text but are also the exact
 * shape of a mis-wired fake control (`<span class="link">Click here</span>`),
 * so on their own they only read as prose past the length threshold below.
 */
export const INLINE_TEXT_TAGS: ReadonlySet<string> = new Set([
  "span", "em", "strong", "b", "i", "u", "s", "small", "mark", "code",
  "abbr", "cite", "q", "time", "sup", "sub", "td", "th", "caption",
]);

/** Tags the capture layer treats as interactive (see `isInteractive`). */
export const INTERACTIVE_TAGS: ReadonlySet<string> = new Set([
  "a", "button", "input", "select", "textarea", "label", "summary",
]);

/**
 * The length heuristic: standalone text this long reads as content; anything
 * shorter could be a label on something the user believed was clickable.
 * Stored `text` labels are capped at 80 chars, so the threshold must stay
 * under that cap for the retro classifier to see it.
 */
export const PROSE_MIN_CHARS = 40;

/** Tag names of a stored selector path: "div.card>p.intro>span" → ["div","p","span"]. */
export const selectorTags = (selector: string): string[] =>
  selector
    .split(">")
    .map((seg) => seg.split(/[.#]/)[0].trim().toLowerCase())
    .filter(Boolean);

/**
 * The retro mirror of the client's `isTextTarget`, over stored columns:
 * a prose tag anywhere in the selector path stands in for the ancestor walk,
 * and the stored label's length stands in for the target's own text. The label
 * is `innerText`, which includes children — so a layout container wrapping
 * prose can classify as textual here where the live check would not. For
 * history that's the right bias: these rows were recorded under rules known to
 * overcount, and reclassifying reading as reading is the point.
 */
export const isTextualClickRow = (
  selector: string | undefined,
  text: string | undefined,
): boolean => {
  if (selector && selectorTags(selector).some((t) => PROSE_TAGS.has(t))) return true;
  return (text ?? "").trim().length >= PROSE_MIN_CHARS;
};

/**
 * The single server-side retype decision, shared by the one-time history sweep
 * and the ingest backstop: a dead/rage click that landed on text becomes a
 * `text_click` (kept, counted by nothing); everything else keeps its type. A
 * rage row may have hammered a real control — the selector keeps its tag path,
 * so anything interactive in it stays rage. (Dead clicks were only ever
 * recorded on non-interactive targets — no guard needed.)
 */
export const reclassifiedClickType = (
  type: string,
  selector: string | undefined,
  text: string | undefined,
): string => {
  if (type !== "dead_click" && type !== "rage_click") return type;
  if (
    type === "rage_click" &&
    selector &&
    selectorTags(selector).some((t) => INTERACTIVE_TAGS.has(t))
  ) {
    return type;
  }
  return isTextualClickRow(selector, text) ? "text_click" : type;
};
