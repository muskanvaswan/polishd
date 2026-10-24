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
 * The hard part is not mistaking the page's own activity for a response.
 * Timers, carousels, spinners, chat streams and hover cards mutate the DOM
 * constantly, so a mutation only counts when it is *related to the click*:
 *
 *  • Inside the clicked element, when that element is component-sized (a
 *    bar, a card): anything — children, attributes, text. Inside `<body>` or a
 *    page wrapper "inside" means nothing, so a page-sized target only counts
 *    the changes listed for page-sized ancestors below.
 *  • On one of its four nearest ancestors: any attribute but `style`; and
 *    children added or removed, if the ancestor is component-sized. A
 *    page-sized ancestor (where portals, tooltips and toasts get appended)
 *    only counts elements removed from it — something closing.
 *  • Beside it, inside its parent, when the parent is component-sized: the
 *    details revealed under a clicked card, an accordion's body. Anything but
 *    `style`.
 *  • The clicked element itself being removed, wherever from.
 *  • On a component-sized element under the click point (an overlapping
 *    layer, an image swapped beneath the pointer): anything but `style`.
 *  • A dialog, menu, listbox or modal surface added to the page, or a
 *    `<dialog>` opening or closing.
 *  • A status or alert — a toast — only beside the click (inside it, or under
 *    the click point), or within 300ms of it in a container that wasn't
 *    already busy. A spinner re-rendering every second is not a response.
 *
 * And even a related mutation is discounted when:
 *
 *  • It's background: the same node (for children, the container they're
 *    added to) changed the same way at any point in the ten seconds before the
 *    interaction began. An autoplaying carousel, a stream, a polling spinner.
 *    Changes made within a second of someone's press, click, key press or
 *    scroll, and changes credited to a judged click, are that interaction's
 *    and never count as background — so a panel a button opened can still
 *    close in response to a click.
 *  • It's under an element the pointer moved onto after the click, which is
 *    hover, not the click. Once the pointer has left the clicked element,
 *    page-level changes — surfaces, things removed from page-sized
 *    containers — only count within 300ms of the click: hover UI waits for a
 *    hover delay, a click's own render doesn't.
 *  • It's polishd's own UI (anything inside `[data-polishd-ui]`).
 *  • A newer interaction began: a visitor whose click on a bar did nothing
 *    goes on to click the button in it, and the list that button opens must
 *    not make the bar's click look like it worked. Once a newer press, click,
 *    key press or scroll begins, an older click only gains credit inside its
 *    own component-sized scope (not inside the newer target), and its URL and
 *    focus are judged as they were at that moment. A repeat click on the same
 *    element shares credit: which one the page answered can't be told apart.
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
/** How long a press waits for its click before it's dropped (a drag, a scroll). */
const ARM_MS = 3000;
/** Ancestors of the clicked element whose changes are in the click's scope. */
const ANCESTOR_DEPTH = 4;
/** Post-click hover targets remembered per click. */
const MAX_HOVERED = 8;
/** Background change times kept per node and kind. */
const BACKGROUND_KEPT = 4;

/** A newly opened surface: what a click that opens something adds. */
export const SURFACE_SELECTOR = [
  "dialog", '[role="dialog"]', '[role="alertdialog"]', '[role="menu"]', '[role="listbox"]',
  '[aria-modal="true"]',
].join(",");

/** An announcement — a toast — which only counts beside the click. */
export const ANNOUNCEMENT_SELECTOR = '[role="status"],[role="alert"]';

export interface Point {
  x: number;
  y: number;
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
  /** Is this node, or the element holding it, component-sized and under `point`? */
  isUnderPoint(node: NodeLike, point: Point): boolean;
  /** Is this node part of polishd's own UI? Its changes are never a response. */
  isOwn(node: NodeLike): boolean;
  /** Deliver every mutation in the document from now on (the judge never stops it). */
  observe(onRecords: (records: readonly MutationLike[]) => void): void;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Nodes whose arrival or departure changes nothing on screen. */
const NON_RENDERING = new Set(["SCRIPT", "STYLE", "LINK", "META", "NOSCRIPT", "TEMPLATE", "#COMMENT"]);

const isElement = (n: NodeLike) =>
  n.nodeType === 1 || (n.nodeType === undefined && !n.nodeName.startsWith("#"));

const renders = (n: NodeLike, elementsOnly: boolean) =>
  !NON_RENDERING.has(n.nodeName.toUpperCase()) && (!elementsOnly || isElement(n));

interface Gesture {
  subject: NodeLike;
  /** Everything this gesture was about — the press's target and the click's. */
  subjects: NodeLike[];
  /** `subject` is component-sized, so changes inside it are its own. */
  local: boolean;
  /** Nearest ancestors, and whether each is component-sized. */
  ancestors: Map<NodeLike, boolean>;
  /** The subject's parent, when it's component-sized: siblings' changes are related. */
  container: NodeLike | null;
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
  /** Per node, per kind of change: when it last changed on its own. */
  const background = new WeakMap<object, Map<string, number[]>>();
  let armed: Gesture | null = null;
  let epoch = 0;
  /** Target of the newest press or click; null after a key press or scroll. */
  let latest: NodeLike | null = null;
  /** When the press whose click hasn't arrived yet began, or null. */
  let pressedAt: number | null = null;
  /** When someone last pressed, clicked, typed or scrolled. */
  let lastInteraction = -Infinity;

  // ---- background --------------------------------------------------------------

  /** Where a change is kept: children by their container, text by its element. */
  const keyOf = (m: MutationLike): [object, string] => {
    if (m.type === "characterData") return [m.target.parentNode ?? m.target, "text"];
    return [m.target, m.type === "attributes" ? `@${m.attributeName}` : m.type];
  };

  const noteBackground = (m: MutationLike, now: number) => {
    const [node, kind] = keyOf(m);
    let kinds = background.get(node);
    if (!kinds) background.set(node, (kinds = new Map()));
    const times = kinds.get(kind) ?? [];
    times.push(now);
    if (times.length > BACKGROUND_KEPT) times.shift();
    kinds.set(kind, times);
  };

  /** Did this node change this way in the ten seconds before `since`? */
  const isBackground = (m: MutationLike, since: number): boolean => {
    const [node, kind] = keyOf(m);
    const times = background.get(node)?.get(kind);
    return !!times?.some((t) => t < since && since - t <= BACKGROUND_MS);
  };

  // ---- relating a mutation to a click ----------------------------------------------

  const added = (m: MutationLike) => Array.from(m.addedNodes ?? []).filter((n) => !env.isOwn(n));
  const removed = (m: MutationLike) => Array.from(m.removedNodes ?? []).filter((n) => !env.isOwn(n));
  const matching = (nodes: NodeLike[], selector: string) =>
    nodes.some((n) => isElement(n) && (!!n.matches?.(selector) || !!n.querySelector?.(selector)));

  const opensSurface = (m: MutationLike): boolean => {
    if (m.type === "attributes") return m.attributeName === "open" && m.target.nodeName === "DIALOG";
    return m.type === "childList" && matching(added(m), SURFACE_SELECTOR);
  };

  const inSubject = (g: Gesture, node: NodeLike) => g.local && g.subject.contains(node);
  const underHovered = (g: Gesture, node: NodeLike) => g.hovered.some((h) => h.contains(node));
  const pageLevelAllowed = (g: Gesture, now: number) =>
    g.hoveredAt === undefined || g.clickAt === undefined || now - g.clickAt <= PAGE_LEVEL_GRACE_MS;

  /** Is this a change in the subject's own scope — its subtree, or an ancestor? */
  const scopeChange = (g: Gesture, m: MutationLike, now: number): boolean => {
    if (inSubject(g, m.target)) {
      if (m.type === "childList") return [...added(m), ...removed(m)].some((n) => renders(n, false));
      return m.type === "attributes" || m.type === "characterData";
    }
    const pageSizedSelf = !g.local && m.target === g.subject;
    const ancestorLocal = g.ancestors.get(m.target);
    if (!pageSizedSelf && ancestorLocal === undefined) {
      // Beside the subject, under a component-sized parent.
      if (!g.container?.contains(m.target)) return false;
      if (m.type === "childList") return [...added(m), ...removed(m)].some((n) => renders(n, false));
      return m.type === "characterData" || (m.type === "attributes" && m.attributeName !== "style");
    }
    if (m.type === "attributes") return m.attributeName !== "style";
    if (m.type !== "childList") return false;
    if (ancestorLocal) return [...added(m), ...removed(m)].some((n) => renders(n, false));
    // A page-sized container: only something closing counts.
    return pageLevelAllowed(g, now) && removed(m).some((n) => renders(n, true));
  };

  const credits = (g: Gesture, m: MutationLike, now: number): boolean => {
    if (env.isOwn(m.target) || underHovered(g, m.target)) return false;

    // The clicked thing itself went away: a dismissal, whatever else is going on.
    if (m.type === "childList" && removed(m).some((n) => g.subjects.some((s) => n.contains(s)))) {
      return true;
    }

    if (g.epoch !== epoch && g.subject !== latest) {
      // Superseded: only its own component's changes, not the newer target's
      // — and none at all when the newer click landed inside this one's
      // element (a bar, then the button in it): the inner click explains them.
      const own = inSubject(g, m.target) || g.ancestors.get(m.target) === true;
      return (
        own &&
        !(latest && (latest.contains(m.target) || g.subject.contains(latest))) &&
        !isBackground(m, g.start) &&
        scopeChange(g, m, now) === true
      );
    }

    if (scopeChange(g, m, now) && !isBackground(m, g.start)) return true;

    if (opensSurface(m)) return pageLevelAllowed(g, now);

    const near = !!g.point && env.isUnderPoint(m.target, g.point);
    if (m.type === "childList" && matching(added(m), ANNOUNCEMENT_SELECTOR)) {
      if (near) return !isBackground(m, g.start);
      return (
        g.clickAt !== undefined && now - g.clickAt <= PAGE_LEVEL_GRACE_MS && !isBackground(m, g.start)
      );
    }

    if (!near || isBackground(m, g.start)) return false;
    if (m.type === "childList") return [...added(m), ...removed(m)].some((n) => renders(n, false));
    return m.type === "characterData" || (m.type === "attributes" && m.attributeName !== "style");
  };

  // ---- gestures --------------------------------------------------------------

  const finish = (g: Gesture, worked: boolean) => {
    if (!live.delete(g)) return;
    env.clearTimeout(g.timer);
    if (armed === g) armed = null;
    g.done?.(worked);
  };

  env.observe((records) => {
    const now = env.now();
    for (const m of records) {
      let credited = false;
      for (const g of [...live]) {
        if (g.worked || !credits(g, m, now)) continue;
        credited = true;
        g.worked = true;
        if (g.done) finish(g, true);
      }
      // What follows an interaction is that interaction's doing, and what a
      // judged click caused is that click's — neither is the page's own churn.
      if (!credited && now - lastInteraction > holdMs) noteBackground(m, now);
    }
  });

  const setSubject = (g: Gesture, subject: NodeLike) => {
    g.subject = subject;
    if (!g.subjects.includes(subject)) g.subjects.push(subject);
    g.local = env.isComponentSized(subject);
    const parent = subject.parentNode ?? null;
    g.container = parent && isElement(parent) && env.isComponentSized(parent) ? parent : null;
    g.ancestors = new Map();
    let node = subject.parentNode ?? null;
    for (let depth = 0; node && depth < ANCESTOR_DEPTH; depth++, node = node.parentNode ?? null) {
      if (isElement(node)) g.ancestors.set(node, env.isComponentSized(node));
    }
  };

  const track = (subject: NodeLike, point: Point | null): Gesture => {
    const g = {
      subjects: [],
      point,
      epoch,
      start: env.now(),
      href: env.href(),
      active: null,
      hovered: [],
      worked: false,
    } as unknown as Gesture;
    setSubject(g, subject);
    live.add(g);
    return g;
  };

  const supersede = () => {
    lastInteraction = env.now();
    epoch++;
    if (armed) finish(armed, false); // a press that never clicked
    const snapshot = { href: env.href(), active: env.activeElement() };
    for (const g of live) g.superseded ??= snapshot;
  };

  const outcome = (g: Gesture): boolean => {
    if (g.worked) return true;
    const now = g.superseded ?? { href: env.href(), active: env.activeElement() };
    return now.href !== g.href || now.active !== g.active;
  };

  return {
    begin(target, kind) {
      const now = env.now();
      lastInteraction = now;
      latest = target;
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
      latest = null;
      supersede();
    },

    hover(target) {
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
      // from here on it's judged against what was clicked.
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
