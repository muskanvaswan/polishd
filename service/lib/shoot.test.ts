import assert from "node:assert/strict";
import { test } from "node:test";

import type { Browser } from "playwright-core";

import type { ShootRequest } from "../../src/capture/protocol.ts";
import type { BrowserPool, Lease } from "./pool.ts";
import { byDeadline, shootAll } from "./shoot.ts";

const tick = () => new Promise((r) => setImmediate(r));

/**
 * A browser that's up and connected but wedged: contexts open, and the first
 * call a shot makes on one never answers — what production saw when a shot
 * ran a request into Vercel's 60-second limit.
 */
function wedgedBrowser() {
  const contexts: { offline: boolean; closed: boolean }[] = [];
  const browser = {
    version: () => "149.0.0.0",
    newContext: async (options: { offline?: boolean } = {}) => {
      const record = { offline: options.offline === true, closed: false };
      contexts.push(record);
      return {
        newPage: async () => ({}),
        addInitScript: () => new Promise(() => {}),
        route: async () => {},
        close: async () => {
          record.closed = true;
        },
      };
    },
  };
  return { browser: browser as unknown as Browser, contexts };
}

function fakePool() {
  const discarded: string[] = [];
  const pool = {
    discard: (_lease: Lease<Browser>, reason: string) => {
      discarded.push(reason);
    },
    swap: async () => {
      throw new Error("a hung shot isn't a browser fault: nothing should swap");
    },
    noteShots: () => {},
  } as unknown as BrowserPool<Browser>;
  return { pool, discarded };
}

test("byDeadline passes on work that finishes in time", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  assert.equal(await byDeadline(Promise.resolve("shot"), 1_000), "shot");
  await assert.rejects(byDeadline(Promise.reject(new Error("page failed")), 1_000), /page failed/);
});

test("byDeadline gives up at the deadline, and drops a rejection that comes after it", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const unhandled: unknown[] = [];
  const onUnhandled = (err: unknown) => unhandled.push(err);
  process.on("unhandledRejection", onUnhandled);
  try {
    let fail!: (err: Error) => void;
    const work = new Promise<string>((_, reject) => (fail = reject));
    const waited = byDeadline(work, 5_000);
    t.mock.timers.tick(5_000);
    assert.equal(await waited, null);

    fail(new Error("the browser was killed"));
    await tick();
    await tick();
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("a shot still running at the deadline answers as timed out and retires its browser", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const { browser, contexts } = wedgedBrowser();
  const { pool, discarded } = fakePool();
  const request: ShootRequest = {
    routes: ["/", "/pricing"],
    devices: ["phone"],
    themes: ["light"],
    find: [],
  };

  const pending = shootAll(pool, { browser }, "https://example.com", request, 30_000);
  await tick();
  t.mock.timers.tick(30_000);
  const shots = await pending;

  assert.deepEqual(
    shots.map((s) => [s.route, s.reason]),
    [
      ["/", "timeout"],
      // The deadline has passed, so the next cell isn't started.
      ["/pricing", "budget"],
    ],
  );
  assert.match(shots[0].skipped ?? "", /ran out of time/);
  assert.equal(discarded.length, 1);
  assert.match(discarded[0], /still running at the deadline/);
  // The hung shot's context is left to die with its browser, not waited on.
  assert.deepEqual(
    contexts.map((c) => [c.offline, c.closed]),
    [
      [true, false],
      [false, false],
    ],
  );
});
