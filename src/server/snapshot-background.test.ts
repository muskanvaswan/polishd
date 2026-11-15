/**
 * The weekly background capture, site side, against a real SQLite store and a
 * real snapshot directory: when one is due, what's asked of the service, and
 * the worker's calls coming back through to a snapshot in the gallery.
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "polishd-background-"));
for (const key of ["POLISHD_DATABASE_URL", "BUFFD_DATABASE_URL", "POLISH_DATABASE_URL", "VERCEL", "VERCEL_ENV", "POLISHD_SNAPSHOT_AUTO", "BLOB_STORE_ID", "BLOB_READ_WRITE_TOKEN"]) {
  delete process.env[key];
}
process.env.POLISHD_DB_PATH = join(dir, "test.db");
process.env.POLISHD_SNAPSHOT_DIR = join(dir, "snapshots");
// A service of its own, so the section's mode is `service` on any origin.
process.env.POLISHD_SNAPSHOT_SERVICE = "https://shots.test/api/v1";

const {
  BACKGROUND_EVERY_MS,
  BACKGROUND_RETRY_MS,
  backgroundCaptureDue,
  handleCaptureCall,
  maybeStartBackgroundCapture,
} = await import("./snapshot-background.ts");
const { loadSnapshotAutoState, resolveSnapshotAuto, saveSnapshotAutoMode, saveSnapshotAutoState } = await import(
  "./snapshot-auto.ts"
);
const { listSnapshots, saveSnapshotConsent, snapshotAvailability } = await import("./snapshots.ts");
const { parseCaptureCall } = await import("../capture/background.ts");
import type { BackgroundCaptureRequest, CaptureCall } from "../capture/background.ts";

const ORIGIN = "https://example.com";
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 15, 12);

const due = (patch: Partial<Parameters<typeof backgroundCaptureDue>[0]>) =>
  backgroundCaptureDue({
    now: T0,
    mode: "weekly",
    serviceReady: true,
    latestSnapshotAt: null,
    lastAttemptAt: null,
    pendingStartedAt: null,
    ...patch,
  });

test("a capture is due once the newest snapshot is a week old, however it was taken", () => {
  assert.deepEqual(due({}), { due: true });
  assert.deepEqual(due({ latestSnapshotAt: T0 - BACKGROUND_EVERY_MS }), { due: true });
  assert.equal(due({ latestSnapshotAt: T0 - BACKGROUND_EVERY_MS + 1 }).due, false);
});

test("not when it's off, not allowed, tried within a day, or a capture is running", () => {
  assert.equal(due({ mode: "off" }).due, false);
  assert.equal(due({ serviceReady: false }).due, false);
  assert.equal(due({ lastAttemptAt: T0 - BACKGROUND_RETRY_MS + 1 }).due, false);
  assert.equal(due({ lastAttemptAt: T0 - BACKGROUND_RETRY_MS }).due, true);
  assert.equal(due({ pendingStartedAt: T0 - 60_000 }).due, false);
  assert.equal(due({ pendingStartedAt: T0 - 21 * 60_000 }).due, true, "an abandoned capture doesn't hold it up");
});

test("the environment overrules the owner's switch, and takes it away", () => {
  assert.deepEqual(resolveSnapshotAuto({}, undefined), { mode: "weekly", locked: false, lastFinishedAt: null, lastError: null });
  assert.equal(resolveSnapshotAuto({ mode: "off" }, undefined).mode, "off");
  assert.deepEqual(resolveSnapshotAuto({ mode: "weekly" }, "off"), { mode: "off", locked: true, lastFinishedAt: null, lastError: null });
  assert.equal(resolveSnapshotAuto({ mode: "off" }, "weekly").mode, "weekly");
});

/** A service that accepts, and remembers what it was asked. */
function acceptingService() {
  const asked: { url: string; request: BackgroundCaptureRequest }[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    asked.push({ url, request: JSON.parse(String(init.body)) as BackgroundCaptureRequest });
    return new Response(JSON.stringify({ v: 1, ok: true }), { status: 202 });
  };
  return { asked, fetch };
}

/** One call, as the worker would send it and the ingest route would read it. */
async function workerCall(request: BackgroundCaptureRequest, call: CaptureCall, token = request.token) {
  const parsed = parseCaptureCall({ capture: { v: 1, id: request.id, token, ...call } });
  assert.ok(parsed?.ok, "the call parses");
  return handleCaptureCall(parsed.value);
}

test("nothing starts until the owner has allowed the screenshot service", async () => {
  const service = acceptingService();
  const res = await maybeStartBackgroundCapture(ORIGIN, "/api/polishd", { now: T0, fetch: service.fetch });
  assert.deepEqual(res, { started: false, why: "the screenshot service isn't in use here" });
  assert.equal(service.asked.length, 0);
});

test("allowed and due: the capture is parked, the service asked, and the worker's calls make a snapshot", async () => {
  await saveSnapshotConsent(true);
  const service = acceptingService();
  const started = await maybeStartBackgroundCapture(ORIGIN, "/api/polishd", { now: T0, fetch: service.fetch });
  assert.equal(started.started, true);

  const [{ url, request }] = service.asked;
  assert.equal(url, "https://shots.test/api/v1/captures");
  assert.equal(request.origin, ORIGIN);
  assert.equal(request.callback, "/api/polishd");
  assert.deepEqual(request.routes, ["/"]);
  assert.equal(request.renderings.length, 4);
  assert.match(request.token, /^[a-f0-9]{64}$/);
  assert.equal(started.started && started.id, request.id);

  // The service checks the capture is the site's own before it spends anything.
  assert.deepEqual((await workerCall(request, { op: "hello" })).body, { ok: true });
  // Another token speaks for nothing.
  const stranger = await workerCall(request, { op: "hello" }, "cd".repeat(32));
  assert.equal(stranger.status, 403);
  assert.equal((stranger.body as { gone?: boolean }).gone, true);

  // One rendering: an image in two chunks, then its record.
  const slot = { route: "/", device: "desktop" as const, theme: "light" as const };
  const image = Buffer.alloc(900, 7);
  const target = (await workerCall(request, { op: "target", slot, type: "image/webp", size: image.length })).body;
  assert.deepEqual(target, { ok: true, kind: "disk", file: "r0-desktop-light.webp" });
  for (const [offset, end] of [[0, 500], [500, 900]] as const) {
    const chunk = await workerCall(request, {
      op: "chunk",
      file: "r0-desktop-light.webp",
      offset,
      data: image.subarray(offset, end).toString("base64"),
      last: end === image.length,
    });
    assert.deepEqual(chunk.body, { ok: true });
  }
  const recorded = await workerCall(request, {
    op: "record",
    record: { ...slot, hash: "abc", image: { file: "r0-desktop-light.webp" }, previews: [], looked: [] },
  });
  assert.deepEqual(recorded.body, { ok: true });

  // A record for an image that was never uploaded is refused.
  const unstored = await workerCall(request, {
    op: "record",
    record: { ...slot, theme: "dark", image: { file: "r0-desktop-dark.webp" }, previews: [], looked: [] },
  });
  assert.equal(unstored.body.ok, false);

  const finished = await workerCall(request, { op: "finish" });
  assert.deepEqual(finished.body, { ok: true, shots: 1 });

  const [snapshot] = await listSnapshots();
  assert.equal(snapshot?.id, request.id);
  assert.equal(snapshot?.auto, true);
  assert.equal(snapshot?.origin, ORIGIN);
  assert.deepEqual(snapshot?.engines, ["service"]);
  assert.ok(existsSync(join(dir, "snapshots", request.id, "shots", "r0-desktop-light.webp")));

  // The capture is closed: its token is spent.
  assert.equal((await workerCall(request, { op: "hello" })).status, 403);
  const auto = (await snapshotAvailability(ORIGIN)).auto;
  assert.equal(auto.mode, "weekly");
  assert.equal(typeof auto.lastFinishedAt, "number");
  assert.equal(auto.lastError, null);
});

test("with a fresh snapshot nothing starts, and nothing is tried again within a day of an attempt", async () => {
  const service = acceptingService();
  // The snapshot above was just taken; even a week past the last attempt it's too new.
  const soon = await maybeStartBackgroundCapture(ORIGIN, "/api/polishd", { now: Date.now() + 2 * DAY, fetch: service.fetch });
  assert.deepEqual(soon, { started: false, why: "the newest snapshot is under a week old" });
  assert.equal(service.asked.length, 0);
});

test("a service that refuses leaves no capture parked, and the reason for the dashboard", async () => {
  const later = Date.now() + 8 * DAY;
  const refusing = async () =>
    new Response(JSON.stringify({ v: 1, error: { code: "rate_limited", message: "This site has had its captures." } }), {
      status: 429,
    });
  const res = await maybeStartBackgroundCapture(ORIGIN, "/api/polishd", { now: later, fetch: refusing });
  assert.equal(res.started, false);
  assert.match((res as { why: string }).why, /answered 429: This site has had its captures/);

  const state = await loadSnapshotAutoState();
  assert.equal(state.lastAttemptAt, later);
  assert.match(state.lastError ?? "", /answered 429/);

  // Tried, so not again for a day — even though it's still due.
  const service = acceptingService();
  const again = await maybeStartBackgroundCapture(ORIGIN, "/api/polishd", { now: later + DAY - 1, fetch: service.fetch });
  assert.deepEqual(again, { started: false, why: "one was tried within the last day" });
  const nextDay = await maybeStartBackgroundCapture(ORIGIN, "/api/polishd", { now: later + DAY, fetch: service.fetch });
  assert.equal(nextDay.started, true);
  assert.equal((await loadSnapshotAutoState()).lastError, undefined);
});

test("switched off, nothing starts; a preview deployment never does", async () => {
  await saveSnapshotAutoState({ mode: "weekly" });
  const service = acceptingService();
  await saveSnapshotAutoMode("off");
  const far = Date.now() + 30 * DAY;
  assert.deepEqual(await maybeStartBackgroundCapture(ORIGIN, "/api/polishd", { now: far, fetch: service.fetch }), {
    started: false,
    why: "weekly captures are off",
  });
  await saveSnapshotAutoMode("weekly");
  process.env.VERCEL_ENV = "preview";
  try {
    assert.deepEqual(await maybeStartBackgroundCapture(ORIGIN, "/api/polishd", { now: far, fetch: service.fetch }), {
      started: false,
      why: "not a production deployment",
    });
  } finally {
    delete process.env.VERCEL_ENV;
  }
  assert.equal(service.asked.length, 0);
});
