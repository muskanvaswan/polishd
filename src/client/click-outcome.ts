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
 * on the press: a dismissable layer that closes on `pointerdown` outside it has
 * already started removing itself by the time the click fires.
 *
 * The hard part is not mistaking the page's own activity for a response.
 * Timers, carousels, scroll-reveal and streamed content mutate the DOM all the
 * time, and crediting every mutation would turn every dead click into a click.
 * So a mutation only counts when the click plausibly caused it:
 *
 *  • In the click's scope — inside the clicked element, or an attribute on
 *    one of its nearest ancestors — anything counts: content, attributes,
 *    text. Only when the element is component-sized, though: inside `<body>`
 *    or a page wrapper, everything is "inside". Ancestors' `style` never
 *    counts (an animation rewrites it every frame).
 *  • An overlay opening anywhere counts: a dialog, menu, listbox, alert or
 *    popover added to the page, or a `<dialog>` opening or closing.
 *  • Elsewhere, only structure and state: elements added or removed, and the
 *    attributes that carry open/closed state (`hidden`, `open`, `inert`,
 *    `aria-expanded`, `aria-hidden`, `aria-modal`, `data-state`). Not text, not
 *    `class`, not `style`.
 *  • Never a node that was already churning. One observer runs for the page's
 *    lifetime and remembers which nodes keep changing — a ticking clock, an
 *    autoplaying carousel, a feed that streams in. A node that changed the
 *    same way (its children, its text, one attribute) in three separate
 *    bursts, a quarter second apart or more, in the five seconds before an
 *    interaction is background for that kind of change, and those changes
 *    credit nobody (overlays excepted). It keeps counting while people
 *    interact — a visitor clicking around never starves the baseline — but
 *    changes credited to a judged click aren't counted: they're the click's,
 *    not the page's. A one-off change at load doesn't make a node background,
 *    nor does a panel a button toggled twice, nor a panel's own opening
 *    animation (its `style`) make its `hidden` background.
 *  • Never polishd's own UI (anything inside `[data-polishd-ui]`).
 *  • The newest interaction takes the credit. A visitor whose click on a bar
 *    did nothing goes on to click the button in it, and the list that button
 *    opens must not make the bar's click look like it worked. Once a newer
 *    press, click, key press or scroll begins, an older click only gains
 *    credit inside its own component-sized scope (and not inside the newer
 *    target), and its URL and focus are judged as they were at that moment.
 *    A repeat click on the same element shares credit: which of the two the
 *    page answered can't be told apart, and either way the control works.
 *
 * Import-free, with the browser behind {@link JudgeEnv}, so `node --test` can
 * drive it with fakes.
 */

/** How long a click on a non-interactive target waits for the page to respond. */
export const DEAD_CLICK_HOLD_MS = 1000;
/** How far back "already mutating" looks, from the start of an interaction. */
export const CHURN_BASELINE_MS = 5000;
/** Mutations closer together than this are one burst, not repeated churn. */
const CHURN_GAP_MS = 250;
/** Separate bursts inside the baseline that make a node background. */
const CHURN_BURSTS = 3;
/** Burst times kept per node and kind; enough to look past a busy hold. */
const CHURN_KEPT = 8;
/** How long a press waits for its click before it's dropped (a drag, a scroll). */
const ARM_MS = 3000;
/** Ancestors of the clicked element whose attributes are in the click's scope. */
const SCOPE_ANCESTORS = 3;

/** Attributes that carry open/closed state, which count wherever they change. */
export const STATE_ATTRIBUTES: ReadonlySet<string> = new Set([
  "hidden", "open", "inert", "aria-expanded", "aria-hidden", "aria-modal", "data-state",
]);

/** What an opened overlay looks like when it's added to the page. */
export const OVERLAY_SELECTOR = [
  "dialog", '[role="dialog"]', '[role="alertdialog"]', '[role="menu"]', '[role="listbox"]',
  '[role="alert"]', '[role="status"]', '[aria-modal="true"]', "[popover]",
].join(",");

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
  /** Is this element small enough — a bar, a card — that changes inside it are its own? */
  isComponentSized(node: NodeLike): boolean;
  /** Is this node part of polishd's own UI? Its changes are never a response. */
  isOwn(node: NodeLike): boolean;
  /** Deliver every mutation in the document from now on (the judge never stops it). */
  observe(onRecords: (records: readonly MutationLike[]) => void): void;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Nodes whose arrival or departure changes nothing on screen. */
const NON_RENDERING = new Set(["SCRIPT", "STYLE", "LINK", "META", "NOSCRIPT", "TEMPLATE", "#COMMENT"]);

const isElement = (n: NodeLike) => n.nodeType === 1 || (n.nodeType === undefined && !n.nodeName.startsWith("#"));

const changedNodes = (m: MutationLike): NodeLike[] => [
  ...Array.from(m.addedNodes ?? []),
  ...Array.from(m.removedNodes ?? []),
];

interface Gesture {
  subject: NodeLike;
  /** `subject` is component-sized, so changes inside it are its own. */
  local: boolean;
  /** Component-sized ancestors whose attributes are in scope. */
  ancestors: Set<NodeLike>;
  /** The interaction this gesture belongs to; older than the current one = superseded. */
  epoch: number;
  /** When its interaction began — the baseline looks back from here. */
  start: number;
  href: string;
  active: unknown;
  /** URL and focus when a newer interaction began, which is what this one is judged on. */
  superseded?: { href: string; active: unknown };
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
  /** A press on a non-interactive target: start watching for its effects. */
  arm(subject: NodeLike): void;
  /** The click went somewhere that needs no judging, or the press was cancelled. */
  release(): void;
  /**
   * Judge a click on `subject`. `done` runs once: with `true` as soon as the
   * page responds, or after the hold with whether the URL or focus moved.
   */
  judge(subject: NodeLike, done: (worked: boolean) => void): void;
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
  /** Per node, per kind of change: when its recent bursts were. */
  const churn = new WeakMap<object, Map<string, number[]>>();
  let armed: Gesture | null = null;
  let epoch = 0;
  /** Target of the newest press or click; null after a key press or scroll. */
  let latest: NodeLike | null = null;
  /** When the press whose click hasn't arrived yet began, or null. */
  let pressedAt: number | null = null;

  // ---- background churn ------------------------------------------------------

  const kindOf = (m: MutationLike) => (m.type === "attributes" ? `@${m.attributeName}` : m.type);

  const noteChurn = (m: MutationLike, now: number) => {
    let kinds = churn.get(m.target);
    if (!kinds) churn.set(m.target, (kinds = new Map()));
    const times = kinds.get(kindOf(m)) ?? [];
    if (times.length && now - times[times.length - 1] < CHURN_GAP_MS) return; // same burst
    times.push(now);
    if (times.length > CHURN_KEPT) times.shift();
    kinds.set(kindOf(m), times);
  };

  /** Did this node change this way in enough bursts before `since`? */
  const churning = (m: MutationLike, since: number): boolean => {
    const times = churn.get(m.target)?.get(kindOf(m));
    if (!times) return false;
    let bursts = 0;
    for (const t of times) if (t < since && since - t <= CHURN_BASELINE_MS) bursts++;
    return bursts >= CHURN_BURSTS;
  };

  // ---- crediting a mutation ---------------------------------------------------

  const rendersSomething = (m: MutationLike, elementsOnly: boolean) =>
    changedNodes(m).some(
      (n) =>
        !NON_RENDERING.has(n.nodeName.toUpperCase()) &&
        (!elementsOnly || isElement(n)) &&
        !env.isOwn(n),
    );

  const opensOverlay = (m: MutationLike): boolean => {
    if (m.type === "attributes") return m.attributeName === "open" && m.target.nodeName === "DIALOG";
    if (m.type !== "childList") return false;
    return Array.from(m.addedNodes ?? []).some(
      (n) =>
        isElement(n) &&
        !env.isOwn(n) &&
        (!!n.matches?.(OVERLAY_SELECTOR) || !!n.querySelector?.(OVERLAY_SELECTOR)),
    );
  };

  const inSubject = (g: Gesture, node: NodeLike) => g.local && g.subject.contains(node);
  const inScope = (g: Gesture, node: NodeLike) => inSubject(g, node) || g.ancestors.has(node);

  /** A change in scope: anything inside the subject; any attribute but `style` on an ancestor. */
  const scopeChange = (g: Gesture, m: MutationLike): boolean => {
    switch (m.type) {
      case "childList":
        return rendersSomething(m, false);
      case "attributes":
        return inSubject(g, m.target) || m.attributeName !== "style";
      case "characterData":
        return inSubject(g, m.target);
      default:
        return false;
    }
  };

  const credits = (g: Gesture, m: MutationLike): boolean => {
    if (env.isOwn(m.target)) return false;
    if (g.epoch !== epoch && g.subject !== latest) {
      // Superseded: only its own component's changes, and not the newer target's.
      return (
        inScope(g, m.target) &&
        !latest?.contains(m.target) &&
        !churning(m, g.start) &&
        scopeChange(g, m)
      );
    }
    if (opensOverlay(m)) return true;
    if (churning(m, g.start)) return false;
    if (inScope(g, m.target)) return scopeChange(g, m);
    if (m.type === "childList") return rendersSomething(m, true);
    return m.type === "attributes" && STATE_ATTRIBUTES.has(m.attributeName ?? "");
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
        if (g.worked || !credits(g, m)) continue;
        credited = true;
        g.worked = true;
        if (g.done) finish(g, true);
      }
      // What a judged click caused is that click's, not the page's churn.
      if (!credited) noteChurn(m, now);
    }
  });

  const scopeAncestors = (subject: NodeLike): Set<NodeLike> => {
    const found = new Set<NodeLike>();
    let node = subject.parentNode ?? null;
    for (let depth = 0; node && depth < SCOPE_ANCESTORS; depth++, node = node.parentNode ?? null) {
      if (isElement(node) && env.isComponentSized(node)) found.add(node);
    }
    return found;
  };

  const setSubject = (g: Gesture, subject: NodeLike) => {
    g.subject = subject;
    g.local = env.isComponentSized(subject);
    g.ancestors = g.local ? scopeAncestors(subject) : new Set();
  };

  const track = (subject: NodeLike): Gesture => {
    const g = {
      epoch,
      start: env.now(),
      href: env.href(),
      active: null,
      worked: false,
    } as Gesture;
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

    arm(subject) {
      if (armed) finish(armed, false);
      const g = track(subject);
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

    judge(subject, done) {
      const g = armed ?? track(subject);
      armed = null;
      env.clearTimeout(g.timer);
      // The click may land somewhere other than the press did (the pressed
      // layer removed itself); what it did since the press still counts, and
      // from here on it's judged against what was clicked.
      if (g.subject !== subject) setSubject(g, subject);
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
