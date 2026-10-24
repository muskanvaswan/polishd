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
  /**
   * Record a click on `target` — the element itself, compared by identity, so
   * one that restyles as it's clicked stays one element. True exactly when the
   * click completes a rage burst.
   */
  hit(target: object | null | undefined, now: number): boolean;
}

export function createRageTracker(count: number, windowMs: number): RageTracker {
  let last: { target: object | null; time: number; count: number } = { target: null, time: 0, count: 0 };
  return {
    hit(target, now) {
      // Same element clicked `count` times, each within `windowMs` of the last.
      if (target && target === last.target && now - last.time < windowMs) {
        last.count++;
        last.time = now;
        return last.count === count;
      }
      last = { target: target ?? null, time: now, count: 1 };
      return false;
    },
  };
}
