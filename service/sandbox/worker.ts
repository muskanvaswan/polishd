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

import {
  BACKGROUND_CAPTURE_VERSION,
  parseBackgroundCaptureRequest,
  type CaptureCall,
} from "../../src/capture/background.ts";
import { parseShootRequest, type ShotResult } from "../../src/capture/protocol.ts";
import { withBrowser } from "../lib/browser.ts";
import { runCapture, type CaptureDeps, type CaptureReply } from "../lib/capture-run.ts";
import { loadConfig } from "../lib/config.ts";
import { resolvePublic } from "../lib/net.ts";
import {
  WORKER_JOB_VERSION,
  type WorkerCaptureJob,
  type WorkerJob,
  type WorkerResult,
} from "../lib/sandbox-job.ts";
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
async function readJob(file: string): Promise<WorkerJob | WorkerCaptureJob> {
  const raw: unknown = JSON.parse(await readFile(file, "utf8"));
  const job = raw as (Partial<WorkerJob> & { kind?: unknown }) | null;
  if (!job || job.v !== WORKER_JOB_VERSION) {
    throw new Error(
      `this sandbox image speaks job version ${WORKER_JOB_VERSION} — rebuild it (npm run sandbox:build)`,
    );
  }
  if (job.kind === "capture") return readCaptureJob(raw as Partial<WorkerCaptureJob>);
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

function readCaptureJob(job: Partial<WorkerCaptureJob>): WorkerCaptureJob {
  const request = parseBackgroundCaptureRequest(job.request);
  if (!request.ok) throw new Error(`the capture's request is invalid: ${request.message}`);
  const budgetMs = Number(job.budgetMs);
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) throw new Error("the job has no time budget");
  const done = job.done;
  const validDone =
    done && typeof done.url === "string" && /^https?:\/\//.test(done.url) && typeof done.name === "string";
  return {
    v: WORKER_JOB_VERSION,
    kind: "capture",
    request: request.value,
    budgetMs,
    ...(validDone ? { done: { url: done.url, name: done.name } } : {}),
  };
}

/** How long one call to the site, or one upload, may take. */
const CALL_TIMEOUT_MS = 30_000;
/** A cell's own time limit, inside the capture's. */
const CELL_BUDGET_MS = 50_000;

/**
 * Run a whole background capture: shoot with the pooled browser, and talk to
 * the site over its ingest route. The site was checked to be public by the
 * function that took the request, and is checked again here, where the calls
 * are made from.
 */
async function runCaptureJob(job: WorkerCaptureJob): Promise<WorkerResult> {
  const { request } = job;
  const config = loadConfig({});
  const deadline = Date.now() + job.budgetMs;
  const hostname = new URL(request.origin).hostname;
  const resolved = await resolvePublic(hostname, { allowLoopback: config.allowLoopback });
  if (!resolved.ok) throw new Error(`${hostname} isn't a public address`);

  const endpoint = `${request.origin}${request.callback}`;
  const call = async <T>(c: CaptureCall): Promise<CaptureReply<T>> => {
    let problem = "the site didn't answer";
    // One more try for a call the network dropped; the site's calls are safe to repeat.
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            capture: { v: BACKGROUND_CAPTURE_VERSION, id: request.id, token: request.token, ...c },
          }),
          redirect: "error",
          signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        });
        const body = (await res.json().catch(() => null)) as CaptureReply<T> | null;
        if (body && typeof body.ok === "boolean") return body;
        if (res.status === 403) return { ok: false, gone: true, message: "the site refused the capture's token" };
        problem = `the site answered ${res.status}`;
        if (res.status < 500) break;
      } catch {
        problem = "the site didn't answer";
      }
    }
    return { ok: false, message: problem };
  };

  const deps: CaptureDeps = {
    shoot: async (slot, find): Promise<ShotResult> => {
      const cellDeadline = Math.min(deadline, Date.now() + CELL_BUDGET_MS);
      const shots = await withBrowser(config, (lease, pool) =>
        shootAll(
          pool,
          lease,
          request.origin,
          { routes: [slot.route], devices: [slot.device], themes: [slot.theme], find },
          cellDeadline,
        ),
      );
      const shot = shots[0];
      if (!shot) throw new Error("the shot came back empty");
      return shot;
    },
    call,
    put: async (url, headers, bytes) => {
      try {
        const res = await fetch(url, {
          method: "PUT",
          headers: { ...headers, "content-type": headers["x-content-type"] ?? "application/octet-stream" },
          body: new Blob([new Uint8Array(bytes)]),
          signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          return { ok: false, status: res.status, detail: `HTTP ${res.status}${text ? ` — ${text.slice(0, 160)}` : ""}` };
        }
        const put = (await res.json().catch(() => null)) as { url?: unknown } | null;
        return typeof put?.url === "string"
          ? { ok: true, status: res.status, url: put.url }
          : { ok: false, status: res.status, detail: "no URL came back" };
      } catch {
        return { ok: false, status: 0, detail: "the upload didn't go through" };
      }
    },
    log: (message) => console.warn(`[shots] ${message}`),
  };

  const outcome = await runCapture(request, deadline, deps);
  console.warn(
    `[shots] capture ${request.id}: ${outcome.recorded} cells recorded` +
      (outcome.error ? `, ended early: ${outcome.error}` : ""),
  );
  return { v: WORKER_JOB_VERSION, ok: true, capture: outcome };
}

/** Tell the service the capture is over, so it stops this sandbox now. Best effort. */
async function reportDone(done: NonNullable<WorkerCaptureJob["done"]>): Promise<void> {
  await fetch(done.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: done.name }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {});
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

  let job: WorkerJob | WorkerCaptureJob;
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

  if ("kind" in job) {
    // A whole capture, detached: nobody reads the result but a log.
    const capture = job;
    try {
      await answer(await runCaptureJob(capture));
      return 0;
    } catch (err) {
      return fail(firstLine(err));
    } finally {
      clearTimeout(overrun);
      if (capture.done) await reportDone(capture.done);
    }
  }
  const shots = job;

  try {
    // No environment: nothing in the sandbox configures the service, and the
    // defaults are the production rules — public addresses, web ports.
    const config = loadConfig({});
    const deadline = Date.now() + shots.budgetMs;
    const taken = await withBrowser(config, (lease, pool) =>
      shootAll(pool, lease, shots.origin, shots.request, deadline),
    );
    await answer({ v: WORKER_JOB_VERSION, ok: true, shots: taken });
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
