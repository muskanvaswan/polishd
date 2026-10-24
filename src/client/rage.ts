/**
 * Polishd — rage-click counting: the same element hit N times in a window.
 *
 * Decided synchronously at each click, from the click stream alone, and
 * emitted on the spot. Nothing here waits on the dead-click hold in
 * click-outcome.ts, so judging a click by its outcome can't delay a rage click
 * or change which bursts count as one.
 *
 * Import-free so `node --test` can load it directly.
 */

export interface RageTracker {
  /** Record a click; true exactly when it completes a rage burst. */
  hit(selector: string | undefined, now: number): boolean;
}

export function createRageTracker(count: number, windowMs: number): RageTracker {
  let last = { selector: "", time: 0, count: 0 };
  return {
    hit(selector, now) {
      // Same selector clicked `count` times, each within `windowMs` of the last.
      if (selector === last.selector && now - last.time < windowMs) {
        last.count++;
        last.time = now;
        return last.count === count;
      }
      last = { selector: selector ?? "", time: now, count: 1 };
      return false;
    },
  };
}
