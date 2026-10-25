/**
 * Polishd — a small bounded cache (pure).
 *
 * Least-recently-used eviction under an entry cap, an optional size cap (in
 * whatever unit `sizeOf` measures — bytes of text, entries of a listing) and
 * an optional time-to-live. Used to keep GitHub reads from being repeated on
 * every summary: a commit's file listing and a blob's content never change
 * under their sha, and a default branch rarely does.
 *
 * In-memory, per server instance — a cold start begins empty, which only
 * costs the requests the cache would have saved.
 */
export interface LruOptions<V> {
  maxEntries: number;
  maxSize?: number;
  sizeOf?: (value: V) => number;
  ttlMs?: number;
  now?: () => number;
}

export class Lru<V> {
  private readonly items = new Map<string, { value: V; size: number; at: number }>();
  private readonly opts: LruOptions<V>;
  private total = 0;

  // No parameter properties: tests load this file with type stripping only.
  constructor(opts: LruOptions<V>) {
    this.opts = opts;
  }

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  get(key: string): V | undefined {
    const hit = this.items.get(key);
    if (!hit) return undefined;
    if (this.opts.ttlMs !== undefined && this.now() - hit.at > this.opts.ttlMs) {
      this.delete(key);
      return undefined;
    }
    // Re-insert: Map order is the recency order.
    this.items.delete(key);
    this.items.set(key, hit);
    return hit.value;
  }

  set(key: string, value: V): void {
    const size = this.opts.sizeOf?.(value) ?? 0;
    if (this.opts.maxSize !== undefined && size > this.opts.maxSize) return; // never fits
    this.delete(key);
    this.items.set(key, { value, size, at: this.now() });
    this.total += size;
    for (const [k] of this.items) {
      const over =
        this.items.size > this.opts.maxEntries ||
        (this.opts.maxSize !== undefined && this.total > this.opts.maxSize);
      if (!over) break;
      this.delete(k);
    }
  }

  delete(key: string): void {
    const hit = this.items.get(key);
    if (!hit) return;
    this.items.delete(key);
    this.total -= hit.size;
  }

  get size(): number {
    return this.items.size;
  }
}
