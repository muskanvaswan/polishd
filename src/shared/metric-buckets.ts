/**
 * Polishd — which time buckets a trend chart should draw.
 *
 * Pure: no database, no React, no clock of its own. The counting happens in
 * SQL (see `getMetricTrends`); this decides the *shape* of the series that
 * comes out of it, which is where the edge cases live:
 *
 *   • **Gap filling.** An hour with no events is a measured zero, not a
 *     missing point. Without this a quiet night would render as one wide bar
 *     next to another, silently compressing the axis.
 *   • **A cap.** A site running for two years has 17,000 hourly buckets. Only
 *     the most recent `maxBuckets` are drawn.
 *   • **Anchoring on data, not on now.** The window ends at the newest bucket
 *     that has something in it, so an install last browsed three days ago
 *     still gets a chart instead of an empty one.
 *   • **Clock skew.** `ts` is the visitor's clock. One machine set to next
 *     year would otherwise anchor the window there and blank the chart for
 *     everyone, so buckets past the present are discarded.
 */

/**
 * The contiguous run of bucket indexes to render, oldest → newest.
 *
 * @param buckets     Bucket indexes that hold data, in any order.
 * @param maxBuckets  How many to draw at most; the newest win.
 * @param nowBucket   The bucket the present falls in. Anything later is
 *                    discarded as clock skew.
 * @returns Every index from the window's start to its end inclusive — callers
 *          fill the ones with no data with zeros. Empty when nothing qualifies.
 */
export function trendWindow(
  buckets: Iterable<number>,
  maxBuckets: number,
  nowBucket: number,
): number[] {
  let first: number | null = null;
  let last: number | null = null;
  for (const b of buckets) {
    if (b > nowBucket) continue;
    if (first === null || b < first) first = b;
    if (last === null || b > last) last = b;
  }
  if (first === null || last === null) return [];

  const start = Math.max(first, last - (Math.max(1, maxBuckets) - 1));
  const out: number[] = [];
  for (let b = start; b <= last; b++) out.push(b);
  return out;
}
