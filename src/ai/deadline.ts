/**
 * Polishd — bounded waits (pure).
 *
 * Some work runs after something expensive has already happened — matching a
 * summary's losses to source runs after the paid model call — and must never
 * be the reason that result is lost. `settleWithin` gives such work a hard
 * ceiling: past it, the caller carries on with a fallback while the work is
 * left to finish (or fail) on its own.
 */

/**
 * Resolve with `work`'s result, or with `fallback` once `ms` have passed —
 * whichever comes first. A rejection of `work` rejects as usual (before the
 * deadline); one after it is ignored.
 */
export function settleWithin<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  work.catch(() => {}); // a rejection after the deadline has nobody waiting for it
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}
