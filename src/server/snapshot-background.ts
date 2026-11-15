/**
 * Polishd — site snapshots taken in the background (server only).
 *
 * Once a week, without anyone opening the dashboard. A serverless site has
 * no clock of its own, so the check rides on traffic: the ingest route calls
 * `maybeStartBackgroundCapture` after it has stored a visitor's batch (and
 * answered it), at most every few minutes. A site nobody visited isn't shot.
 *
 * A capture is due when the owner has allowed the screenshot service, the
 * weekly switch is on, the newest snapshot — however it was taken — is more
 * than a week old, and no attempt was made in the last day. Then this plans
 * the capture exactly as the Design tab's button does, parks it with a token,
 * and asks the service for the whole thing in one request. The service's
 * worker shoots every page and calls back through the same ingest route
 * (`handleCaptureCall`) to store each image and record each shot. See
 * capture/background.ts for the contract.
 *
 * Nothing here can fail a visitor's request: it runs after the response, and
 * every path ends in a quiet result, with the reason kept for the dashboard.
 */
import { randomBytes } from "node:crypto";

import {
  BACKGROUND_CAPTURE_VERSION,
  type BackgroundCaptureRequest,
  type CaptureFailure,
  type CaptureTargetReply,
  type ParsedCaptureCall,
} from "../capture/background";
import {
  loadSnapshotAutoState,
  resolveSnapshotAuto,
  saveSnapshotAutoState,
  type SnapshotAutoState,
} from "./snapshot-auto";
import { SNAPSHOT_RENDERINGS } from "./snapshot-files";
import { planCapture } from "./snapshot-plan";
import {
  abandonSnapshot,
  appendSnapshotChunk,
  backgroundCaptureAuthorized,
  beginSnapshot,
  finishSnapshot,
  listSnapshots,
  pendingSnapshotStartedAt,
  recordSnapshotShot,
  snapshotAvailability,
  snapshotUploadTarget,
} from "./snapshots";

/** A snapshot older than this is due another. */
export const BACKGROUND_EVERY_MS = 7 * 86_400_000;
/** After an attempt, whatever came of it, the next waits this long. */
export const BACKGROUND_RETRY_MS = 86_400_000;
/** A capture begun this recently is still someone's: a background one won't sweep it. */
export const BACKGROUND_YIELD_MS = 20 * 60_000;
/** How long the service gets to accept the request. It only has to start the work. */
const REQUEST_TIMEOUT_MS = 30_000;

export interface BackgroundDueInput {
  now: number;
  mode: "weekly" | "off";
  /** The snapshot section's mode is `service`: allowed, storable, public. */
  serviceReady: boolean;
  /** When the newest gallery snapshot was taken, if there is one. */
  latestSnapshotAt: number | null;
  lastAttemptAt: number | null;
  /** When the capture in progress began, if one is. */
  pendingStartedAt: number | null;
}

/** Whether a background capture should start now, or why not. Pure. */
export function backgroundCaptureDue(input: BackgroundDueInput): { due: true } | { due: false; why: string } {
  if (input.mode === "off") return { due: false, why: "weekly captures are off" };
  if (!input.serviceReady) return { due: false, why: "the screenshot service isn't in use here" };
  if (input.lastAttemptAt !== null && input.now - input.lastAttemptAt < BACKGROUND_RETRY_MS) {
    return { due: false, why: "one was tried within the last day" };
  }
  if (input.latestSnapshotAt !== null && input.now - input.latestSnapshotAt < BACKGROUND_EVERY_MS) {
    return { due: false, why: "the newest snapshot is under a week old" };
  }
  if (input.pendingStartedAt !== null && input.now - input.pendingStartedAt < BACKGROUND_YIELD_MS) {
    return { due: false, why: "a capture is in progress" };
  }
  return { due: true };
}

export type BackgroundStart = { started: true; id: string } | { started: false; why: string };

export interface BackgroundDeps {
  now?: number;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
}

/** What the service said, in a sentence, for the record. */
async function refusal(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: { code?: unknown; message?: unknown } } | null;
  const message = typeof body?.error?.message === "string" ? body.error.message : "";
  return `The screenshot service answered ${res.status}${message ? `: ${message}` : ""}`.slice(0, 300);
}

/**
 * Start a background capture of `origin` if one is due. `callback` is the
 * path of the ingest route this was called from, which the worker calls back.
 */
export async function maybeStartBackgroundCapture(
  origin: string | null,
  callback: string,
  deps: BackgroundDeps = {},
): Promise<BackgroundStart> {
  const now = deps.now ?? Date.now();
  const doFetch = deps.fetch ?? fetch;
  try {
    if (!origin) return { started: false, why: "the site's origin isn't known" };
    // A preview deployment has traffic too, and isn't the site.
    if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") {
      return { started: false, why: "not a production deployment" };
    }

    const state = await loadSnapshotAutoState();
    const auto = resolveSnapshotAuto(state);
    if (auto.mode === "off") return { started: false, why: "weekly captures are off" };
    if (state.lastAttemptAt !== undefined && now - state.lastAttemptAt < BACKGROUND_RETRY_MS) {
      return { started: false, why: "one was tried within the last day" };
    }

    const availability = await snapshotAvailability(origin);
    const { mode } = availability;
    const due = backgroundCaptureDue({
      now,
      mode: auto.mode,
      serviceReady: mode.kind === "service",
      latestSnapshotAt: (await listSnapshots())[0]?.capturedAt ?? null,
      lastAttemptAt: state.lastAttemptAt ?? null,
      pendingStartedAt: await pendingSnapshotStartedAt(),
    });
    if (!due.due) return { started: false, why: due.why };
    if (mode.kind !== "service") return { started: false, why: "the screenshot service isn't in use here" };

    // Claim the attempt before anything slow, so two instances that both got
    // here don't both go on. Not a lock — a second start is refused by the
    // capture it sweeps — but it makes the overlap a matter of milliseconds.
    const attempt: SnapshotAutoState = { ...state, lastAttemptAt: now };
    delete attempt.lastError;
    if (!(await saveSnapshotAutoState(attempt))) return { started: false, why: "the store is read-only" };
    const failed = async (why: string): Promise<BackgroundStart> => {
      await saveSnapshotAutoState({ ...attempt, lastError: why.slice(0, 300) });
      return { started: false, why };
    };

    const plan = await planCapture({ review: false, engine: "service" });
    const token = randomBytes(32).toString("hex");
    const begun = await beginSnapshot({
      origin,
      routes: plan.routes,
      fingerprint: plan.fingerprint,
      targets: plan.targets,
      engine: { kind: "service", url: mode.url },
      backgroundToken: token,
    });
    if (!begun.ok) return failed(begun.message);

    const request: BackgroundCaptureRequest = {
      v: BACKGROUND_CAPTURE_VERSION,
      origin,
      callback,
      id: begun.id,
      token,
      routes: begun.routes,
      renderings: begun.renderings,
      targets: begun.targets.map((t) => ({ key: t.key, ref: t.ref, pages: t.pages })),
    };
    let res: Response;
    try {
      res = await doFetch(`${mode.url}/captures`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      await abandonSnapshot(begun.id);
      return failed("The screenshot service didn't answer.");
    }
    if (!res.ok) {
      await abandonSnapshot(begun.id);
      return failed(await refusal(res));
    }
    return { started: true, id: begun.id };
  } catch (err) {
    return { started: false, why: err instanceof Error ? err.message : "unknown error" };
  }
}

export interface CaptureCallResponse {
  status: number;
  body: ({ ok: true } & Record<string, unknown>) | CaptureFailure | CaptureTargetReply;
}

const GONE: CaptureCallResponse = {
  status: 403,
  body: { ok: false, gone: true, message: "That capture isn't in progress here." },
};

/**
 * Answer one call from the service's worker. The token is checked against the
 * capture parked in the store on every call; everything after that is the
 * same checking and recording a dashboard-driven capture goes through.
 */
export async function handleCaptureCall({ id, token, call }: ParsedCaptureCall): Promise<CaptureCallResponse> {
  try {
    if (!(await backgroundCaptureAuthorized(id, token))) return GONE;
    switch (call.op) {
      case "hello":
        return { status: 200, body: { ok: true } };
      case "target":
        return { status: 200, body: await snapshotUploadTarget(id, call.slot, call.type, call.size) };
      case "chunk":
        return {
          status: 200,
          body: await appendSnapshotChunk(id, call.file, call.offset, call.data, call.last),
        };
      case "record":
        return { status: 200, body: await recordSnapshotShot(id, { ...call.record, engine: "service" }) };
      case "finish": {
        const finished = await finishSnapshot(id);
        const state = await loadSnapshotAutoState();
        const next: SnapshotAutoState = { ...state };
        delete next.lastError;
        if (finished.ok) next.lastFinishedAt = finished.snapshot.capturedAt;
        const error = call.error ?? (finished.ok ? null : finished.message);
        if (error) next.lastError = error.slice(0, 300);
        await saveSnapshotAutoState(next);
        return finished.ok
          ? { status: 200, body: { ok: true, shots: finished.snapshot.shots.filter((s) => s.file).length } }
          : { status: 200, body: finished };
      }
    }
  } catch (err) {
    return {
      status: 200,
      body: { ok: false, message: err instanceof Error ? err.message : "The call failed." },
    };
  }
}
