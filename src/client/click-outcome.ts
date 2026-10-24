/**
 * Polishd — was a click dead? Judged by what it did, not what it hit.
 *
 * Element type is only a guess at whether a click does anything. A `<div>`
 * with a listener attached by `addEventListener`, by a framework React's props
 * don't cover, or by delegation from far up the tree looks exactly like a div
 * with none. So a click on a target that isn't recognisably interactive is
 * held for a moment and judged by its outcome: if the page responded — the DOM
 * changed, the URL changed, focus moved — it was a working click. Only a click
 * after which nothing happened is dead.
 *
 * Watching starts at `pointerdown`, not at the click, because some widgets act
 * on the press: a layer that dismisses itself on `pointerdown` is already gone
 * by the time the click fires.
 *
 * THE JUDGE IS CONSERVATIVE. Reporting a click that worked as dead is a false
 * alarm on a control that's fine, and it is the one mistake that must not
 * happen; a dead click hidden by the page's own activity is the lesser one.
 * So the rules come in tiers, and the first tier never asks about background:
 *
 *  1. ALWAYS THE CLICK'S — no background check:
 *     • any change to the clicked element or inside it (unless it's `<body>`
 *       or `<html>`), or to the element carrying its click handler and its
 *       subtree;
 *     • the clicked element, or that handler element, being removed or
 *       hidden.
 *  2. SURFACES — the whole hold, no background check: a dialog, alertdialog
 *     or modal surface added, or one already in the page shown or hidden
 *     (toggled by `hidden`, `aria-hidden`, a class), and `<dialog>` opening
 *     or closing. "Shown" is what can be seen — computed `visibility` and
 *     `opacity` as well as a box — so a fade-in counts, and since a fade
 *     starts at opacity 0, the end of the hold looks again.
 *  3. RELATED, IF NOT BACKGROUND:
 *     • on one of the four nearest ancestors: any attribute but `style`;
 *       children added or removed if the ancestor is component-sized, only
 *       removals if it's page-sized (where portals get appended);
 *     • near the click: an element within 64px of the click point, or of the
 *       clicked element's own box — the details a card reveals under itself,
 *       the panel an accordion header opens or closes. Positions are taken
 *       from the layout remembered at the click when the element is now hidden
 *       or gone, so a collapsing panel still has a place;
 *     • a menu or listbox opening, a toast near the click or within 300ms;
 *     • none of it after the pointer has moved on, for changes under where it
 *       moved (hover) or appended to the page itself (portals: hover cards,
 *       tooltips) more than 300ms after the click.
 *
 * Background is the page's own churn, learned all the time: a change is kept
 * against its node (children against their container, by kind of child;
 * text against its element; an attribute against its element, and — for
 * attributes other than `class` and `style` — against its parent, so every
 * slide of a carousel feeds one `aria-hidden` history). Something is
 * background while its history has at least two separate changes in the ten
 * seconds before the click — one change isn't a pattern, and one instant
 * (a batch of records) is one change — and only then: history expires.
 * Insertion is birth, not churn: a node counts in its container's history,
 * never its own, and a node inserted into a busy container (a new chat
 * message) is background inside only while it's being filled in, for its
 * first second. Learning pauses for the second after
 * a press or click — what follows a click is that click's — and skips changes
 * inside the focused element (typing), never scrolling. Changes credited to a
 * judged click are never learned.
 *
 * Also never a response: polishd's own UI (`[data-polishd-ui]`), and a newer
 * interaction's effects — once a newer press, click, key press or scroll
 * begins, an older click only keeps tier 1 for its own element (not inside
 * the newer target, and nothing once the newer click landed inside it), and
 * its URL and focus are judged as they were at that moment. A repeat click on
 * the same element shares credit.
 *
 * KNOWN RESIDUALS — accepted, not bugs to chase:
 *
 *  • Tier 1 has no background check, so anything that keeps changing the
 *    clicked element on its own credits clicks on it: an autoplay carousel
 *    swapping out the slide you clicked, a hover animation on the clicked
 *    card, a ticking clock inside it. A click on a page-sized wrapper
 *    (`<main>`, an app root) is credited by any change inside it.
 *  • Rotations inside a focused, component-sized carousel aren't learned as
 *    background (typing is skipped by the same rule) and can mask its dead
 *    clicks.
 *  • A plain `<div>` whose only effect is far from it and isn't a dialog
 *    reads as dead.
 *  • A role="dialog" hover card opening as the pointer moves on credits the
 *    click: surfaces get the whole hold.
 *  • The first change a busy region ever makes has no history, and credits a
 *    click near it during the hold; a second of steady clicking pauses
 *    learning.
 *  • `showPopover()` and CSS-only effects make no DOM mutation and read as
 *    dead.
 *  • A region that changes less than twice in ten seconds (a carousel turning
 *    every six) isn't background, and its next change credits a dead click
 *    near it.
 *  • Carousels and dots that change state only by `class` don't share a
 *    history between siblings, so a stacked class-based carousel or its dots
 *    can mask a dead click near them.
 *  • Details revealed 100–130px from the clicked element — a child deep inside
 *    a card, the details below the card — are past the reach of "near" and
 *    read as dead.
 *  • A hover menu that opens within 300ms of the click credits it.
 *  • Typing in a component-sized contenteditable costs one rect read per
 *    mutation record (to tell it from page churn).
 *
 * Import-free, with the browser behind {@link JudgeEnv}, so `node --test` can
 * drive it with fakes.
 */

/** How long a click on a non-interactive target waits for the page to respond. */
export const DEAD_CLICK_HOLD_MS = 1000;
/** A node that changed this recently before an interaction is background. */
export const BACKGROUND_MS = 10_000;
/** Page-level changes after the pointer moves on only count this soon after the click. */
export const PAGE_LEVEL_GRACE_MS = 300;
/** How close to the click point, or to the clicked element, a change must be. */
export const NEAR_PX = 64;
/** How long a press waits for its click before it's dropped (a drag, a scroll). */
const ARM_MS = 3000;
/** Ancestors of the clicked element whose changes are in the click's scope. */
const ANCESTOR_DEPTH = 4;
/** How far up a mutation's node to look for one inserted into a busy container. */
const BORN_DEPTH = 8;
/** Post-click hover targets remembered per click. */
const MAX_HOVERED = 8;
/** Background change times kept per key. */
const BACKGROUND_KEPT = 4;
/** Separate changes within the baseline it takes to call something background. */
const BACKGROUND_CHANGES = 2;
/** How long after a node's insertion its own filling-in still counts as that insertion. */
const BIRTH_MS = 1000;

/** A modal surface: what a click that opens a dialog adds or reveals. */
export const MODAL_SELECTOR = [
  "dialog", '[role="dialog"]', '[role="alertdialog"]', '[aria-modal="true"]',
].join(",");

/** A menu or listbox: opened by a click, or by hover — only before the pointer moves on. */
export const MENU_SELECTOR = '[role="menu"],[role="listbox"]';

/** An announcement — a toast — which only counts near the click. */
export const ANNOUNCEMENT_SELECTOR = '[role="status"],[role="alert"]';

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The slice of a DOM node the judge reads. */
export interface NodeLike {
  nodeName: string;
  /** 1 for an element. */
  nodeType?: number;
  parentNode?: NodeLike | null;
  /** Inclusive, like `Node.contains`. */
  contains(other: unknown): boolean;
  matches?(selector: string): boolean;
  querySelector?(selector: string): unknown;
}

/** The slice of a `MutationRecord` the judge reads. */
export interface MutationLike {
  type: string;
  target: NodeLike;
  attributeName?: string | null;
  addedNodes?: ArrayLike<NodeLike>;
  removedNodes?: ArrayLike<NodeLike>;
}

/** The browser, as the judge sees it. */
export interface JudgeEnv {
  now(): number;
  href(): string;
  activeElement(): unknown;
  /** Is this element small enough — a bar, a card — to be a component rather than layout? */
  isComponentSized(node: NodeLike): boolean;
  /** Is it rendered at all (connected, with a box)? */
  isVisible(node: NodeLike): boolean;
  /**
   * Can it be seen — rendered, and not `visibility: hidden` or faded to
   * `opacity: 0`, itself or through an ancestor? How a modal surface already
   * in the page is judged shown: a fade-in has a box before and after.
   */
  isShown(node: NodeLike): boolean;
  /**
   * Where the element holding `node` is on screen — its box now, or, when it
   * is hidden or gone, the box last remembered for it. Null if neither.
   */
  rectOf(node: NodeLike): Rect | null;
  /** Remember the layout around a clicked element, for nodes that hide or go later. */
  remember(subject: NodeLike): void;
  /** The element carrying `node`'s click handler a few levels up, if any (React `onClick`). */
  handlerOf(node: NodeLike): NodeLike | null;
  /** The modal surfaces shown right now (see `isShown`). */
  visibleSurfaces(): NodeLike[];
  /** What kind of child a node is, for its container's history: tag and first class. */
  kindOf(node: NodeLike): string;
  /** Is this node part of polishd's own UI? Its changes are never a response. */
  isOwn(node: NodeLike): boolean;
  /** Deliver every mutation in the document from now on (the judge never stops it). */
  observe(onRecords: (records: readonly MutationLike[]) => void): void;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Nodes whose arrival or departure changes nothing on screen. */
const NON_RENDERING = new Set(["SCRIPT", "STYLE", "LINK", "META", "NOSCRIPT", "TEMPLATE", "#COMMENT"]);
/** Too big to have an "inside" worth crediting. */
const DOCUMENT_LEVEL = new Set(["BODY", "HTML"]);

const isElement = (n: NodeLike) =>
  n.nodeType === 1 || (n.nodeType === undefined && !n.nodeName.startsWith("#"));

const renders = (n: NodeLike, elementsOnly: boolean) =>
  !NON_RENDERING.has(n.nodeName.toUpperCase()) && (!elementsOnly || isElement(n));

const distanceToRect = (p: Point, r: Rect) =>
  Math.hypot(Math.max(r.left - p.x, 0, p.x - r.right), Math.max(r.top - p.y, 0, p.y - r.bottom));

const gapBetween = (a: Rect, b: Rect) =>
  Math.hypot(
    Math.max(a.left - b.right, 0, b.left - a.right),
    Math.max(a.top - b.bottom, 0, b.top - a.bottom),
  );

/** Hold a node without keeping it alive. */
interface Weak<T> {
  deref(): T | undefined;
}
const weak = <T extends object>(value: T): Weak<T> =>
  typeof WeakRef === "function" ? new WeakRef(value) : { deref: () => value };

interface Gesture {
  subject: NodeLike;
  /** Everything this gesture was about — the press's target, the click's, their handlers. */
  owners: NodeLike[];
  /** `subject` is component-sized, so its box is worth measuring from. */
  local: boolean;
  /** The clicked element's box at the click. */
  box: Rect | null;
  /** Nearest ancestors, and whether each is component-sized. */
  ancestors: Map<NodeLike, boolean>;
  /** Modal surfaces shown when the interaction began. */
  surfaces: Set<NodeLike>;
  /** Modal surfaces whose attributes changed during the hold. */
  touchedSurfaces: Set<NodeLike>;
  point: Point | null;
  /** The interaction this gesture belongs to; older than the current one = superseded. */
  epoch: number;
  /** When its interaction began — "background" looks back from here. */
  start: number;
  /** When the click arrived; unset while it's still a press. */
  clickAt?: number;
  href: string;
  active: unknown;
  /** URL and focus when a newer interaction began, which is what this one is judged on. */
  superseded?: { href: string; active: unknown };
  /** When the pointer first moved onto something other than the clicked element. */
  hoveredAt?: number;
  /** Component-sized elements the pointer moved onto after the click. */
  hovered: NodeLike[];
  /** Something creditable already happened. */
  worked: boolean;
  /** Set once the click arrives; an armed press without one emits nothing. */
  done?: (worked: boolean) => void;
  timer?: unknown;
}

export interface ClickJudge {
  /**
   * A press or click began on `target` — any target, control or not, so
   * that what follows is credited to it rather than to older clicks. Call at
   * every primary `pointerdown` and every click, before `arm`/`judge`/`release`.
   */
  begin(target: NodeLike, kind: "press" | "click"): void;
  /** Some other interaction began — a key press, a wheel or touch scroll. */
  interact(): void;
  /** The pointer moved onto `target` (`pointerover`). Hover is not a response. */
  hover(target: NodeLike): void;
  /** A press on a non-interactive target: start watching for its effects. */
  arm(subject: NodeLike, point?: Point | null): void;
  /** The click went somewhere that needs no judging, or the press was cancelled. */
  release(): void;
  /**
   * Judge a click on `subject` at `point`. `done` runs once: with `true` as
   * soon as the page responds, or after the hold with whether the URL or
   * focus moved.
   */
  judge(subject: NodeLike, done: (worked: boolean) => void, point?: Point | null): void;
  /**
   * The page is going away (unloading, or hidden behind a tab the click may
   * have opened): settle every pending click as working, synchronously, so
   * the caller can flush it in the same breath. A page that leaves within a
   * second of a click most likely left because of it.
   */
  settleAll(): void;
  /** Gestures still being watched. Test seam. */
  pending(): number;
}

export function createClickJudge(
  env: JudgeEnv,
  { holdMs = DEAD_CLICK_HOLD_MS, armMs = ARM_MS }: { holdMs?: number; armMs?: number } = {},
): ClickJudge {
  const live = new Set<Gesture>();
  /** Per node, per key: when the page last changed it on its own. */
  const history = new WeakMap<object, Map<string, number[]>>();
  /** Nodes inserted into a container that kept receiving their kind. */
  const born = new WeakMap<object, { container: Weak<object>; key: string; at: number }>();
  let armed: Gesture | null = null;
  let epoch = 0;
  /** Target of the newest press or click; unset after a key press or scroll. */
  let latestRef: Weak<NodeLike> | null = null;
  const latest = () => latestRef?.deref() ?? null;
  /** When the press whose click hasn't arrived yet began, or null. */
  let pressedAt: number | null = null;
  /** When someone last pressed or clicked — learning pauses for a hold after. */
  let lastPress = -Infinity;

  // ---- background --------------------------------------------------------------

  const added = (m: MutationLike) => Array.from(m.addedNodes ?? []).filter((n) => !env.isOwn(n));
  const removed = (m: MutationLike) => Array.from(m.removedNodes ?? []).filter((n) => !env.isOwn(n));
  const changed = (m: MutationLike) => [...added(m), ...removed(m)];

  /**
   * Where a change is kept: children against their container, by kind of
   * child; text against its element; an attribute against its element and —
   * unless it's `class` or `style`, which every clickable dot and tab swaps
   * on its own — against its parent, so siblings share a history.
   */
  const keysOf = (m: MutationLike): Array<[object, string]> => {
    if (m.type === "characterData") return [[m.target.parentNode ?? m.target, "text"]];
    if (m.type === "attributes") {
      const name = m.attributeName ?? "";
      const keys: Array<[object, string]> = [[m.target, `@${name}`]];
      if (m.target.parentNode && name !== "class" && name !== "style") {
        keys.push([m.target.parentNode, `>@${name}`]);
      }
      return keys;
    }
    // Raw nodes: this runs on every mutation, judged or not, and polishd's own
    // UI in the history is harmless.
    const nodes = [...Array.from(m.addedNodes ?? []), ...Array.from(m.removedNodes ?? [])];
    return nodes.map((n) => [m.target, `+${env.kindOf(n)}`] as [object, string]);
  };

  const remember = (node: object, key: string, now: number) => {
    let keys = history.get(node);
    if (!keys) history.set(node, (keys = new Map()));
    const times = keys.get(key) ?? [];
    // One instant is one change: a batch of twenty cards doesn't flush the
    // history with twenty copies of "now".
    if (times[times.length - 1] === now) return;
    times.push(now);
    if (times.length > BACKGROUND_KEPT) times.shift();
    keys.set(key, times);
  };

  /**
   * Is `node` busy this way: at least two separate changes in the ten seconds
   * before `since`? One change isn't a pattern — page script collapsing the
   * panels once, three seconds before a click that opens one, is not churn.
   */
  const recent = (node: object, key: string, since: number) => {
    const times = history.get(node)?.get(key);
    if (!times) return false;
    let changes = 0;
    for (const t of times) if (t < since && since - t <= BACKGROUND_MS) changes++;
    return changes >= BACKGROUND_CHANGES;
  };

  /** Is this change, at `now`, the page's own — its node busy before `since`? */
  const isBackground = (m: MutationLike, since: number, now: number): boolean => {
    if (keysOf(m).some(([node, key]) => recent(node, key, since))) return true;
    // A node born into a busy container is filled in as part of that insertion
    // (a streamed chat message's paragraphs) — so for its first second its
    // own changes are the container's churn. After that they're its own: a
    // card appended by infinite scroll expands like any other.
    let node: NodeLike | null | undefined = m.target;
    for (let depth = 0; node && depth < BORN_DEPTH; depth++, node = node.parentNode) {
      const birth = born.get(node);
      const container = birth?.container.deref();
      if (birth && container && now - birth.at <= BIRTH_MS && recent(container, birth.key, since)) {
        return true;
      }
    }
    return false;
  };

  // ---- relating a mutation to a click ----------------------------------------------

  const matching = (nodes: NodeLike[], selector: string) =>
    nodes.some((n) => isElement(n) && (!!n.matches?.(selector) || !!n.querySelector?.(selector)));

  const underHovered = (g: Gesture, node: NodeLike) => g.hovered.some((h) => h.contains(node));
  const pageLevelAllowed = (g: Gesture, now: number) =>
    g.hoveredAt === undefined || g.clickAt === undefined || now - g.clickAt <= PAGE_LEVEL_GRACE_MS;

  /** Does this change show something — not just restyle it, not add a script? */
  const visible = (m: MutationLike, styleCounts: boolean): boolean => {
    if (m.type === "childList") return changed(m).some((n) => renders(n, false));
    if (m.type === "attributes") return styleCounts || m.attributeName !== "style";
    return m.type === "characterData";
  };

  /** Tier 1: the clicked element (or its handler) changed, went away, or was hidden. */
  const ownChange = (g: Gesture, m: MutationLike): boolean => {
    const owners = g.owners.filter((o) => !DOCUMENT_LEVEL.has(o.nodeName.toUpperCase()));
    if (owners.some((o) => o.contains(m.target))) return visible(m, true);
    if (m.type === "childList") {
      return removed(m).some((n) => g.owners.some((o) => n.contains(o)));
    }
    // An ancestor's change that hid it.
    return (
      m.type === "attributes" &&
      g.owners.some((o) => m.target.contains(o)) &&
      g.owners.some((o) => !env.isVisible(o))
    );
  };

  /** Tier 2: a modal surface appeared, or one already in the page was shown or hidden. */
  const surfaceChange = (g: Gesture, m: MutationLike): boolean => {
    if (m.type === "childList") return matching(added(m), MODAL_SELECTOR);
    if (m.type !== "attributes") return false;
    if (m.attributeName === "open" && m.target.nodeName === "DIALOG") return true;
    const surface = m.target.matches?.(MODAL_SELECTOR)
      ? m.target
      : (m.target.querySelector?.(MODAL_SELECTOR) as NodeLike | null | undefined);
    if (!surface) return false;
    // A fade-in starts at opacity 0, so it may not read as shown yet: the
    // hold's end looks again (see `outcome`).
    g.touchedSurfaces.add(surface);
    return env.isShown(surface) !== g.surfaces.has(surface);
  };

  /** Tier 3, ancestors: is this a change on one of the nearest ancestors? */
  const ancestorChange = (g: Gesture, m: MutationLike, now: number): boolean => {
    const local = g.ancestors.get(m.target);
    const pageSizedSelf = m.target === g.subject && DOCUMENT_LEVEL.has(m.target.nodeName.toUpperCase());
    if (local === undefined && !pageSizedSelf) return false;
    if (m.type === "attributes") return m.attributeName !== "style";
    if (m.type !== "childList") return false;
    if (local) return visible(m, false);
    // A page-sized container: only something closing counts.
    return pageLevelAllowed(g, now) && removed(m).some((n) => renders(n, true));
  };

  /** Tier 3, nearby: is the changed element near the click point or the clicked element? */
  const nearClick = (g: Gesture, m: MutationLike, now: number): boolean => {
    const close = (n: NodeLike) => {
      if (g.owners.some((o) => n.contains(o))) return false; // an ancestor: not "beside"
      const r = env.rectOf(n);
      if (!r) return false;
      if (g.point) {
        const d = distanceToRect(g.point, r);
        // Inside a page-sized element everything is "near".
        if (d <= NEAR_PX && (d > 0 || env.isComponentSized(n))) return true;
      }
      return !!g.box && gapBetween(g.box, r) <= NEAR_PX;
    };
    if (m.type === "childList") {
      // Appended to the page itself: a portal, which only counts before the
      // pointer moved on.
      if (!env.isComponentSized(m.target) && !pageLevelAllowed(g, now)) return false;
      const shown = added(m).filter((n) => renders(n, true));
      return shown.some(close) || close(m.target);
    }
    return close(m.target);
  };

  const credits = (g: Gesture, m: MutationLike, now: number): boolean => {
    if (env.isOwn(m.target) || underHovered(g, m.target)) return false;

    const newer = latest();
    if (g.epoch !== epoch && !(newer && g.owners.includes(newer))) {
      // Superseded: its own element only, and not what the newer click
      // explains — inside the newer target, or anything once the newer click
      // landed inside this one's element (a bar, then the button in it).
      if (newer && (newer.contains(m.target) || g.owners.some((o) => o.contains(newer)))) return false;
      return ownChange(g, m);
    }

    // Tier 1.
    if (ownChange(g, m)) return true;
    // Tier 2.
    if (surfaceChange(g, m)) return true;
    // Tier 3: cheap tests before any layout read.
    if (m.type === "childList") {
      const shown = added(m);
      if (matching(shown, MENU_SELECTOR)) return pageLevelAllowed(g, now);
      if (matching(shown, ANNOUNCEMENT_SELECTOR)) {
        if (isBackground(m, g.start, now)) return false;
        const quick = g.clickAt !== undefined && now - g.clickAt <= PAGE_LEVEL_GRACE_MS;
        return quick || nearClick(g, m, now);
      }
    }
    if (ancestorChange(g, m, now)) return !isBackground(m, g.start, now);
    if (!visible(m, false) || isBackground(m, g.start, now)) return false;
    return nearClick(g, m, now);
  };

  // ---- gestures --------------------------------------------------------------

  const finish = (g: Gesture, worked: boolean) => {
    if (!live.delete(g)) return;
    env.clearTimeout(g.timer);
    if (armed === g) armed = null;
    g.done?.(worked);
  };

  /** Typing changes the focused element (a contenteditable); that's not the page churning. */
  const inFocused = (node: NodeLike) => {
    const active = env.activeElement() as NodeLike | null;
    // `contains` first, and never the body: no layout read on the common path.
    if (!active?.contains || DOCUMENT_LEVEL.has(active.nodeName?.toUpperCase?.() ?? "")) return false;
    return active.contains(node) && env.isComponentSized(active);
  };

  env.observe((records) => {
    const now = env.now();
    const learning = now - lastPress > holdMs;
    for (const m of records) {
      // A child born into a container that kept receiving its kind (a new
      // chat message) carries the container's churn into its own subtree —
      // for as long as the container stays busy. Earlier changes only: a list
      // rendered in one batch is not background to itself.
      if (m.type === "childList") {
        for (const n of Array.from(m.addedNodes ?? [])) {
          const key = `+${env.kindOf(n)}`;
          if (recent(m.target, key, now)) born.set(n, { container: weak(m.target), key, at: now });
        }
      }
      let credited = false;
      // Nothing to judge without a pending click: only the bookkeeping below.
      for (const g of live) {
        if (g.worked || !credits(g, m, now)) continue;
        credited = true;
        g.worked = true;
      }
      // What a judged click caused is that click's, and what follows any press
      // or click is too — neither is the page's own churn.
      if (!credited && learning && !inFocused(m.target)) {
        for (const [node, key] of keysOf(m)) remember(node, key, now);
      }
    }
    for (const g of [...live]) if (g.worked && g.done) finish(g, true);
  });

  const setSubject = (g: Gesture, subject: NodeLike) => {
    g.subject = subject;
    for (const owner of [subject, env.handlerOf(subject)]) {
      if (owner && !g.owners.includes(owner)) g.owners.push(owner);
    }
    g.local = env.isComponentSized(subject);
    env.remember(subject);
    g.box = g.local ? env.rectOf(subject) : null;
    g.ancestors = new Map();
    let node = subject.parentNode ?? null;
    for (let depth = 0; node && depth < ANCESTOR_DEPTH; depth++, node = node.parentNode ?? null) {
      if (isElement(node)) g.ancestors.set(node, env.isComponentSized(node));
    }
  };

  const track = (subject: NodeLike, point: Point | null): Gesture => {
    const g = {
      owners: [],
      point,
      epoch,
      start: env.now(),
      href: env.href(),
      active: null,
      hovered: [],
      surfaces: new Set(env.visibleSurfaces()),
      touchedSurfaces: new Set(),
      worked: false,
    } as unknown as Gesture;
    setSubject(g, subject);
    live.add(g);
    return g;
  };

  const supersede = () => {
    epoch++;
    if (armed) finish(armed, false); // a press that never clicked
    const snapshot = { href: env.href(), active: env.activeElement() };
    for (const g of live) g.superseded ??= snapshot;
  };

  const outcome = (g: Gesture): boolean => {
    if (g.worked) return true;
    // A surface the hold touched that has since faded in (or out).
    for (const s of g.touchedSurfaces) if (env.isShown(s) !== g.surfaces.has(s)) return true;
    const now = g.superseded ?? { href: env.href(), active: env.activeElement() };
    return now.href !== g.href || now.active !== g.active;
  };

  return {
    begin(target, kind) {
      const now = env.now();
      lastPress = now;
      latestRef = weak(target);
      // A click that follows its own press is the same interaction.
      if (kind === "click" && pressedAt !== null && now - pressedAt <= armMs) {
        pressedAt = null;
        return;
      }
      pressedAt = kind === "press" ? now : null;
      supersede();
    },

    interact() {
      // Jitter during a press (a tap's touchmove) belongs to that press.
      if (pressedAt !== null && env.now() - pressedAt <= armMs) return;
      latestRef = null;
      supersede();
    },

    hover(target) {
      if (live.size === 0) return;
      const now = env.now();
      for (const g of live) {
        // Before the click it's the approach; within the subject, or onto
        // something containing it, the pointer hasn't left.
        if (g.clickAt === undefined || g.subject.contains(target) || target.contains(g.subject)) continue;
        g.hoveredAt ??= now;
        if (g.hovered.length < MAX_HOVERED && env.isComponentSized(target)) g.hovered.push(target);
      }
    },

    arm(subject, point = null) {
      if (armed) finish(armed, false);
      const g = track(subject, point);
      armed = g;
      g.timer = env.setTimeout(() => {
        pressedAt = null;
        finish(g, false);
      }, armMs);
    },

    release() {
      pressedAt = null;
      if (armed) finish(armed, false);
    },

    judge(subject, done, point = null) {
      const g = armed ?? track(subject, point);
      armed = null;
      env.clearTimeout(g.timer);
      // The click may land somewhere other than the press did (the pressed
      // layer removed itself); what it did since the press still counts, and
      // from here on it's judged against what was clicked too.
      if (g.subject !== subject) setSubject(g, subject);
      if (point) g.point = point;
      g.clickAt = env.now();
      g.done = done;
      // Focus is read now, not at the press: the browser's own focus change on
      // mousedown happens between the two and is nobody's handler responding.
      g.active = env.activeElement();
      if (g.worked) {
        finish(g, true);
        return;
      }
      g.timer = env.setTimeout(() => finish(g, outcome(g)), holdMs);
    },

    settleAll() {
      for (const g of [...live]) finish(g, true);
    },

    pending: () => live.size,
  };
}
