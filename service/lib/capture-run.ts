/**
 * A whole capture, run by the worker in the sandbox: every page shot, each
 * image put straight into the site's storage, each shot reported to the site.
 *
 * This is the loop a dashboard runs in the owner's browser
 * (src/dashboard/snapshot-capture.ts), without the browser. Same order — the
 * landing page's phone view in both themes first, and a site that renders the
 * same in both has no other dark rendering shot — the same rotation of values
 * to picture, the same two cells in flight. What differs is who it talks to:
 * the site, over its ingest route, with the capture's token
 * (src/capture/background.ts has the contract).
 *
 * The first thing that goes wrong storing or recording ends the run, and
 * whatever was recorded by then is still closed into a snapshot. A site that
 * says the capture is gone — replaced by one the owner started — ends it with
 * nothing to close.
 *
 * Everything it touches is injected, so the loop is tested without a browser,
 * a site or a network.
 */
import {
  isBlobUploadUrl,
  type BackgroundCaptureRequest,
  type CaptureBlobAccess,
  type CaptureCall,
  type CaptureFailure,
  type CaptureShotRecord,
  type CaptureSlot,
  type CaptureStoredImage,
  type CaptureTargetReply,
} from "../../src/capture/background.ts";
import type { EncodedImage, FindTarget, ShotResult } from "../../src/capture/protocol.ts";
import { captureOrder, darkModeVerdict } from "../../src/server/snapshot-files.ts";

/** Cells in flight at once: what two vCPUs shoot comfortably. */
const CONCURRENCY = 2;
/** Raw bytes per chunk for a site that keeps images on disk: base64 keeps it under its 1 MB body cap. */
const CHUNK_BYTES = 512 * 1024;
/** A cell isn't started with less than this left: it couldn't be shot and stored. */
const CELL_ESTIMATE_MS = 25_000;

export type CaptureReply<T> = (T & { ok: true }) | CaptureFailure;

export interface CaptureDeps {
  /** Shoot one cell. Never rejects for a page's sake; a rejection is the browser's. */
  shoot(slot: CaptureSlot, find: FindTarget[]): Promise<ShotResult>;
  /** One call to the site. A transport failure comes back as `{ ok: false }`, not a rejection. */
  call<T = object>(call: CaptureCall): Promise<CaptureReply<T>>;
  /** Upload to a presigned URL. */
  put(
    url: string,
    headers: Record<string, string>,
    bytes: Uint8Array,
  ): Promise<{ ok: boolean; status: number; url?: string; detail?: string }>;
  log?(message: string): void;
}

export interface CaptureOutcome {
  /** Cells recorded with the site. */
  recorded: number;
  /** Shots the site kept in the snapshot, when it closed one. */
  shots: number | null;
  /** Why the run ended early, or why nothing was closed. Null: every cell was dealt with. */
  error: string | null;
}

/** The site no longer has this capture. */
class Gone extends Error {}

export async function runCapture(
  request: BackgroundCaptureRequest,
  deadline: number,
  deps: CaptureDeps,
): Promise<CaptureOutcome> {
  const log = deps.log ?? (() => {});
  const { probe, rest } = captureOrder(request.routes, request.renderings);
  const slotKey = (s: CaptureSlot) => `${s.route}|${s.device}|${s.theme}`;
  const hashes = new Map<string, string>();
  const found = new Set<string>();
  /** Values a cell in flight is looking for — not handed to another until it answers. */
  const searching = new Set<string>();
  const tries = new Map<string, number>();
  let access: CaptureBlobAccess | null = null;
  let recorded = 0;
  let error: string | null = null;
  let gone = false;
  const stopped = () => error !== null || gone;

  // Recording reads and rewrites the site's one pending record: one at a time.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work);
    queue = next.catch(() => {});
    return next;
  };

  /** A reply's payload, or the failure as an exception — `Gone` when the capture is. */
  const expect = <T>(reply: CaptureReply<T>): T => {
    if (reply.ok) return reply;
    if (reply.gone) throw new Gone(reply.message);
    throw new Error(reply.message || "the site refused the call");
  };

  // The values looked for least so far, so ones that never turn up don't
  // hold every slot while the rest of the list never gets a turn.
  const findFor = (slot: CaptureSlot): FindTarget[] =>
    request.targets
      .map((t, order) => ({ t, order }))
      .filter(({ t }) => t.pages.includes(slot.route) && !found.has(t.key) && !searching.has(t.key))
      .sort((a, b) => (tries.get(a.t.key) ?? 0) - (tries.get(b.t.key) ?? 0) || a.order - b.order)
      .slice(0, 16)
      .map(({ t }) => ({ key: t.key, ref: t.ref }));

  const store = async (slot: CaptureSlot, image: EncodedImage): Promise<CaptureStoredImage> => {
    const bytes = Buffer.from(image.data, "base64");
    const target = expect(
      await deps.call<CaptureTargetReply>({ op: "target", slot, type: image.type, size: bytes.length }),
    );
    if (target.kind === "disk") {
      for (let start = 0; start < bytes.length; start += CHUNK_BYTES) {
        const end = Math.min(bytes.length, start + CHUNK_BYTES);
        expect(
          await deps.call({
            op: "chunk",
            file: target.file,
            offset: start,
            data: bytes.subarray(start, end).toString("base64"),
            last: end === bytes.length,
          }),
        );
      }
      return { file: target.file };
    }

    // The site names the URL; the worker only uploads to Vercel's Blob API.
    if (!isBlobUploadUrl(target.url)) throw new Error("the site issued an upload URL that isn't Vercel Blob's");
    // A store is public or private and nothing says which, so the first
    // upload tries both; the answer is kept for the rest of the run.
    const known = target.access ?? access;
    const attempts: CaptureBlobAccess[] = known ? [known] : ["public", "private"];
    let detail = "";
    for (const attempt of attempts) {
      const put = await deps.put(target.url, { ...target.headers, "x-vercel-blob-access": attempt }, bytes);
      if (put.ok && put.url) {
        access = attempt;
        return { file: target.file, url: put.url };
      }
      detail = put.detail ?? `HTTP ${put.status}`;
    }
    throw new Error(`the image couldn't be uploaded to the site's Blob store (${detail})`);
  };

  const shootAndStore = async (slot: CaptureSlot): Promise<void> => {
    const find = findFor(slot);
    for (const t of find) searching.add(t.key);
    try {
      const shot = await deps.shoot(slot, find);
      if (shot.reason === "protected") {
        // Every page would get the same login. Nothing more to shoot.
        error ??= "The site is behind Vercel's Deployment Protection, so the screenshot service only sees a login.";
        return;
      }
      const image = shot.image ? await store(slot, shot.image) : undefined;
      const previews: CaptureShotRecord["previews"] = [];
      for (const [n, p] of shot.previews.entries()) {
        previews.push({ key: p.key, image: await store({ ...slot, preview: n }, p.image) });
      }
      const record: CaptureShotRecord = {
        route: slot.route,
        device: slot.device,
        theme: slot.theme,
        ...(shot.hash ? { hash: shot.hash } : {}),
        ...(shot.reason ? { reason: shot.reason } : {}),
        ...(shot.skipped ? { skipped: shot.skipped } : {}),
        ...(image ? { image } : {}),
        previews,
        looked: shot.looked,
        ...(access ? { access } : {}),
      };
      expect(await serial(() => deps.call({ op: "record", record })));
      recorded++;
      for (const p of shot.previews) found.add(p.key);
      for (const key of shot.looked) tries.set(key, (tries.get(key) ?? 0) + 1);
      if (shot.hash) hashes.set(slotKey(slot), shot.hash);
    } catch (err) {
      if (err instanceof Gone) gone = true;
      else error ??= err instanceof Error ? err.message : "the capture failed";
    } finally {
      for (const t of find) searching.delete(t.key);
    }
  };

  const shootAll = async (slots: CaptureSlot[]): Promise<void> => {
    let cursor = 0;
    const worker = async () => {
      for (;;) {
        if (stopped()) return;
        const slot = slots[cursor++];
        if (!slot) return;
        if (Date.now() + CELL_ESTIMATE_MS > deadline) {
          error ??= "The capture ran out of time before every page was shot.";
          return;
        }
        await shootAndStore(slot);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  };

  await shootAll(probe);
  // The landing page rendered the same in light and dark: the site has one
  // look, so no other page's dark rendering is shot. A probe that didn't
  // come back whole settles nothing, and every cell is shot.
  const oneLook = darkModeVerdict(
    probe.map((s) => {
      const hash = hashes.get(slotKey(s));
      return hash ? { ...s, hash } : s;
    }),
  ).noDarkMode;
  await shootAll(oneLook ? rest.filter((s) => s.theme !== "dark") : rest);
  await queue;

  if (gone) {
    log("the site no longer has this capture; nothing to close");
    return { recorded, shots: null, error: "The capture was replaced before it finished." };
  }
  const finished = await deps.call<{ shots?: number }>({ op: "finish", ...(error ? { error } : {}) });
  if (!finished.ok) {
    return { recorded, shots: null, error: error ?? finished.message };
  }
  return { recorded, shots: typeof finished.shots === "number" ? finished.shots : recorded, error };
}
