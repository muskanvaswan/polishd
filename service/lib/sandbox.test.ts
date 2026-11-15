import assert from "node:assert/strict";
import { test } from "node:test";

import type { ShootRequest, ShotResult } from "../../src/capture/protocol.ts";
import type { WorkerJob, WorkerResult } from "./sandbox-job.ts";
import { WorkerFailure, createSandboxEngine, type SandboxBox } from "./sandbox.ts";

const request: ShootRequest = { routes: ["/"], devices: ["desktop"], themes: ["light"], find: [] };
const shot: ShotResult = { route: "/", device: "desktop", theme: "light", previews: [], looked: [] };
const ORIGIN = "https://example.com";
const MINUTE = 60_000;

interface FakeBox extends SandboxBox {
  id: number;
  jobs: WorkerJob[];
  commands: { cmd: string; args: string[]; timeoutMs: number }[];
  extended: number[];
  stopped: boolean;
}

/**
 * A sandbox whose worker does what `answer` says: return a result to write,
 * return null to leave none, or throw as the SDK does when the sandbox is gone.
 */
function fakeBox(id: number, answer: (job: WorkerJob) => WorkerResult | null | Promise<WorkerResult | null>): FakeBox {
  const files = new Map<string, string>();
  const box: FakeBox = {
    id,
    jobs: [],
    commands: [],
    extended: [],
    stopped: false,
    writeFile: async (path, content) => {
      files.set(path, content);
    },
    run: async (cmd, args, timeoutMs) => {
      box.commands.push({ cmd, args, timeoutMs });
      const [jobFile, resultFile] = args.slice(-2) as [string, string];
      const job = JSON.parse(files.get(jobFile) ?? "null") as WorkerJob;
      box.jobs.push(job);
      const result = await answer(job);
      if (result) files.set(resultFile, JSON.stringify(result));
      return { exitCode: result?.ok ? 0 : 1, stderr: result ? "" : "node: boom\nat somewhere" };
    },
    readFile: async (path) => {
      const content = files.get(path);
      return content === undefined ? null : Buffer.from(content);
    },
    extend: async (ms) => {
      box.extended.push(ms);
    },
    stop: async () => {
      box.stopped = true;
    },
  };
  return box;
}

const ok = (): WorkerResult => ({ v: 1, ok: true, shots: [shot] });

function engineOf(make: (id: number) => FakeBox, maxConcurrent = 2) {
  const boxes: FakeBox[] = [];
  const log: string[] = [];
  const engine = createSandboxEngine({
    timeoutMs: 10 * MINUTE,
    maxConcurrent,
    create: async () => {
      const box = make(boxes.length + 1);
      boxes.push(box);
      return box;
    },
    log: (message) => log.push(message),
  });
  return { engine, boxes, log };
}

test("a job is written, run by the image's launcher, and its shots read back", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 0 });
  const { engine, boxes } = engineOf((id) => fakeBox(id, ok));

  assert.deepEqual(await engine.shoot(ORIGIN, request, 50_000), [shot]);

  const [box] = boxes;
  assert.ok(box);
  const [command] = box.commands;
  assert.ok(command);
  assert.equal(command.cmd, "sh");
  assert.equal(command.args[0], "app/run.sh");
  assert.match(command.args[1] ?? "", /^app\/jobs\/[\w-]+\.job\.json$/);
  assert.match(command.args[2] ?? "", /^app\/jobs\/[\w-]+\.result\.json$/);
  // The budget keeps time back for reading the result; the kill comes after it.
  assert.deepEqual(box.jobs[0], { v: 1, origin: ORIGIN, request, budgetMs: 48_000 });
  assert.equal(command.timeoutMs, 54_000);
  assert.deepEqual(engine.stats(), { up: true, active: 0, waiting: 0, created: 1, lastError: null });
});

test("captures share one sandbox, and concurrent first requests don't create two", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 0 });
  const { engine, boxes } = engineOf((id) => fakeBox(id, ok));

  await Promise.all([engine.shoot(ORIGIN, request, 50_000), engine.shoot(ORIGIN, request, 50_000)]);
  await engine.shoot(ORIGIN, request, 50_000);

  assert.equal(boxes.length, 1);
  assert.equal(boxes[0]?.jobs.length, 3);
});

test("no more jobs run at once than the limit; the rest wait their turn", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 0 });
  let running = 0;
  let peak = 0;
  const release: (() => void)[] = [];
  const { engine } = engineOf(
    (id) =>
      fakeBox(id, async () => {
        peak = Math.max(peak, ++running);
        await new Promise<void>((resolve) => release.push(resolve));
        running--;
        return ok();
      }),
    2,
  );

  const all = Promise.all([1, 2, 3].map(() => engine.shoot(ORIGIN, request, 50_000)));
  while (release.length < 2) await new Promise((r) => setImmediate(r));
  assert.equal(engine.stats().waiting, 1);
  release.splice(0).forEach((go) => go());
  while (release.length < 1) await new Promise((r) => setImmediate(r));
  release.splice(0).forEach((go) => go());
  await all;

  assert.equal(peak, 2);
  assert.deepEqual(engine.stats().active, 0);
});

test("a sandbox near its timeout is extended before it's given a job", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 0 });
  const { engine, boxes } = engineOf((id) => fakeBox(id, ok));
  await engine.shoot(ORIGIN, request, 50_000);

  t.mock.timers.setTime(9 * MINUTE + 30_000); // 30 seconds left of ten minutes
  await engine.shoot(ORIGIN, request, 9 * MINUTE + 80_000);
  assert.deepEqual(boxes[0]?.extended, [2 * MINUTE]);
  assert.equal(boxes.length, 1);

  // Now good until 12:00, so a job at 10:00 needs nothing.
  t.mock.timers.setTime(10 * MINUTE);
  await engine.shoot(ORIGIN, request, 10 * MINUTE + 50_000);
  assert.deepEqual(boxes[0]?.extended, [2 * MINUTE]);

  // And one at 11:00, a minute from the end, extends it again.
  t.mock.timers.setTime(11 * MINUTE);
  await engine.shoot(ORIGIN, request, 11 * MINUTE + 50_000);
  assert.deepEqual(boxes[0]?.extended, [2 * MINUTE, 2 * MINUTE]);
});

test("a sandbox that timed out, or can't be extended, is replaced", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 0 });
  const { engine, boxes, log } = engineOf((id) => {
    const box = fakeBox(id, ok);
    if (id === 2) {
      box.extend = async () => {
        throw new Error("the plan's session limit was reached");
      };
    }
    return box;
  });
  await engine.shoot(ORIGIN, request, 50_000);

  t.mock.timers.setTime(11 * MINUTE); // the first one is gone
  await engine.shoot(ORIGIN, request, 11 * MINUTE + 50_000);
  assert.equal(boxes.length, 2);
  assert.equal(boxes[0]?.stopped, true);

  t.mock.timers.setTime(20 * MINUTE + 30_000); // the second has 30 seconds left
  await engine.shoot(ORIGIN, request, 20 * MINUTE + 80_000);
  assert.equal(boxes.length, 3);
  assert.equal(boxes[1]?.stopped, true);
  assert.equal(boxes[2]?.jobs.length, 1);
  assert.match(log.join("\n"), /sandbox #2 dropped: it couldn't be kept alive \(the plan's session limit/);
});

test("a job that fails on the sandbox is tried once more on a new one", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 0 });
  const { engine, boxes } = engineOf((id) =>
    fakeBox(id, () => {
      if (id === 1) throw new Error("sandbox_stopped: the session has ended");
      return ok();
    }),
  );

  assert.deepEqual(await engine.shoot(ORIGIN, request, 50_000), [shot]);
  assert.equal(boxes.length, 2);
  assert.equal(boxes[0]?.stopped, true);
  assert.equal(engine.stats().lastError, null);
});

test("a worker that leaves no result fails the job after the second sandbox, with its stderr", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 0 });
  const { engine, boxes } = engineOf((id) => fakeBox(id, () => null));

  await assert.rejects(engine.shoot(ORIGIN, request, 50_000), /left no result \(exit 1\): node: boom$/);
  assert.equal(boxes.length, 2);
  assert.deepEqual(
    boxes.map((b) => b.stopped),
    [true, true],
  );
  assert.equal(engine.stats().up, false);
  assert.match(engine.stats().lastError ?? "", /left no result/);
});

test("with too little time left for a second sandbox, the job isn't tried again", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 0 });
  const { engine, boxes } = engineOf((id) => fakeBox(id, () => null));

  await assert.rejects(engine.shoot(ORIGIN, request, 20_000), /left no result/);
  assert.equal(boxes.length, 1);
});

test("a failure the worker reports is the job's: the sandbox is kept and nothing is retried", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 0 });
  const { engine, boxes } = engineOf((id) =>
    fakeBox(id, () => ({ v: 1, ok: false, message: "the capture ran past its time budget" })),
  );

  await assert.rejects(engine.shoot(ORIGIN, request, 50_000), (err) => {
    assert.ok(err instanceof WorkerFailure);
    assert.match(err.message, /past its time budget/);
    return true;
  });
  assert.equal(boxes.length, 1);
  assert.equal(boxes[0]?.stopped, false);
  assert.equal(engine.stats().up, true);
});

test("a dropped sandbox isn't stopped under a job still running on it", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 0 });
  let finishSlow: (() => void) | null = null;
  const { engine, boxes } = engineOf((id) =>
    fakeBox(id, async (job) => {
      if (id !== 1) return ok();
      if (job.request.routes[0] === "/slow") {
        await new Promise<void>((resolve) => {
          finishSlow = resolve;
        });
        return ok();
      }
      return null; // this job's failure drops the sandbox
    }),
  );

  const slow = engine.shoot(ORIGIN, { ...request, routes: ["/slow"] }, 50_000);
  while (!finishSlow) await new Promise((r) => setImmediate(r));
  assert.deepEqual(await engine.shoot(ORIGIN, request, 50_000), [shot]);
  assert.equal(boxes.length, 2);
  assert.equal(boxes[0]?.stopped, false, "the slow job is still on it");

  (finishSlow as () => void)();
  assert.deepEqual(await slow, [shot]);
  assert.equal(boxes[0]?.stopped, true);
});

test("a sandbox that can't be created fails the job and says why", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 0 });
  const engine = createSandboxEngine({
    timeoutMs: 10 * MINUTE,
    maxConcurrent: 2,
    create: async () => {
      throw new Error("sandbox creation is paused until the next billing cycle");
    },
  });

  await assert.rejects(engine.shoot(ORIGIN, request, 50_000), /creation is paused/);
  assert.match(engine.stats().lastError ?? "", /no sandbox could be created: sandbox creation is paused/);
  assert.equal(engine.stats().active, 0);
});

test("an image that speaks another job version says to rebuild it", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 0 });
  const { engine } = engineOf((id) => fakeBox(id, () => ({ v: 2, ok: true, shots: [] }) as unknown as WorkerResult));

  await assert.rejects(engine.shoot(ORIGIN, request, 50_000), /out of date — rebuild it/);
});
