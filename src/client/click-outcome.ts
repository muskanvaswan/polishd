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
 * already started removing itself by the time the click fires. Its effect
 * still counts for that click.
 *
 * Not every mutation is the click's doing, and the rules for crediting one are
 * what keep this from hiding real dead clicks:
 *
 *  • Pages animate on their own, so `style` changes (a JS animation rewrites
 *    them every frame) and text edits (a ticking clock, a "3s ago" label) only
 *    count inside the clicked element — and only when that element is
 *    component-sized. Inside `<body>` or a page wrapper, everything is
 *    "inside". Nodes added or removed, and any other attribute changing — a
 *    class, `aria-expanded`, `data-state`, `hidden` — count anywhere.
 *  • The newest interaction takes the credit. A visitor whose click on a bar
 *    did nothing goes on to click the button in it, and the list that button
 *    opens must not make the bar's click look like it worked. Once a newer
 *    press or click begins, an older click only gains credit from changes
 *    inside its own component-sized target that aren't inside the newer one,
 *    and its URL and focus are judged as they were when the newer one began.
 *    A repeat click on the same element shares credit — which of the two the
 *    page answered can't be told apart, and either way the control works.
 *
 * Import-free, with the browser behind {@link JudgeEnv}, so `node --test` can
 * drive it with fakes.
 */

/** How long a click on a non-interactive target waits for the page to respond. */
export const DEAD_CLICK_HOLD_MS = 1000;

/** How long a press waits for its click before it's dropped (a drag, a scroll). */
const ARM_MS = 3000;

/** The slice of a DOM node the relevance test reads. */
export interface NodeLike {
  nodeName: string;
  /** Inclusive, like `Node.contains`. */
  contains(other: unknown): boolean;
}

/** The slice of a `MutationRecord` the relevance test reads. */
export interface MutationLike {
  type: string;
  target: unknown;
  attributeName?: string | null;
  addedNodes?: ArrayLike<{ nodeName: string }>;
  removedNodes?: ArrayLike<{ nodeName: string }>;
}

/** Nodes whose arrival or departure changes nothing on screen. */
const NON_RENDERING = new Set(["SCRIPT", "STYLE", "LINK", "META", "NOSCRIPT", "TEMPLATE", "#COMMENT"]);

/**
 * Could this mutation have come from clicking `subject`? `local` says whether
 * `subject` is component-sized, so that a change inside it means something.
 */
export function isMeaningfulMutation(m: MutationLike, subject: NodeLike | null, local = true): boolean {
  const inSubject = () => local && !!subject && subject.contains(m.target);
  switch (m.type) {
    case "childList": {
      const nodes = [...Array.from(m.addedNodes ?? []), ...Array.from(m.removedNodes ?? [])];
      return nodes.some((n) => !NON_RENDERING.has(n.nodeName.toUpperCase()));
    }
    case "attributes":
      return m.attributeName !== "style" || inSubject();
    case "characterData":
      return inSubject();
    default:
      return false;
  }
}

/** The browser, as the judge sees it. */
export interface JudgeEnv {
  href(): string;
  activeElement(): unknown;
  /** Is this element small enough — a bar, a card — that changes inside it are its own? */
  isComponentSized(node: NodeLike): boolean;
  /** Start delivering mutation records; returns the function that stops it. */
  observe(onRecords: (records: readonly MutationLike[]) => void): () => void;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

interface Gesture {
  subject: NodeLike;
  local: boolean;
  /** The interaction this gesture belongs to; older than the current one = superseded. */
  epoch: number;
  href: string;
  active: unknown;
  /** URL and focus when a newer interaction began, which is what this one is judged on. */
  superseded?: { href: string; active: unknown };
  /** Something meaningful already happened. */
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
  /** A press on a non-interactive target: start watching for its effects. */
  arm(subject: NodeLike): void;
  /** The click went somewhere that needs no judging: stop watching the press. */
  release(): void;
  /**
   * Judge a click on `subject`. `done` runs once: with `true` as soon as the
   * page responds, or after the hold with whether the URL or focus moved.
   */
  judge(subject: NodeLike, done: (worked: boolean) => void): void;
  /**
   * The page is going away (unloading, or hidden behind a tab the click may
   * have opened): settle every pending click as working. A page that leaves
   * within a second of a click most likely left because of it.
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
  let armed: Gesture | null = null;
  let stop: (() => void) | null = null;
  let epoch = 0;
  /** Target of the newest press or click. */
  let latest: NodeLike | null = null;
  /** A press began and its click hasn't arrived yet. */
  let pressed = false;

  const finish = (g: Gesture, worked: boolean) => {
    if (!live.delete(g)) return;
    env.clearTimeout(g.timer);
    if (armed === g) armed = null;
    if (live.size === 0 && stop) {
      stop();
      stop = null;
    }
    g.done?.(worked);
  };

  const credits = (g: Gesture, r: MutationLike): boolean => {
    if (g.epoch === epoch || g.subject === latest) return isMeaningfulMutation(r, g.subject, g.local);
    // Superseded: only its own component's changes, and not the newer target's.
    return (
      g.local &&
      g.subject.contains(r.target) &&
      !latest?.contains(r.target) &&
      isMeaningfulMutation(r, g.subject, true)
    );
  };

  const onRecords = (records: readonly MutationLike[]) => {
    for (const g of [...live]) {
      if (g.worked || !records.some((r) => credits(g, r))) continue;
      g.worked = true;
      if (g.done) finish(g, true);
    }
  };

  const track = (subject: NodeLike): Gesture => {
    const g: Gesture = {
      subject,
      local: env.isComponentSized(subject),
      epoch,
      href: env.href(),
      active: null,
      worked: false,
    };
    live.add(g);
    stop ??= env.observe(onRecords);
    return g;
  };

  const outcome = (g: Gesture): boolean => {
    if (g.worked) return true;
    const now = g.superseded ?? { href: env.href(), active: env.activeElement() };
    return now.href !== g.href || now.active !== g.active;
  };

  return {
    begin(target, kind) {
      latest = target;
      // A click that follows its own press is the same interaction.
      if (kind === "click" && pressed) {
        pressed = false;
        return;
      }
      pressed = kind === "press";
      epoch++;
      if (armed) finish(armed, false); // a press that never clicked
      const snapshot = { href: env.href(), active: env.activeElement() };
      for (const g of live) g.superseded ??= snapshot;
    },

    arm(subject) {
      if (armed) finish(armed, false);
      const g = track(subject);
      armed = g;
      g.timer = env.setTimeout(() => finish(g, false), armMs);
    },

    release() {
      if (armed) finish(armed, false);
    },

    judge(subject, done) {
      const g = armed ?? track(subject);
      armed = null;
      env.clearTimeout(g.timer);
      // The click may land somewhere other than the press did (the pressed
      // layer removed itself); what it did since the press still counts, and
      // from here on it's judged against what was clicked.
      if (g.subject !== subject) {
        g.subject = subject;
        g.local = env.isComponentSized(subject);
      }
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
