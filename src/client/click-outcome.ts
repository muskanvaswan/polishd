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
 * The two ways to get this wrong, in the order they matter: a click that
 * worked reported dead (a false alarm on a control that's fine), and a dead
 * click hidden by the page's own activity. The rules below lean toward the
 * first being rare.
 *
 * WHAT COUNTS. Only mutations related to the click:
 *
 *  • Inside the clicked element, when it's component-sized (a bar, a card):
 *    anything — children, attributes, text. Inside `<body>` or a page wrapper
 *    "inside" means nothing.
 *  • On one of its four nearest ancestors: any attribute but `style`; and
 *    children added or removed, if the ancestor is component-sized. A
 *    page-sized ancestor (where portals, tooltips and toasts get appended)
 *    only counts elements removed from it — something closing.
 *  • Near the click point: a change to an element within 64px of where the
 *    pointer was — the panel an accordion header reveals below itself, the
 *    image swapped under the pointer, a sibling card's state — wherever it
 *    sits in the tree. Anything but `style`. An element that contains the
 *    point only counts if it's component-sized: everything is "near" inside
 *    `<main>`.
 *  • The clicked element being removed (a dismissal).
 *  • A dialog, alertdialog or modal surface opening, or a `<dialog>` opening
 *    or closing, any time in the hold. A menu or listbox opening, unless the
 *    pointer has moved on (see hover, below).
 *  • A status or alert — a toast — only near the click, or within 300ms of it
 *    in a container that wasn't already busy.
 *
 * WHAT DOESN'T, even when related:
 *
 *  • Background. The page's own churn is learned all the time, by container:
 *    a change to a node's children is kept against the node (and the kind of
 *    child that changed), and an attribute change against both the element
 *    and its parent — so in a fading carousel, every slide's `aria-hidden`
 *    feeds one history, and the slide coming back in after fifteen seconds is
 *    as much background as the one that changed a second ago. Anything whose
 *    history has a change in the ten seconds before the interaction is
 *    background, however rarely it changes, and so is anything inside a node
 *    that was itself inserted into a busy container (a new chat message's
 *    paragraphs). Learning only pauses for the second after a press or click
 *    — what follows a click is that click's, so a drawer a button opened can
 *    still be closed by its backdrop — and for changes inside the focused
 *    element (typing); never for scrolling. Changes credited to a judged click
 *    are never learned as background.
 *  • Hover. Changes under an element the pointer moves onto after the click
 *    are hover's. Once the pointer has left the clicked element, a menu, a
 *    listbox or something removed from a page-sized container only counts
 *    within 300ms of the click: hover UI waits for a hover delay, a click's
 *    own render doesn't.
 *  • Polishd's own UI (anything inside `[data-polishd-ui]`).
 *  • A newer interaction's effects. A visitor whose click on a bar did nothing
 *    goes on to click the button in it, and the list that button opens must
 *    not make the bar's click look like it worked. Once a newer press, click,
 *    key press or scroll begins, an older click only gains credit inside its
 *    own component-sized scope (not inside the newer target, and nothing once
 *    the newer click landed inside it), and its URL and focus are judged as
 *    they were at that moment. A repeat click on the same element shares
 *    credit: which one the page answered can't be told apart.
 *
 * KNOWN RESIDUALS — accepted, not bugs to chase:
 *
 *  • A click whose only effect is far from it and isn't a dialog (a plain
 *    `<div>` that toggles a panel across the page) reads as dead.
 *  • A role="dialog" hover card opening as the pointer moves on credits the
 *    click: modal surfaces get the whole hold, because a click that opens a
 *    dialog after a slow fetch must not read as dead.
 *  • The first change a busy region ever makes — a chat's first message, a
 *    carousel's first rotation — has no history yet, and credits a click
 *    near it during the hold.
 *  • A second of steady clicking pauses learning; a carousel that only
 *    rotates while someone clicks continuously can mask a dead click.
 *  • `showPopover()` and CSS-only effects make no DOM mutation, so a click
 *    that only does that reads as dead; and a page that churns inside the
 *    clicked component itself (a ticking clock in the card) hides that
 *    component's dead clicks until the churn is learned.
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
/** How close to the click point a change must be to be the click's. */
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

/** A modal surface: what a click that opens a dialog adds. Counts for the whole hold. */
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
  /**
   * How far `point` is from the element holding `node`, in CSS px: 0 inside
   * it. `Infinity` when it can't be measured, or when the element contains the
   * point but is page-sized — inside `<main>` everything is "near".
   */
  distanceTo(node: NodeLike, point: Point): number;
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
  /** Nodes inserted into a container that was already busy: background inside. */
  const bornInBackground = new WeakSet<object>();
  let armed: Gesture | null = null;
  let epoch = 0;
  /** Target of the newest press or click; null after a key press or scroll. */
  let latest: NodeLike | null = null;
  /** When the press whose click hasn't arrived yet began, or null. */
  let pressedAt: number | null = null;
  /** When someone last pressed or clicked — learning pauses for a hold after. */
  let lastPress = -Infinity;

  // ---- background --------------------------------------------------------------

  const added = (m: MutationLike) => Array.from(m.addedNodes ?? []).filter((n) => !env.isOwn(n));
  const removed = (m: MutationLike) => Array.from(m.removedNodes ?? []).filter((n) => !env.isOwn(n));
  const changed = (m: MutationLike) => [...added(m), ...removed(m)];

  /**
   * Where a change is kept: children against their container (by the kind of
   * child, and in general), text against its element, an attribute against
   * the element and against its parent (so siblings share a history).
   */
  const keysOf = (m: MutationLike): Array<[object, string]> => {
    if (m.type === "characterData") return [[m.target.parentNode ?? m.target, "text"]];
    if (m.type === "attributes") {
      const keys: Array<[object, string]> = [[m.target, `@${m.attributeName}`]];
      if (m.target.parentNode) keys.push([m.target.parentNode, `>@${m.attributeName}`]);
      return keys;
    }
    return changed(m).map((n) => [m.target, `+${env.kindOf(n)}`] as [object, string]);
  };

  const remember = (node: object, key: string, now: number) => {
    let keys = history.get(node);
    if (!keys) history.set(node, (keys = new Map()));
    const times = keys.get(key) ?? [];
    times.push(now);
    if (times.length > BACKGROUND_KEPT) times.shift();
    keys.set(key, times);
  };

  const learn = (m: MutationLike, now: number) => {
    for (const [node, key] of keysOf(m)) remember(node, key, now);
  };

  const recent = (node: object, key: string, since: number) =>
    !!history.get(node)?.get(key)?.some((t) => t < since && since - t <= BACKGROUND_MS);

  /** Is this change the page's own — its node busy in the ten seconds before `since`? */
  const isBackground = (m: MutationLike, since: number): boolean => {
    if (keysOf(m).some(([node, key]) => recent(node, key, since))) return true;
    let node: NodeLike | null | undefined = m.target;
    for (let depth = 0; node && depth < BORN_DEPTH; depth++, node = node.parentNode) {
      if (bornInBackground.has(node)) return true;
    }
    return false;
  };

  // ---- relating a mutation to a click ----------------------------------------------

  const matching = (nodes: NodeLike[], selector: string) =>
    nodes.some((n) => isElement(n) && (!!n.matches?.(selector) || !!n.querySelector?.(selector)));

  const inSubject = (g: Gesture, node: NodeLike) => g.local && g.subject.contains(node);
  const underHovered = (g: Gesture, node: NodeLike) => g.hovered.some((h) => h.contains(node));
  const pageLevelAllowed = (g: Gesture, now: number) =>
    g.hoveredAt === undefined || g.clickAt === undefined || now - g.clickAt <= PAGE_LEVEL_GRACE_MS;

  /** Does this change show something — not just restyle it, not add a script? */
  const visible = (m: MutationLike, styleCounts: boolean): boolean => {
    if (m.type === "childList") return changed(m).some((n) => renders(n, false));
    if (m.type === "attributes") return styleCounts || m.attributeName !== "style";
    return m.type === "characterData";
  };

  /** Is this a change in the subject's own scope — its subtree, or an ancestor? */
  const scopeChange = (g: Gesture, m: MutationLike, now: number): boolean => {
    if (inSubject(g, m.target)) return visible(m, true);
    const pageSizedSelf = !g.local && m.target === g.subject;
    const ancestorLocal = g.ancestors.get(m.target);
    if (!pageSizedSelf && ancestorLocal === undefined) return false;
    if (m.type === "attributes") return m.attributeName !== "style";
    if (m.type !== "childList") return false;
    if (ancestorLocal) return visible(m, false);
    // A page-sized container: only something closing counts.
    return pageLevelAllowed(g, now) && removed(m).some((n) => renders(n, true));
  };

  /** Is the changed element within reach of where the pointer was? */
  const nearPoint = (g: Gesture, m: MutationLike, now: number): boolean => {
    if (!g.point) return false;
    const point = g.point;
    const close = (n: NodeLike) => env.distanceTo(n, point) <= NEAR_PX;
    if (m.type === "childList") {
      // Appended to the page itself: a portal — a hover card, a tooltip — which
      // only counts before the pointer moved on.
      if (!env.isComponentSized(m.target) && !pageLevelAllowed(g, now)) return false;
      const shown = added(m).filter((n) => renders(n, true));
      return shown.some(close) || close(m.target);
    }
    return close(m.target);
  };

  const credits = (g: Gesture, m: MutationLike, now: number): boolean => {
    if (env.isOwn(m.target) || underHovered(g, m.target)) return false;

    // The clicked thing itself went away — a dismissal, unless removing and
    // re-rendering children is what this container does all the time (a
    // carousel that only renders its active slide).
    if (m.type === "childList" && removed(m).some((n) => g.subjects.some((s) => n.contains(s)))) {
      return !isBackground(m, g.start);
    }

    if (g.epoch !== epoch && g.subject !== latest) {
      // Superseded: only its own component's changes, not the newer target's
      // — and none at all when the newer click landed inside this one's
      // element (a bar, then the button in it): the inner click explains them.
      const own = inSubject(g, m.target) || g.ancestors.get(m.target) === true;
      return (
        own &&
        !(latest && (latest.contains(m.target) || g.subject.contains(latest))) &&
        scopeChange(g, m, now) &&
        !isBackground(m, g.start)
      );
    }

    // Surfaces first: a dialog the click opened counts however busy the page is.
    if (m.type === "attributes" && m.attributeName === "open" && m.target.nodeName === "DIALOG") return true;
    if (m.type === "childList") {
      const shown = added(m);
      if (matching(shown, MODAL_SELECTOR)) return true;
      if (matching(shown, MENU_SELECTOR)) return pageLevelAllowed(g, now);
      if (matching(shown, ANNOUNCEMENT_SELECTOR)) {
        if (isBackground(m, g.start)) return false;
        const quick = g.clickAt !== undefined && now - g.clickAt <= PAGE_LEVEL_GRACE_MS;
        return quick || nearPoint(g, m, now);
      }
    }

    // Cheap tests before any layout read.
    if (scopeChange(g, m, now)) return !isBackground(m, g.start);
    if (!visible(m, false) || isBackground(m, g.start)) return false;
    return nearPoint(g, m, now);
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
    return !!active?.contains && env.isComponentSized(active) && active.contains(node);
  };

  env.observe((records) => {
    const now = env.now();
    for (const m of records) {
      // A child born into a container that keeps receiving its kind (a new
      // chat message) carries the container's churn into its own subtree.
      if (m.type === "childList") {
        for (const n of added(m)) {
          if (recent(m.target, `+${env.kindOf(n)}`, now + 1)) bornInBackground.add(n);
        }
      }
      let credited = false;
      for (const g of [...live]) {
        if (g.worked || !credits(g, m, now)) continue;
        credited = true;
        g.worked = true;
        if (g.done) finish(g, true);
      }
      // What a judged click caused is that click's, and what follows any press
      // or click is too — neither is the page's own churn.
      if (!credited && now - lastPress > holdMs && !inFocused(m.target)) learn(m, now);
    }
  });

  const setSubject = (g: Gesture, subject: NodeLike) => {
    g.subject = subject;
    if (!g.subjects.includes(subject)) g.subjects.push(subject);
    g.local = env.isComponentSized(subject);
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
      lastPress = now;
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
