/**
 * The capture browser pool: one Chromium per function instance, leased to a
 * few captures at a time, and replaced rather than kept once it's past its
 * best.
 *
 * Why not a singleton: the service runs Chromium as `@sparticuz/chromium`
 * builds it, single-process, so every context's renderer and the GPU share
 * one process whose sockets, file descriptors and memory accumulate across
 * requests. A browser that has run out stays alive and connected — nothing
 * fires `disconnected` — and every later shot fails in under a second with
 * `net::ERR_INSUFFICIENT_RESOURCES`, for as long as the platform keeps the
 * instance, which under steady traffic is indefinitely. That was production
 * on 2026-10-25, with the health endpoint reporting ok throughout.
 *
 * So a browser is retired:
 * - by the capture that hit a browser fault (`discard`; or `swap`, which
 *   takes a fresh one on the same slot so the shot can be tried again);
 * - after `maxShots`, or once its process is over the memory or descriptor
 *   line (`pressure`), checked whenever a lease is handed out;
 * - when it disconnects on its own.
 * A retired browser closes once the last capture holding it lets go, and the
 * next lease launches a new one. Generic over the browser so the policy is
 * tested with fakes; browser.ts supplies the real launch.
 */

export interface Pressure {
  rssBytes: number | null;
  fds: number | null;
}

/** A launched browser and what the pool needs to manage it. */
export interface Launched<B> {
  browser: B;
  /** Close the browser and whatever was launched with it. Bounded; never throws. */
  close(): Promise<void>;
  /** Called if the browser goes away on its own. */
  onDisconnected(listener: () => void): void;
  /** The browser process's footprint, where the host can read it. */
  pressure?(): Pressure | null;
}

export interface PoolLimits {
  /** Captures in flight at once on this instance; the rest wait their turn. */
  maxConcurrent: number;
  /** Shots a browser takes before it's replaced. */
  maxShots: number;
  /** …or the resident size its process may reach. */
  maxRssBytes: number;
  /** …or the file descriptors it may hold. */
  maxFds: number;
}

export interface PoolOptions<B> extends PoolLimits {
  launch(): Promise<Launched<B>>;
  log?(message: string): void;
}

interface Instance<B> {
  id: number;
  launched: Launched<B>;
  shots: number;
  /** Leases on it right now. */
  holders: number;
  retired: boolean;
  closing: Promise<void> | null;
  since: number;
}

/** A capture's hold on a browser. `browser` changes across `swap`. */
export interface Lease<B> {
  readonly browser: B;
}

export interface PoolStats {
  /** Captures holding a slot right now. */
  active: number;
  waiting: number;
  /** The browser leases are handed out from, if one is up. */
  browser: { id: number; shots: number; holders: number; ageMs: number } | null;
  /** Browsers launched so far on this instance. */
  launched: number;
}

export interface BrowserPool<B> {
  /** Wait for a slot, then a healthy browser. Rejects only if none can be launched. */
  acquire(): Promise<Lease<B>>;
  /** Give the slot back; a retired browser closes once no one holds it. */
  release(lease: Lease<B>): void;
  noteShots(lease: Lease<B>, count?: number): void;
  /** This browser is unusable: retire it. The lease keeps it until released. */
  discard(lease: Lease<B>, reason: string): void;
  /** Retire this browser and take a fresh one on the same slot. */
  swap(lease: Lease<B>, reason: string): Promise<void>;
  stats(): PoolStats;
}

class LeaseImpl<B> implements Lease<B> {
  instance: Instance<B> | null;
  released = false;
  constructor(instance: Instance<B>) {
    this.instance = instance;
  }
  get browser(): B {
    if (!this.instance) throw new Error("this lease has no browser");
    return this.instance.launched.browser;
  }
}

export function createBrowserPool<B>(options: PoolOptions<B>): BrowserPool<B> {
  const log = options.log ?? (() => {});
  let current: Instance<B> | null = null;
  let launching: Promise<Instance<B>> | null = null;
  let launched = 0;
  let active = 0;
  const waiting: (() => void)[] = [];

  function close(inst: Instance<B>): Promise<void> {
    inst.closing ??= inst.launched.close().catch(() => {});
    return inst.closing;
  }

  /** Take `inst` out of service. It closes once free — or now, when it's already gone. */
  function retire(inst: Instance<B>, reason: string, now = false): Promise<void> {
    if (!inst.retired) {
      inst.retired = true;
      if (current === inst) current = null;
      log(`browser #${inst.id} retired after ${inst.shots} shots: ${reason}`);
    }
    return now || inst.holders === 0 ? close(inst) : Promise.resolve();
  }

  /** Why `inst` should go, or null while it's fit to keep. */
  function worn(inst: Instance<B>): string | null {
    if (inst.shots >= options.maxShots) return `${inst.shots} shots`;
    const p = inst.launched.pressure?.();
    if (p?.rssBytes != null && p.rssBytes > options.maxRssBytes) {
      return `${Math.round(p.rssBytes / 1_048_576)} MB resident`;
    }
    if (p?.fds != null && p.fds > options.maxFds) return `${p.fds} open descriptors`;
    return null;
  }

  /**
   * The browser to lease: the current one unless it's worn, else one being
   * launched, else a new launch. A worn browser still held by a capture
   * lingers until that capture lets go, so two can briefly overlap — bounded
   * by one shot, and cheaper than making every capture wait for it.
   */
  async function instance(): Promise<Instance<B>> {
    if (current) {
      const why = worn(current);
      if (!why) return current;
      void retire(current, why);
    }
    if (launching) return launching;
    const attempt = options.launch().then((l) => {
      const inst: Instance<B> = {
        id: ++launched,
        launched: l,
        shots: 0,
        holders: 0,
        retired: false,
        closing: null,
        since: Date.now(),
      };
      l.onDisconnected(() => {
        void retire(inst, "disconnected", true);
      });
      current = inst;
      log(`browser #${inst.id} launched`);
      return inst;
    });
    launching = attempt;
    try {
      return await attempt;
    } finally {
      if (launching === attempt) launching = null;
    }
  }

  // The slot gate. A freed slot is handed straight to the next waiter, so
  // the count never overshoots between a release and the waiter waking.
  async function slot(): Promise<void> {
    if (active < options.maxConcurrent) {
      active++;
      return;
    }
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  function free(): void {
    const next = waiting.shift();
    if (next) next();
    else active--;
  }

  async function acquire(): Promise<Lease<B>> {
    await slot();
    try {
      const inst = await instance();
      inst.holders++;
      return new LeaseImpl(inst);
    } catch (err) {
      free();
      throw err;
    }
  }

  function letGo(inst: Instance<B>): void {
    inst.holders--;
    if (inst.retired && inst.holders === 0) void close(inst);
  }

  function release(lease: Lease<B>): void {
    const l = lease as LeaseImpl<B>;
    if (l.released) return;
    l.released = true;
    if (l.instance) letGo(l.instance);
    l.instance = null;
    free();
  }

  function noteShots(lease: Lease<B>, count = 1): void {
    const inst = (lease as LeaseImpl<B>).instance;
    if (inst) inst.shots += count;
  }

  function discard(lease: Lease<B>, reason: string): void {
    const inst = (lease as LeaseImpl<B>).instance;
    if (inst) void retire(inst, reason);
  }

  async function swap(lease: Lease<B>, reason: string): Promise<void> {
    const l = lease as LeaseImpl<B>;
    if (l.released) throw new Error("this lease was released");
    const old = l.instance;
    l.instance = null;
    if (old) {
      old.holders--;
      // Closed before the next launch when nothing else holds it, so the
      // memory comes back first.
      await retire(old, reason);
    }
    const inst = await instance();
    inst.holders++;
    l.instance = inst;
  }

  function stats(): PoolStats {
    return {
      active,
      waiting: waiting.length,
      browser: current
        ? { id: current.id, shots: current.shots, holders: current.holders, ageMs: Date.now() - current.since }
        : null,
      launched,
    };
  }

  return { acquire, release, noteShots, discard, swap, stats };
}
