/**
 * Polishd — rage-click counting: the same target hit N times in a window.
 *
 * Decided synchronously at each click, from the click stream alone, and
 * emitted on the spot. Nothing here waits on the dead-click hold in
 * click-outcome.ts, so judging a click by its outcome can't delay a rage click
 * or change which bursts count as one.
 *
 * The key is whatever identifies "the same thing" to the caller: the control
 * element (compared by identity, and held weakly — a hammered button that
 * gets removed isn't kept alive here), or a selector string for something
 * that isn't a control.
 *
 * Import-free so `node --test` can load it directly.
 */

export type RageKey = object | string | null | undefined;

export interface RageTracker {
  /** Record a click on `key`; true exactly when it completes a rage burst. */
  hit(key: RageKey, now: number): boolean;
}

interface Held {
  is(key: RageKey): boolean;
}

const hold = (key: RageKey): Held => {
  if (typeof key === "string") return { is: (k) => k === key };
  if (!key) return { is: () => false };
  const ref = typeof WeakRef === "function" ? new WeakRef(key) : { deref: () => key };
  return { is: (k) => typeof k === "object" && k !== null && ref.deref() === k };
};

export function createRageTracker(count: number, windowMs: number): RageTracker {
  let last: { key: Held; time: number; count: number } = { key: hold(null), time: 0, count: 0 };
  return {
    hit(key, now) {
      // The same key `count` times, each within `windowMs` of the last.
      if (key && last.key.is(key) && now - last.time < windowMs) {
        last.count++;
        last.time = now;
        return last.count === count;
      }
      last = { key: hold(key), time: now, count: 1 };
      return false;
    },
  };
}
