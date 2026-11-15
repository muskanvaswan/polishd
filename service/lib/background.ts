/**
 * Background captures, from the function's side: check the site really asked,
 * start a sandbox on the whole capture, and stop it when the worker says it's
 * done.
 *
 * A capture a dashboard drives is forty-odd requests, each answered within a
 * function's minute. A background capture is one request the function can't
 * wait out — it takes minutes — so the function only starts it. The sandbox
 * gets a job for the whole capture and runs it detached; the worker there
 * shoots, stores and reports to the site by itself (capture-run.ts), and
 * nothing in this function is waiting when it finishes.
 *
 * One sandbox per capture, with a name this function makes up. That name is
 * what the worker sends back to `/captures/done`, so the sandbox is stopped
 * as soon as the work is — its memory is paid for until it stops — instead
 * of idling out the rest of its timeout. The timeout is still there for a
 * worker that never calls: sized to the capture, with room to spare.
 */
import { randomBytes } from "node:crypto";

import {
  BACKGROUND_CAPTURE_VERSION,
  type BackgroundCaptureRequest,
} from "../../src/capture/background.ts";
import { WORKER_JOB_DIR, WORKER_JOB_VERSION, WORKER_SCRIPT, type WorkerCaptureJob } from "./sandbox-job.ts";
import { SANDBOX_TAGS, tidy, type SandboxSettings } from "./sandbox.ts";

const NAME = /^polishd-capture-[a-f0-9]{24}$/;

/** How long the site gets to say the capture is its own. */
const HELLO_TIMEOUT_MS = 10_000;
/** Time kept between the worker's budget and the sandbox's timeout, for its last calls. */
const WIND_DOWN_MS = 45_000;

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Ask the site whether this capture is one it parked. Anyone can post a
 * capture request naming any site; only that site's own server knows the id
 * and token of a capture it started. Asked before a rate limit is spent or a
 * sandbox started, so a stranger can't use up a site's captures for the week.
 */
export async function confirmWithSite(
  request: BackgroundCaptureRequest,
  doFetch: FetchLike = fetch,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const res = await doFetch(`${request.origin}${request.callback}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        capture: { v: BACKGROUND_CAPTURE_VERSION, id: request.id, token: request.token, op: "hello" },
      }),
      redirect: "error",
      signal: AbortSignal.timeout(HELLO_TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => null)) as { ok?: unknown } | null;
    if (res.ok && body?.ok === true) return { ok: true };
    return { ok: false, message: `The site didn't confirm the capture (HTTP ${res.status}).` };
  } catch {
    return { ok: false, message: "The site didn't answer when asked to confirm the capture." };
  }
}

/** The sandbox's lifetime for a capture of `cells` renderings: generous, and bounded. */
export function captureTimeoutMs(cells: number): number {
  const estimate = cells * 5_000 + 120_000;
  return Math.min(14 * 60_000, Math.max(4 * 60_000, estimate));
}

/**
 * Start a sandbox on the capture and come straight back. Resolves once the
 * worker is running; what it does from there is between it and the site.
 */
export async function startCaptureSandbox(
  settings: SandboxSettings,
  request: BackgroundCaptureRequest,
  doneUrl: string,
): Promise<{ name: string }> {
  if (!settings.snapshotId) {
    throw new Error("SHOTS_SANDBOX_SNAPSHOT_ID isn't set — build the image with npm run sandbox:build");
  }
  const { Sandbox } = await import("@vercel/sandbox");
  const name = `polishd-capture-${randomBytes(12).toString("hex")}`;
  const timeout = captureTimeoutMs(request.routes.length * request.renderings.length);
  const sandbox = await Sandbox.create({
    name,
    source: { type: "snapshot", snapshotId: settings.snapshotId },
    resources: { vcpus: settings.vcpus },
    timeout,
    persistent: false,
    tags: SANDBOX_TAGS,
  });
  void tidy(Sandbox, name);

  const job: WorkerCaptureJob = {
    v: WORKER_JOB_VERSION,
    kind: "capture",
    request,
    budgetMs: timeout - WIND_DOWN_MS,
    done: { url: doneUrl, name },
  };
  const jobFile = `${WORKER_JOB_DIR}/${request.id}.job.json`;
  const resultFile = `${WORKER_JOB_DIR}/${request.id}.result.json`;
  try {
    await sandbox.writeFiles([{ path: jobFile, content: JSON.stringify(job) }]);
    await sandbox.runCommand({ cmd: "sh", args: [WORKER_SCRIPT, jobFile, resultFile], detached: true });
  } catch (err) {
    await sandbox.stop().catch(() => {});
    throw err;
  }
  return { name };
}

/**
 * Stop the sandbox a finished capture ran in, and drop its record. Only ever
 * a sandbox this service started for a capture: the name has to be one of
 * its own making, and carry its tag. False when there was nothing to stop.
 */
export async function stopCaptureSandbox(name: unknown): Promise<boolean> {
  if (typeof name !== "string" || !NAME.test(name)) return false;
  try {
    const { Sandbox } = await import("@vercel/sandbox");
    const sandbox = await Sandbox.get({ name, resume: false });
    if (sandbox.tags?.service !== SANDBOX_TAGS.service) return false;
    await sandbox.stop().catch(() => {});
    await sandbox.delete().catch(() => {});
    return true;
  } catch {
    return false;
  }
}
