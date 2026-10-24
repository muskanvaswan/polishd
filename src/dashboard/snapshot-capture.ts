/**
 * Polishd — the snapshot capture loop, run in the owner's browser.
 *
 * For each route × rendering the dashboard asks Polishd's screenshot service
 * to shoot it. The service shoots the origin this page is on — the browser
 * sets the Origin header, and the service takes the site from there — and
 * hands back WebP images, which show up in the gallery as they arrive and
 * are then stored: uploaded straight to Vercel Blob with a presigned URL the
 * server issues, or streamed to the server's disk in chunks. Each cell is
 * recorded with the server once its images are stored.
 *
 * When the service can't be used — this page is on localhost, or the service
 * is unreachable, or the site's CSP blocks it — the same loop has the server
 * shoot each cell with its own browser instead, wherever it has one. Rate
 * limits and protected previews end the run with a message; whatever was
 * already shot is kept.
 */
import type {
  EncodedImage,
  FindTarget,
  ShootResponse,
  ShotResult,
  SnapshotDevice,
  SnapshotTheme,
} from "../capture/protocol";
import type { BlobAccess } from "../server/snapshot-blob";
import type { ShotSlot } from "../server/snapshot-files";
import type { PolishdSnapshot, ShotRecord, SnapshotPlan, StoredImage } from "../server/snapshots";
import {
  appendSnapshotChunkAction,
  beginSnapshotCaptureAction,
  captureLocalShotAction,
  finishSnapshotCaptureAction,
  recordSnapshotShotAction,
  snapshotUploadTargetAction,
} from "./snapshot-actions";
import {
  blobUploadMessage,
  chunkRanges,
  classifyServiceError,
  localEngineNote,
  protectedMessage,
  serviceFailureMessage,
  type ServiceFailure,
} from "./snapshot-messages";

/** One cell as it arrives, for the live grid. */
export interface LiveShot {
  route: string;
  device: SnapshotDevice;
  theme: SnapshotTheme;
  /** A data URL, when the cell has an image. */
  src: string | null;
  skipped?: string;
}

export interface CaptureCallbacks {
  onPlan(plan: SnapshotPlan): void;
  onShot(shot: LiveShot): void;
  onProgress(done: number, total: number): void;
  /** Informational: who's shooting and why. */
  onNotice(message: string): void;
  onEngine(engine: "service" | "local"): void;
}

export type CaptureOutcome =
  | { ok: true; snapshot: PolishdSnapshot; warning: string | null }
  | { ok: false; message: string };

/** Cells in flight at once against the service; the local engine runs one at a time. */
const SERVICE_CONCURRENCY = 2;
/** Raw bytes per disk chunk — base64 brings it to ~700 KB, under the 1 MB action limit. */
const CHUNK_BYTES = 512 * 1024;
/** A shot takes seconds; a cold service, longer. */
const SERVICE_TIMEOUT_MS = 90_000;

function dataUrl(image: EncodedImage): string {
  return `data:${image.type};base64,${image.data}`;
}

function base64ToBytes(data: string): Uint8Array<ArrayBuffer> {
  const bin = atob(data);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  }
  return btoa(s);
}

/**
 * `fetch`, noting whether the page's CSP blocked it. A CSP refusal and a dead
 * server look identical to the caller — both reject with a TypeError — but a
 * refusal also fires `securitypolicyviolation` on the document, naming the
 * blocked URL. The event is queued separately from the rejection, so a beat
 * is allowed for it to land.
 */
async function fetchWatchingCsp(
  url: string,
  init: RequestInit,
): Promise<{ response: Response } | { error: unknown; csp: boolean }> {
  const origin = new URL(url).origin;
  let csp = false;
  const onViolation = (e: SecurityPolicyViolationEvent) => {
    if (e.blockedURI && (e.blockedURI === origin || e.blockedURI.startsWith(origin))) csp = true;
  };
  document.addEventListener("securitypolicyviolation", onViolation);
  try {
    return { response: await fetch(url, init) };
  } catch (error) {
    await new Promise((r) => setTimeout(r, 50));
    return { error, csp };
  } finally {
    document.removeEventListener("securitypolicyviolation", onViolation);
  }
}

async function shootWithService(
  base: string,
  slot: ShotSlot,
  find: FindTarget[],
): Promise<{ ok: true; shot: ShotResult } | { ok: false; failure: ServiceFailure }> {
  const result = await fetchWatchingCsp(`${base}/shoot`, {
    method: "POST",
    mode: "cors",
    credentials: "omit",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ route: slot.route, device: slot.device, theme: slot.theme, find }),
    signal: AbortSignal.timeout(SERVICE_TIMEOUT_MS),
  });
  if ("error" in result) {
    return { ok: false, failure: { kind: result.csp ? "csp" : "unreachable" } };
  }
  const body = (await result.response.json().catch(() => null)) as ShootResponse | null;
  if (!result.response.ok) {
    return { ok: false, failure: classifyServiceError(result.response.status, body) };
  }
  const shot = body?.v === 1 && Array.isArray(body.shots) ? body.shots[0] : undefined;
  if (!shot) return { ok: false, failure: { kind: "down", status: result.response.status } };
  return { ok: true, shot: { ...shot, previews: shot.previews ?? [], looked: shot.looked ?? [] } };
}

class StoreError extends Error {}

/** Learned once per capture: which access mode the Blob store accepts. */
interface BlobAccessMemo {
  known: BlobAccess | null;
}

/** Store one image the service returned, wherever this install keeps them. */
async function storeImage(
  id: string,
  slot: ShotSlot,
  image: EncodedImage,
  memo: BlobAccessMemo,
): Promise<StoredImage> {
  const bytes = base64ToBytes(image.data);
  const target = await snapshotUploadTargetAction(id, slot, image.type, bytes.length);
  if (!target.ok) throw new StoreError(target.message);

  if (target.kind === "disk") {
    const ranges = chunkRanges(bytes.length, CHUNK_BYTES);
    for (const [i, [start, end]] of ranges.entries()) {
      const res = await appendSnapshotChunkAction(
        id,
        target.file,
        start,
        bytesToBase64(bytes.subarray(start, end)),
        i === ranges.length - 1,
      );
      if (!res.ok) throw new StoreError(res.message);
    }
    return { file: target.file };
  }

  // A store is public or private and nothing says which, so the first upload
  // tries public and then private; the answer is kept for the rest of the run.
  const known = target.access ?? memo.known;
  const attempts: BlobAccess[] = known ? [known] : ["public", "private"];
  let detail = "";
  for (const access of attempts) {
    const result = await fetchWatchingCsp(target.url, {
      method: "PUT",
      mode: "cors",
      credentials: "omit",
      headers: { ...target.headers, "x-vercel-blob-access": access },
      body: new Blob([bytes], { type: image.type }),
    });
    if ("error" in result) {
      throw new StoreError(blobUploadMessage("the request didn't go through", result.csp));
    }
    if (result.response.ok) {
      const put = (await result.response.json().catch(() => null)) as { url?: unknown } | null;
      if (typeof put?.url !== "string") throw new StoreError(blobUploadMessage("no URL came back", false));
      memo.known = access;
      return { file: target.file, url: put.url };
    }
    const text = await result.response.text().catch(() => "");
    detail = `HTTP ${result.response.status}${text ? ` — ${text.slice(0, 160)}` : ""}`;
  }
  throw new StoreError(blobUploadMessage(detail, false));
}

/**
 * Run a whole capture. Resolves with the recorded snapshot (and a warning if
 * the run was cut short), or with the reason nothing could be recorded.
 */
export async function runSnapshotCapture(cb: CaptureCallbacks): Promise<CaptureOutcome> {
  const begun = await beginSnapshotCaptureAction();
  if (!begun.ok) return { ok: false, message: begun.message };
  const plan: SnapshotPlan = begun;
  cb.onPlan(plan);

  let engine: "service" | "local" = plan.engine.kind;
  if (plan.engine.kind === "local") {
    if (!plan.localAvailable) {
      return { ok: false, message: localEngineNote(plan.origin, plan.engine.reason) };
    }
    cb.onNotice(localEngineNote(plan.origin, plan.engine.reason));
  }
  cb.onEngine(engine);
  const serviceBase = plan.engine.kind === "service" ? plan.engine.url : "";
  const serviceOrigin = serviceBase ? new URL(serviceBase).origin : "";

  // Rendering-major: every page's default view (desktop, light) first, so
  // the gallery's first screen fills in first, and the cells in flight
  // together are usually different pages.
  const units: ShotSlot[] = plan.renderings.flatMap((r) =>
    plan.routes.map((route) => ({ route, device: r.device, theme: r.theme })),
  );
  const total = units.length;
  let done = 0;
  /** A message that ends the run; cells already stored are still recorded. */
  let stop: string | null = null;
  const found = new Set<string>();
  /** Values being looked for by a cell in flight — not sent again until it answers. */
  const searching = new Set<string>();
  const memo: BlobAccessMemo = { known: null };

  // Recording reads and rewrites the server's pending record, so record calls
  // (and local shots, which record themselves) run strictly one at a time.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work);
    queue = next.catch(() => {});
    return next;
  };

  const findFor = (route: string): FindTarget[] =>
    plan.targets
      .filter((t) => t.pages.includes(route) && !found.has(t.key) && !searching.has(t.key))
      .slice(0, 16)
      .map((t) => ({ key: t.key, ref: t.ref }));

  const switchToLocal = (failure: ServiceFailure): boolean => {
    if (engine === "local") return true;
    if (!plan.localAvailable) {
      stop ??= serviceFailureMessage(failure, { origin: plan.origin, serviceOrigin, fellBack: false });
      return false;
    }
    engine = "local";
    cb.onEngine("local");
    cb.onNotice(serviceFailureMessage(failure, { origin: plan.origin, serviceOrigin, fellBack: true }));
    return true;
  };

  const shootLocal = async (slot: ShotSlot) => {
    const res = await serial(() => captureLocalShotAction(plan.id, slot, findFor(slot.route).map((t) => t.key)));
    if (!res.ok) {
      stop ??= res.message;
      return;
    }
    for (const p of res.shot.previews) found.add(p.key);
    cb.onShot({
      ...slot,
      src: res.shot.image ? dataUrl(res.shot.image) : null,
      ...(res.shot.skipped ? { skipped: res.shot.skipped } : {}),
    });
  };

  const shootRemote = async (slot: ShotSlot): Promise<"done" | "fallback"> => {
    const find = findFor(slot.route);
    for (const t of find) searching.add(t.key);
    try {
      return await shootAndStore(slot, find);
    } finally {
      for (const t of find) searching.delete(t.key);
    }
  };

  const shootAndStore = async (slot: ShotSlot, find: FindTarget[]): Promise<"done" | "fallback"> => {
    const res = await shootWithService(serviceBase, slot, find);
    if (!res.ok) {
      const { failure } = res;
      if (failure.kind === "rate_limited" || failure.kind === "rejected") {
        stop ??= serviceFailureMessage(failure, { origin: plan.origin, serviceOrigin, fellBack: false });
        return "done";
      }
      return switchToLocal(failure) ? "fallback" : "done";
    }
    const { shot } = res;
    if (shot.reason === "protected") {
      stop ??= protectedMessage(plan.origin);
      return "done";
    }
    cb.onShot({
      ...slot,
      src: shot.image ? dataUrl(shot.image) : null,
      ...(shot.skipped ? { skipped: shot.skipped } : {}),
    });

    try {
      const image = shot.image ? await storeImage(plan.id, slot, shot.image, memo) : undefined;
      const previews: ShotRecord["previews"] = [];
      for (const [n, p] of shot.previews.entries()) {
        previews.push({ key: p.key, image: await storeImage(plan.id, { ...slot, preview: n }, p.image, memo) });
      }
      const record: ShotRecord = {
        route: slot.route,
        device: slot.device,
        theme: slot.theme,
        ...(shot.hash ? { hash: shot.hash } : {}),
        ...(shot.reason ? { reason: shot.reason } : {}),
        ...(shot.skipped ? { skipped: shot.skipped } : {}),
        ...(image ? { image } : {}),
        previews,
        looked: shot.looked,
        engine: "service",
        ...(memo.known ? { access: memo.known } : {}),
      };
      const recorded = await serial(() => recordSnapshotShotAction(plan.id, record));
      if (!recorded.ok) {
        stop ??= recorded.message;
        return "done";
      }
      for (const p of shot.previews) found.add(p.key);
    } catch (err) {
      stop ??= err instanceof StoreError ? err.message : "Couldn't store the screenshots.";
    }
    return "done";
  };

  let cursor = 0;
  const worker = async () => {
    for (;;) {
      if (stop) return;
      const slot = units[cursor++];
      if (!slot) return;
      try {
        const handled = engine === "service" && (await shootRemote(slot)) === "done";
        if (!handled && !stop) await shootLocal(slot);
      } catch {
        stop ??= "The capture failed before a result came back — the server's logs will name the failure.";
      }
      done++;
      cb.onProgress(done, total);
    }
  };
  await Promise.all(
    Array.from({ length: engine === "service" ? SERVICE_CONCURRENCY : 1 }, () => worker()),
  );
  await queue;

  const fin = await finishSnapshotCaptureAction(plan.id);
  if (!fin.ok) return { ok: false, message: stop ?? fin.message };
  const cut = stop ? `${stop} The pages shot before that are in the snapshot.` : null;
  return { ok: true, snapshot: fin.snapshot, warning: cut };
}
