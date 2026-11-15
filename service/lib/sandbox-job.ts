/**
 * What passes between the function and the capture worker in a Vercel
 * Sandbox (sandbox.ts on this side, sandbox/worker.ts on that one).
 *
 * Both ends import this file and nothing else from each other, so it stays
 * free of imports: the worker's copy is baked into the sandbox image, and a
 * job is the whole contract between an image built last month and a function
 * deployed today. Add optional fields; don't change or remove one without
 * bumping `WORKER_JOB_VERSION` and rebuilding the image.
 */
import type { BackgroundCaptureRequest } from "../../src/capture/background.ts";
import type { ShootRequest, ShotResult } from "../../src/capture/protocol.ts";

export const WORKER_JOB_VERSION = 1;

/**
 * The launcher the image build writes, relative to the sandbox's working
 * directory. It sets the environment the worker needs and runs it, so the
 * function knows one path and nothing about how the image is laid out.
 */
export const WORKER_SCRIPT = "app/run.sh";

/** Where jobs and their results are written, relative to the same directory. */
export const WORKER_JOB_DIR = "app/jobs";

/** Set by the launcher: tells browser.ts it's in the sandbox, not a function. */
export const WORKER_ENV = "SHOTS_WORKER";

export interface WorkerJob {
  v: typeof WORKER_JOB_VERSION;
  /** The site to shoot, as the route took it from the Origin header. */
  origin: string;
  request: ShootRequest;
  /** Wall-clock time the worker has for the shots, from when it starts. */
  budgetMs: number;
}

/**
 * A whole background capture, run detached: the worker shoots every page and
 * reports to the site itself (capture-run.ts), so nothing waits on it. The
 * result file is only a log line for whoever looks.
 */
export interface WorkerCaptureJob {
  v: typeof WORKER_JOB_VERSION;
  kind: "capture";
  request: BackgroundCaptureRequest;
  /** Wall-clock time for the whole capture, inside the sandbox's own timeout. */
  budgetMs: number;
  /** Where to say it's done, so the sandbox is stopped rather than left to time out. */
  done?: { url: string; name: string };
}

export type WorkerResult =
  | { v: typeof WORKER_JOB_VERSION; ok: true; shots: ShotResult[] }
  | { v: typeof WORKER_JOB_VERSION; ok: false; message: string }
  | { v: typeof WORKER_JOB_VERSION; ok: true; capture: { recorded: number; shots: number | null; error: string | null } };
