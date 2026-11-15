/**
 * The sandbox engine: shots taken in a Vercel Sandbox instead of in this
 * function (`SHOTS_ENGINE=sandbox`).
 *
 * In a function, Chromium is `@sparticuz/chromium`: single-process, sharing
 * the function's memory and its 60 seconds, and worn out by use (pool.ts is
 * the story of that). A sandbox is a small VM. The image it starts from
 * (scripts/build-sandbox.mjs) carries Playwright's full Chromium and a copy
 * of the capture code, so a job there is the same shootAll on a real browser
 * that is launched for the job and gone with it. This function only carries
 * the job in and the result out:
 *
 *   write app/jobs/<id>.job.json → sh app/run.sh <job> <result> → read <result>
 *
 * One sandbox per function instance, kept while captures keep coming — a
 * dashboard's forty-odd requests land on one — and left to stop by its own
 * timeout when they don't. It's extended when a job arrives near the end of
 * its time, and replaced when it can't be (the plan's session limit), when it
 * has gone, or when a job on it fails for any reason but the job's own.
 * That job is tried once more on the replacement if there's time.
 *
 * Generic over the sandbox so the policy is tested with fakes; the real one
 * is `createVercelSandbox`, which is the only code here that touches the SDK.
 */
import { randomUUID } from "node:crypto";

import type { ShootRequest, ShotResult } from "../../src/capture/protocol.ts";
import {
  WORKER_JOB_DIR,
  WORKER_JOB_VERSION,
  WORKER_SCRIPT,
  type WorkerJob,
  type WorkerResult,
} from "./sandbox-job.ts";

export interface SandboxSettings {
  /** The image to start from (scripts/build-sandbox.mjs prints it). Null: not set up. */
  snapshotId: string | null;
  /** vCPUs per sandbox; each brings 2 GB of memory. */
  vcpus: number;
  /** How long a sandbox lives with no job extending it. */
  timeoutMs: number;
}

/** The few things the engine asks of a sandbox. */
export interface SandboxBox {
  writeFile(path: string, content: string): Promise<void>;
  /** Run to completion; killed at `timeoutMs`. `stderr` is only read when it failed. */
  run(cmd: string, args: string[], timeoutMs: number): Promise<{ exitCode: number; stderr: string }>;
  readFile(path: string): Promise<Uint8Array | null>;
  /** Push the sandbox's own timeout out by `ms`. Rejects at the plan's limit. */
  extend(ms: number): Promise<void>;
  stop(): Promise<void>;
}

export interface EngineOptions {
  /** A sandbox's lifetime as created, so the engine knows when one is running out. */
  timeoutMs: number;
  /** Jobs in flight at once; the rest wait their turn. */
  maxConcurrent: number;
  create(): Promise<SandboxBox>;
  log?(message: string): void;
}

export interface EngineStats {
  /** Whether a sandbox is up on this instance right now. */
  up: boolean;
  active: number;
  waiting: number;
  /** Sandboxes created so far on this instance. */
  created: number;
  /** Why the last job failed, or null once one has succeeded since. */
  lastError: string | null;
}

export interface SandboxEngine {
  shoot(origin: string, request: ShootRequest, deadline: number): Promise<ShotResult[]>;
  stats(): EngineStats;
}

/** The worker ran and said no: the job's fault, not the sandbox's. */
export class WorkerFailure extends Error {}

/**
 * A sandbox with less than this left is extended before it's given a job: a
 * job can run for close to a minute. And by this much each time — small,
 * because an idle sandbox's memory is paid for until it stops, and whatever
 * is left of the last extension is idle time.
 */
const KEEP_MS = 75_000;
const EXTEND_MS = 2 * 60_000;
/** Kept back from a job's budget for reading its result out. */
const READ_BACK_MS = 2_000;
/** How long past the budget the command may run: the worker answers for itself first. */
const KILL_GRACE_MS = 6_000;
/** A second try needs a new sandbox and a shot: not worth starting with less. */
const RETRY_MIN_MS = 25_000;

function firstLine(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return (message.split("\n")[0] ?? message).slice(0, 200);
}

interface Held {
  id: number;
  box: SandboxBox;
  /** When it stops by itself, as far as this instance knows. */
  expiresAt: number;
  jobs: number;
  dropped: boolean;
  extending: Promise<void> | null;
}

async function runJob(
  box: SandboxBox,
  origin: string,
  request: ShootRequest,
  deadline: number,
): Promise<ShotResult[]> {
  const budgetMs = deadline - Date.now() - READ_BACK_MS;
  if (budgetMs < 1_000) throw new WorkerFailure("no time was left to take the shot");

  const id = randomUUID();
  const jobFile = `${WORKER_JOB_DIR}/${id}.job.json`;
  const resultFile = `${WORKER_JOB_DIR}/${id}.result.json`;
  const job: WorkerJob = { v: WORKER_JOB_VERSION, origin, request, budgetMs };

  await box.writeFile(jobFile, JSON.stringify(job));
  const done = await box.run("sh", [WORKER_SCRIPT, jobFile, resultFile], budgetMs + KILL_GRACE_MS);
  const raw = await box.readFile(resultFile);
  if (!raw) {
    const why = firstLine(done.stderr.trim() || "no output");
    throw new Error(`the worker left no result (exit ${done.exitCode}): ${why}`);
  }
  let result: WorkerResult;
  try {
    result = JSON.parse(Buffer.from(raw).toString("utf8")) as WorkerResult;
  } catch {
    throw new Error("the worker's result isn't JSON");
  }
  if (result?.v !== WORKER_JOB_VERSION) {
    throw new WorkerFailure("the sandbox image is out of date — rebuild it (npm run sandbox:build)");
  }
  if (!result.ok) throw new WorkerFailure(result.message || "the worker failed");
  if (!("shots" in result) || !Array.isArray(result.shots)) throw new Error("the worker's result has no shots");
  return result.shots;
}

export function createSandboxEngine(options: EngineOptions): SandboxEngine {
  const log = options.log ?? (() => {});
  let current: Held | null = null;
  let creating: Promise<Held> | null = null;
  let created = 0;
  let active = 0;
  let lastError: string | null = null;
  const waiting: (() => void)[] = [];

  /** Forget `held`. It's stopped once no job is on it, rather than left to time out. */
  function drop(held: Held, reason: string): void {
    if (held.dropped) return;
    held.dropped = true;
    if (current === held) current = null;
    log(`sandbox #${held.id} dropped: ${reason}`);
    if (held.jobs === 0) void held.box.stop().catch(() => {});
  }

  function leave(held: Held): void {
    held.jobs--;
    if (held.dropped && held.jobs === 0) void held.box.stop().catch(() => {});
  }

  /** Whether `held` has time for a job, extending it if it's close to the end. */
  async function usable(held: Held): Promise<boolean> {
    const left = held.expiresAt - Date.now();
    if (left > KEEP_MS) return true;
    if (left <= 0) {
      drop(held, "it reached its timeout");
      return false;
    }
    held.extending ??= held.box
      .extend(EXTEND_MS)
      .then(() => {
        held.expiresAt += EXTEND_MS;
      })
      .finally(() => {
        held.extending = null;
      });
    try {
      await held.extending;
      return true;
    } catch (err) {
      drop(held, `it couldn't be kept alive (${firstLine(err)})`);
      return false;
    }
  }

  async function acquire(): Promise<Held> {
    const held = current;
    if (held && (await usable(held)) && !held.dropped) return held;
    creating ??= options
      .create()
      .then((box) => {
        const next: Held = {
          id: ++created,
          box,
          expiresAt: Date.now() + options.timeoutMs,
          jobs: 0,
          dropped: false,
          extending: null,
        };
        current = next;
        log(`sandbox #${next.id} created`);
        return next;
      })
      .finally(() => {
        creating = null;
      });
    return creating;
  }

  // The slot gate, as in pool.ts: a freed slot goes straight to the next waiter.
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

  async function shoot(origin: string, request: ShootRequest, deadline: number): Promise<ShotResult[]> {
    await slot();
    try {
      for (let attempt = 1; ; attempt++) {
        let held: Held;
        try {
          held = await acquire();
        } catch (err) {
          lastError = `no sandbox could be created: ${firstLine(err)}`;
          throw err;
        }
        held.jobs++;
        try {
          const shots = await runJob(held.box, origin, request, deadline);
          lastError = null;
          return shots;
        } catch (err) {
          lastError = firstLine(err);
          // The worker answered, so the sandbox works: the job is what failed.
          if (err instanceof WorkerFailure) throw err;
          drop(held, lastError);
          if (attempt === 2 || deadline - Date.now() < RETRY_MIN_MS) throw err;
        } finally {
          leave(held);
        }
      }
    } finally {
      free();
    }
  }

  function stats(): EngineStats {
    return { up: current !== null, active, waiting: waiting.length, created, lastError };
  }

  return { shoot, stats };
}

/** Marks the sandboxes this service starts, so `tidy` only ever touches its own. */
export const SANDBOX_TAGS = { service: "polishd-shots" };
/** Stopped sandboxes cleared per start: enough to keep up, too few to slow one down. */
const TIDY_LIMIT = 10;

type SandboxSdk = typeof import("@vercel/sandbox").Sandbox;

/**
 * Delete the records of this service's sandboxes that have stopped. A sandbox
 * left to time out stays listed on the project, stopped, for good; nothing
 * runs in it, but one is left per burst of captures. Deleting a record leaves
 * the image alone — that snapshot is kept unless asked for by name. Best
 * effort: a failure here is nobody's problem.
 */
export async function tidy(Sandbox: SandboxSdk, keep: string): Promise<void> {
  try {
    const page = await Sandbox.list({ tags: SANDBOX_TAGS });
    const gone = page.sandboxes
      .filter((s) => s.name !== keep && (s.status === "stopped" || s.status === "failed" || s.status === "aborted"))
      .slice(0, TIDY_LIMIT);
    for (const { name } of gone) {
      const stale = await Sandbox.get({ name, resume: false });
      await stale.delete();
    }
  } catch {
    // Listed again on the next start.
  }
}

/**
 * Start a sandbox from the image. Not persistent: it's the same image every
 * time, and a persistent sandbox would save a snapshot of itself whenever it
 * stopped.
 */
export async function createVercelSandbox(settings: SandboxSettings): Promise<SandboxBox> {
  if (!settings.snapshotId) {
    throw new Error("SHOTS_SANDBOX_SNAPSHOT_ID isn't set — build the image with npm run sandbox:build");
  }
  const { Sandbox } = await import("@vercel/sandbox");
  const sandbox = await Sandbox.create({
    source: { type: "snapshot", snapshotId: settings.snapshotId },
    resources: { vcpus: settings.vcpus },
    timeout: settings.timeoutMs,
    persistent: false,
    tags: SANDBOX_TAGS,
  });
  void tidy(Sandbox, sandbox.name);
  return {
    writeFile: (path, content) => sandbox.writeFiles([{ path, content }]),
    run: async (cmd, args, timeoutMs) => {
      const done = await sandbox.runCommand(cmd, args, { timeoutMs });
      const stderr = done.exitCode === 0 ? "" : await done.stderr().catch(() => "");
      return { exitCode: done.exitCode, stderr };
    },
    readFile: (path) => sandbox.readFileToBuffer({ path }),
    extend: (ms) => sandbox.extendTimeout(ms),
    stop: async () => {
      await sandbox.stop();
    },
  };
}

let engine: SandboxEngine | null = null;

/** This instance's engine, made on first use. */
export function sandboxEngine(config: {
  sandbox: SandboxSettings;
  browser: { maxConcurrent: number };
}): SandboxEngine {
  engine ??= createSandboxEngine({
    timeoutMs: config.sandbox.timeoutMs,
    maxConcurrent: config.browser.maxConcurrent,
    create: () => createVercelSandbox(config.sandbox),
    log: (message) => console.warn(`[shots] ${message}`),
  });
  return engine;
}
