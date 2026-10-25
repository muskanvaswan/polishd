/**
 * Polishd — near misses: the control a dead click just failed to hit.
 *
 * A dead click is often not confusion about a control but a miss beside one.
 * A full-width bar whose button is only its text, a row whose link is one
 * word of it: the visitor aims at the bar, the bar does nothing, and the event
 * carries the bar's label — which is the button's text, because the bar
 * contains it. Read cold, "Show 9 more: 3 dead clicks" says the button is
 * broken when it works fine. Naming the control the click missed lets the
 * summary say "clicks beside Show # more" instead.
 *
 * Two shapes qualify:
 *  1. The clicked element *contains* the control, and only a few of them — a
 *     bar, a card, a toolbar row. A layout container says nothing about which
 *     of its controls was meant, so an element past any of the budgets below
 *     (too much of the screen, too many elements, too many controls) is not a
 *     near miss by containment.
 *  2. A control *borders* the click point, found by hit-testing a few rings
 *     around it — the icon just past the edge of a link, the gap between two
 *     tabs.
 *
 * Import-free, with the DOM behind {@link NearMissDeps}, so `node --test` can
 * drive it with fakes.
 */

export interface Point {
  x: number;
  y: number;
}

export interface RectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Share of the viewport an element may cover and still be a component — a
 * bar, a card — rather than layout. Also what the outcome check uses to decide
 * whether changes inside a clicked element are that element's own.
 */
export const COMPONENT_MAX_VIEWPORT_SHARE = 0.25;
/** Elements visited inside the clicked one before it counts as a layout container. */
const SCAN_BUDGET = 300;
/** More controls than this inside the clicked element and none of them is "the" one. */
const MAX_CONTAINED = 3;
/** Rings hit-tested around the click point, in CSS px: bordering, not merely nearby. */
const PROBE_RADII = [8, 16, 24];
/** Eight compass directions per ring. */
const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [Math.SQRT1_2, Math.SQRT1_2], [-Math.SQRT1_2, Math.SQRT1_2],
  [Math.SQRT1_2, -Math.SQRT1_2], [-Math.SQRT1_2, -Math.SQRT1_2],
];

/** Distance from a point to the nearest edge of a rect; 0 inside it. */
export const distanceToRect = (p: Point, r: RectLike): number => {
  const dx = Math.max(r.left - p.x, 0, p.x - r.right);
  const dy = Math.max(r.top - p.y, 0, p.y - r.bottom);
  return Math.hypot(dx, dy);
};

/** The points hit-tested around a click, nearest ring first. */
export const probePoints = (p: Point): Point[] =>
  PROBE_RADII.flatMap((r) => DIRECTIONS.map(([dx, dy]) => ({ x: p.x + dx * r, y: p.y + dy * r })));

/** The DOM, as the near-miss search sees it. */
export interface NearMissDeps<E> {
  /** Is this element itself a control (no ancestor walk)? */
  isControl(el: E): boolean;
  /** The control at or a few levels above `el`, if any. */
  controlOf(el: E): E | null;
  children(el: E): ArrayLike<E>;
  rect(el: E): RectLike;
  /** The topmost element at a viewport point (`document.elementFromPoint`). */
  hitTest(x: number, y: number): E | null;
  /** Viewport area in CSS px². */
  viewportArea(): number;
}

export interface NearMiss<E> {
  control: E;
  /** True when the clicked element contains the control (shape 1). */
  contained: boolean;
}

const isRendered = (r: RectLike): boolean => r.right > r.left && r.bottom > r.top;
export const rectArea = (r: RectLike): number =>
  Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top);

/**
 * Controls inside `target`, or null once the walk passes the budget. A
 * control's own subtree is not entered: the icon in a button is the button.
 */
function containedControls<E>(target: E, deps: NearMissDeps<E>): E[] | null {
  if (rectArea(deps.rect(target)) > deps.viewportArea() * COMPONENT_MAX_VIEWPORT_SHARE) return null;
  const found: E[] = [];
  const stack: E[] = Array.from(deps.children(target));
  let visited = 0;
  while (stack.length > 0) {
    if (++visited > SCAN_BUDGET) return null;
    const el = stack.pop() as E;
    if (deps.isControl(el)) {
      if (isRendered(deps.rect(el))) found.push(el);
      if (found.length > MAX_CONTAINED) return null;
      continue;
    }
    stack.push(...Array.from(deps.children(el)));
  }
  return found;
}

/**
 * The control a dead click on `target` most plausibly meant, if any. `point`
 * is the click's viewport position — null for a keyboard or scripted click,
 * which can still be inside a container but can't border anything.
 */
export function findNearMiss<E>(
  target: E,
  point: Point | null,
  deps: NearMissDeps<E>,
): NearMiss<E> | null {
  const inside = containedControls(target, deps);
  if (inside && inside.length > 0) {
    let best = inside[0];
    if (point) {
      let bestDistance = Infinity;
      for (const el of inside) {
        const d = distanceToRect(point, deps.rect(el));
        if (d < bestDistance) [best, bestDistance] = [el, d];
      }
    }
    return { control: best, contained: true };
  }

  if (!point) return null;
  for (const probe of probePoints(point)) {
    const hit = deps.hitTest(probe.x, probe.y);
    if (!hit) continue;
    const control = deps.controlOf(hit);
    if (control && control !== target) return { control, contained: false };
  }
  return null;
}

/**
 * `label` with `inner` taken out of it, or undefined when nothing is left. A
 * container's label includes the text of the control inside it, and a dead
 * click on the container must not wear the control's name.
 */
export const withoutLabel = (
  label: string | undefined,
  inner: string | undefined,
): string | undefined => {
  if (!label || !inner) return label;
  const rest = label.replace(inner, "").replace(/\s+/g, " ").trim();
  return rest || undefined;
};
