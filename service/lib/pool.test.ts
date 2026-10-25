import assert from "node:assert/strict";
import { test } from "node:test";

import { createBrowserPool, type Launched, type PoolLimits, type Pressure } from "./pool.ts";

interface Fake {
  id: number;
  closed: boolean;
  disconnect: () => void;
}

/** A pool over fake browsers: each launch is numbered, closes are recorded. */
function harness(limits: Partial<PoolLimits> = {}, pressure?: () => Pressure | null) {
  const browsers: Fake[] = [];
  const log: string[] = [];
  let failNext = false;
  const pool = createBrowserPool<{ id: number }>({
    maxConcurrent: 2,
    maxShots: 3,
    maxRssBytes: 100,
    maxFds: 50,
    ...limits,
    launch: async (): Promise<Launched<{ id: number }>> => {
      if (failNext) {
        failNext = false;
        throw new Error("no browser could be launched");
      }
      const fake: Fake = { id: browsers.length + 1, closed: false, disconnect: () => {} };
      browsers.push(fake);
      return {
        browser: { id: fake.id },
        close: async () => {
          fake.closed = true;
        },
        onDisconnected: (listener) => {
          fake.disconnect = listener;
        },
        ...(pressure ? { pressure } : {}),
      };
    },
    log: (message) => log.push(message),
  });
  return { pool, browsers, log, failNextLaunch: () => (failNext = true) };
}

const tick = () => new Promise((r) => setImmediate(r));

test("one browser serves lease after lease", async () => {
  const { pool, browsers } = harness();
  for (let i = 0; i < 3; i++) {
    const lease = await pool.acquire();
    assert.equal(lease.browser.id, 1);
    pool.release(lease);
  }
  assert.equal(browsers.length, 1);
  assert.equal(browsers[0].closed, false);
  assert.equal(pool.stats().active, 0);
});

test("after its shots a browser is replaced, and closes once nobody holds it", async () => {
  const { pool, browsers, log } = harness({ maxShots: 3 });
  const first = await pool.acquire();
  pool.noteShots(first, 3);
  // Still held: the next lease gets a fresh browser while the worn one lingers.
  const second = await pool.acquire();
  assert.equal(second.browser.id, 2);
  assert.equal(browsers[0].closed, false);
  pool.release(first);
  await tick();
  assert.equal(browsers[0].closed, true);
  assert.equal(browsers[1].closed, false);
  pool.release(second);
  assert.ok(log.some((m) => m.includes("retired after 3 shots: 3 shots")), log.join("\n"));
});

test("swap retires the browser and hands the same lease a fresh one, keeping the slot", async () => {
  const { pool, browsers } = harness({ maxConcurrent: 1 });
  const lease = await pool.acquire();
  assert.equal(lease.browser.id, 1);
  await pool.swap(lease, "browser fault (resources)");
  assert.equal(lease.browser.id, 2);
  // Nothing else held it, so it was closed before the new launch.
  assert.equal(browsers[0].closed, true);
  assert.equal(pool.stats().active, 1);
  pool.release(lease);
  assert.equal(pool.stats().active, 0);
});

test("a swapped-out browser stays up for the other capture still on it", async () => {
  const { pool, browsers } = harness();
  const a = await pool.acquire();
  const b = await pool.acquire();
  assert.equal(b.browser.id, 1);
  await pool.swap(a, "browser fault (closed)");
  assert.equal(a.browser.id, 2);
  assert.equal(b.browser.id, 1);
  assert.equal(browsers[0].closed, false);
  pool.release(b);
  await tick();
  assert.equal(browsers[0].closed, true);
  pool.release(a);
});

test("discard retires without releasing; new leases go elsewhere; it closes when free", async () => {
  const { pool, browsers } = harness();
  const a = await pool.acquire();
  const b = await pool.acquire();
  pool.discard(a, "the probe failed");
  assert.equal(browsers[0].closed, false);
  pool.release(a);
  await tick();
  assert.equal(browsers[0].closed, false, "b still holds it");
  const c = await pool.acquire();
  assert.equal(c.browser.id, 2);
  pool.release(b);
  await tick();
  assert.equal(browsers[0].closed, true);
  pool.release(c);
});

test("the slot gate queues the extra capture and hands it the freed slot", async () => {
  const { pool } = harness({ maxConcurrent: 1 });
  const a = await pool.acquire();
  let got = false;
  const waiting = pool.acquire().then((lease) => {
    got = true;
    return lease;
  });
  await tick();
  assert.equal(got, false);
  assert.deepEqual([pool.stats().active, pool.stats().waiting], [1, 1]);
  pool.release(a);
  const b = await waiting;
  assert.equal(got, true);
  assert.deepEqual([pool.stats().active, pool.stats().waiting], [1, 0]);
  pool.release(b);
  assert.equal(pool.stats().active, 0);
});

test("a browser over the memory or descriptor line is replaced at the next lease", async () => {
  let reading: Pressure | null = { rssBytes: 10, fds: 10 };
  const { pool, browsers, log } = harness({}, () => reading);
  const a = await pool.acquire();
  pool.release(a);
  reading = { rssBytes: 200 * 1_048_576, fds: null };
  const b = await pool.acquire();
  assert.equal(b.browser.id, 2);
  await tick();
  assert.equal(browsers[0].closed, true);
  assert.ok(log.some((m) => m.includes("200 MB resident")), log.join("\n"));
  pool.release(b);
  reading = { rssBytes: null, fds: 51 };
  const c = await pool.acquire();
  assert.equal(c.browser.id, 3);
  assert.ok(log.some((m) => m.includes("51 open descriptors")));
  pool.release(c);
  // No reading at all keeps the browser.
  reading = null;
  const d = await pool.acquire();
  assert.equal(d.browser.id, 3);
  pool.release(d);
});

test("a browser that disconnects on its own is closed and replaced", async () => {
  const { pool, browsers } = harness();
  const a = await pool.acquire();
  pool.release(a);
  browsers[0].disconnect();
  await tick();
  assert.equal(browsers[0].closed, true);
  assert.equal(pool.stats().browser, null);
  const b = await pool.acquire();
  assert.equal(b.browser.id, 2);
  pool.release(b);
});

test("a launch that fails rejects the lease, frees the slot, and is tried again next time", async () => {
  const { pool, browsers, failNextLaunch } = harness({ maxConcurrent: 1 });
  failNextLaunch();
  await assert.rejects(pool.acquire(), /no browser could be launched/);
  assert.equal(pool.stats().active, 0);
  const a = await pool.acquire();
  assert.equal(a.browser.id, 1);
  assert.equal(browsers.length, 1);
  pool.release(a);
});

test("concurrent first leases share one launch", async () => {
  const { pool, browsers } = harness();
  const [a, b] = await Promise.all([pool.acquire(), pool.acquire()]);
  assert.equal(browsers.length, 1);
  assert.equal(a.browser.id, b.browser.id);
  assert.equal(pool.stats().browser?.holders, 2);
  pool.release(a);
  pool.release(b);
  assert.equal(pool.stats().launched, 1);
});
