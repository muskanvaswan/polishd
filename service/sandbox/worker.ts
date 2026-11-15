/**
 * The capture worker: one job's shots, taken inside a Vercel Sandbox.
 *
 *   sh app/run.sh <job.json> <result.json>
 *
 * The function (lib/sandbox.ts) writes the job, runs this, and reads the
 * result. Everything that does the shooting is the service's own code,
 * unchanged — the same egress proxy, request guard and capture core — only
 * here Chromium is a real multi-process browser in a VM of its own, launched
 * for the job and gone with it. Nothing is kept between jobs, so there is no
 * browser to wear out, and no secret is in reach: the sandbox has none of the
 * function's environment.
 *
 * It always leaves a result, and always exits: a job that can't be read, a
 * browser that won't launch and a shot still running past the budget each
 * write `{ ok: false, message }`. Exiting is what closes the browser —
 * Playwright kills what it launched when the process goes.
 *
 * Run by Node's type stripping, like the tests are, so it imports its
 * neighbours by their `.ts` names.
 */
import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { parseShootRequest } from "../../src/capture/protocol.ts";
import { withBrowser } from "../lib/browser.ts";
import { loadConfig } from "../lib/config.ts";
import { WORKER_JOB_VERSION, type WorkerJob, type WorkerResult } from "../lib/sandbox-job.ts";
import { shootAll } from "../lib/shoot.ts";

/** A job's files are read back within seconds; anything older was abandoned. */
const STALE_MS = 5 * 60_000;
/** How far past its budget a job may run before the worker answers for it. */
const OVERRUN_MS = 3_000;

function firstLine(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return (message.split("\n")[0] ?? message).slice(0, 300);
}

/** Read and check a job. The function wrote it, but it's checked as input all the same. */
async function readJob(file: string): Promise<WorkerJob> {
  const raw: unknown = JSON.parse(await readFile(file, "utf8"));
  const job = raw as Partial<WorkerJob> | null;
  if (!job || job.v !== WORKER_JOB_VERSION) {
    throw new Error(
      `this sandbox image speaks job version ${WORKER_JOB_VERSION} — rebuild it (npm run sandbox:build)`,
    );
  }
  let origin: URL;
  try {
    origin = new URL(String(job.origin));
  } catch {
    throw new Error("the job has no origin");
  }
  if ((origin.protocol !== "https:" && origin.protocol !== "http:") || origin.origin !== job.origin) {
    throw new Error("the job's origin isn't a web origin");
  }
  const request = parseShootRequest(job.request);
  if (!request.ok) throw new Error(`the job's request is invalid: ${request.message}`);
  const budgetMs = Number(job.budgetMs);
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) throw new Error("the job has no time budget");
  return { v: WORKER_JOB_VERSION, origin: origin.origin, request: request.value, budgetMs };
}

/** Clear out what earlier jobs left — a result the function never came back for. */
async function sweep(dir: string): Promise<void> {
  const names = await readdir(dir).catch(() => [] as string[]);
  const cutoff = Date.now() - STALE_MS;
  await Promise.all(
    names.map(async (name) => {
      const file = path.join(dir, name);
      const info = await stat(file).catch(() => null);
      if (info?.isFile() && info.mtimeMs < cutoff) await rm(file, { force: true });
    }),
  );
}

async function main(): Promise<number> {
  const [jobFile, resultFile] = process.argv.slice(2);
  if (!jobFile || !resultFile) {
    console.error("usage: worker.ts <job.json> <result.json>");
    return 2;
  }
  let answered = false;
  const answer = async (result: WorkerResult): Promise<void> => {
    if (answered) return;
    answered = true;
    await writeFile(resultFile, JSON.stringify(result));
  };
  const fail = async (message: string): Promise<number> => {
    console.error(`[shots] ${message}`);
    await answer({ v: WORKER_JOB_VERSION, ok: false, message });
    return 1;
  };

  let job: WorkerJob;
  try {
    job = await readJob(jobFile);
  } catch (err) {
    return fail(firstLine(err));
  } finally {
    await rm(jobFile, { force: true }).catch(() => {});
  }
  void sweep(path.dirname(resultFile));

  // shootAll gives up on a shot at the deadline by itself. This is for what
  // it can't see — a launch that hangs, a browser that won't close.
  const overrun = setTimeout(() => {
    void fail("the capture ran past its time budget").then(() => process.exit(1));
  }, job.budgetMs + OVERRUN_MS);

  try {
    // No environment: nothing in the sandbox configures the service, and the
    // defaults are the production rules — public addresses, web ports.
    const config = loadConfig({});
    const deadline = Date.now() + job.budgetMs;
    const shots = await withBrowser(config, (lease, pool) =>
      shootAll(pool, lease, job.origin, job.request, deadline),
    );
    await answer({ v: WORKER_JOB_VERSION, ok: true, shots });
    return 0;
  } catch (err) {
    return fail(firstLine(err));
  } finally {
    clearTimeout(overrun);
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
