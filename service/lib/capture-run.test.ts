import assert from "node:assert/strict";
import { test } from "node:test";

import type { BackgroundCaptureRequest, CaptureCall, CaptureSlot } from "../../src/capture/background.ts";
import type { FindTarget, ShotResult } from "../../src/capture/protocol.ts";
import { runCapture, type CaptureDeps, type CaptureReply } from "./capture-run.ts";

const TOKEN = "ab".repeat(32);
const RENDERINGS = [
  { device: "desktop", theme: "light" },
  { device: "desktop", theme: "dark" },
  { device: "phone", theme: "light" },
  { device: "phone", theme: "dark" },
] as const;

function plan(patch: Partial<BackgroundCaptureRequest> = {}): BackgroundCaptureRequest {
  return {
    v: 1,
    origin: "https://example.com",
    callback: "/api/polishd",
    id: "cap1",
    token: TOKEN,
    routes: ["/", "/pricing"],
    renderings: [...RENDERINGS],
    targets: [],
    ...patch,
  };
}

const key = (s: CaptureSlot) => `${s.route} ${s.device}/${s.theme}`;
const image = (bytes: number) => ({
  type: "image/webp",
  width: 10,
  height: 10,
  data: Buffer.alloc(bytes, 1).toString("base64"),
});

interface Site {
  deps: CaptureDeps;
  shot: string[];
  calls: CaptureCall[];
  puts: { url: string; access: string | undefined; bytes: number }[];
  finished: { error?: string } | null;
}

/**
 * A browser and a site. `shoot` decides each cell's result; the site stores
 * on disk unless `blob` says which access mode its store takes.
 */
function site(options: {
  shoot?: (slot: CaptureSlot, find: FindTarget[]) => Partial<ShotResult>;
  blob?: "public" | "private";
  reply?: (call: CaptureCall) => CaptureReply<object> | undefined;
} = {}): Site {
  const out: Site = { shot: [], calls: [], puts: [], finished: null, deps: null as unknown as CaptureDeps };
  let inRecord = 0;
  out.deps = {
    shoot: async (slot, find) => {
      out.shot.push(key(slot));
      const custom = options.shoot?.(slot, find) ?? {};
      return {
        route: slot.route,
        device: slot.device,
        theme: slot.theme,
        image: image(100),
        // A site with a dark mode: the two themes render differently.
        hash: `${slot.route}-${slot.device}-${slot.theme}`,
        previews: [],
        looked: find.map((t) => t.key),
        ...custom,
      };
    },
    call: async <T>(call: CaptureCall) => {
      out.calls.push(call);
      const custom = options.reply?.(call);
      if (custom) return custom as CaptureReply<T>;
      if (call.op === "target") {
        const preview = call.slot.preview === undefined ? "" : `-${call.slot.preview}`;
        const file = `${call.slot.preview === undefined ? "" : "v-"}r-${call.slot.device}-${call.slot.theme}${preview}.webp`;
        const target = options.blob
          ? { ok: true, kind: "blob", file, url: "https://vercel.com/api/blob/?p=" + file, headers: { "x-api-version": "12" }, access: null }
          : { ok: true, kind: "disk", file };
        return target as unknown as CaptureReply<T>;
      }
      if (call.op === "record") {
        // The site's record is read and rewritten whole: never two at once.
        assert.equal(++inRecord, 1, "records arrive one at a time");
        await new Promise((r) => setImmediate(r));
        inRecord--;
      }
      if (call.op === "finish") {
        out.finished = call.error ? { error: call.error } : {};
        return { ok: true, shots: out.calls.filter((c) => c.op === "record").length } as CaptureReply<T>;
      }
      return { ok: true } as CaptureReply<T>;
    },
    put: async (url, headers, bytes) => {
      const access = headers["x-vercel-blob-access"];
      out.puts.push({ url, access, bytes: bytes.length });
      return access === options.blob
        ? { ok: true, status: 200, url: `https://store.${access}.blob.vercel-storage.com/x.webp` }
        : { ok: false, status: 400, detail: "HTTP 400 — wrong access" };
    },
  };
  return out;
}

const FAR = () => Date.now() + 10 * 60_000;

test("the landing page's phone view goes first in both themes, then every page and rendering once", async () => {
  const s = site();
  const outcome = await runCapture(plan(), FAR(), s.deps);

  assert.deepEqual(s.shot.slice(0, 2).sort(), ["/ phone/dark", "/ phone/light"]);
  assert.equal(s.shot.length, 8);
  assert.equal(new Set(s.shot).size, 8);
  assert.deepEqual(outcome, { recorded: 8, shots: 8, error: null });
  assert.deepEqual(s.finished, {});
});

test("a site that renders the same in both themes has no other dark rendering shot", async () => {
  const s = site({ shoot: (slot) => ({ hash: `${slot.route}-${slot.device}` }) });
  const outcome = await runCapture(plan(), FAR(), s.deps);

  assert.deepEqual(
    s.shot.filter((k) => k.endsWith("/dark")),
    ["/ phone/dark"],
    "only the probe's",
  );
  assert.equal(s.shot.length, 5);
  assert.equal(outcome.recorded, 5);
});

test("an image goes to the site's disk in chunks under its body cap", async () => {
  const s = site({ shoot: () => ({ image: image(1_200_000) }) });
  await runCapture(plan({ routes: ["/"], renderings: [{ device: "desktop", theme: "light" }] }), FAR(), s.deps);

  const chunks = s.calls.filter((c) => c.op === "chunk");
  assert.deepEqual(
    chunks.map((c) => c.op === "chunk" && [c.offset, c.last]),
    [
      [0, false],
      [524_288, false],
      [1_048_576, true],
    ],
  );
  assert.ok(chunks.every((c) => c.op === "chunk" && JSON.stringify(c).length < 1_000_000));
  const record = s.calls.find((c) => c.op === "record");
  assert.deepEqual(record?.op === "record" && record.record.image, { file: "r-desktop-light.webp" });
});

test("a Blob store's access mode is found on the first upload and kept", async () => {
  const s = site({ blob: "private" });
  const outcome = await runCapture(plan({ routes: ["/"] }), FAR(), s.deps);

  assert.equal(outcome.error, null);
  // The first image tries public, then private; whatever was in flight beside
  // it may try both too; after that, private alone.
  assert.equal(s.puts[0]?.access, "public");
  assert.equal(s.puts.at(-1)?.access, "private");
  assert.ok(s.puts.filter((p) => p.access === "public").length <= 2);
  const records = s.calls.flatMap((c) => (c.op === "record" ? [c.record] : []));
  assert.ok(records.every((r) => r.image?.url?.includes(".private.blob.")));
  assert.equal(records.at(-1)?.access, "private", "and reported, so the site signs the next URL for it");
});

test("an upload URL that isn't Vercel Blob's is never sent to", async () => {
  const s = site({
    reply: (call) =>
      call.op === "target"
        ? ({ ok: true, kind: "blob", file: "r.webp", url: "https://169.254.169.254/put", headers: {}, access: null } as CaptureReply<object>)
        : undefined,
  });
  const outcome = await runCapture(plan({ routes: ["/"] }), FAR(), s.deps);

  assert.equal(s.puts.length, 0);
  assert.match(outcome.error ?? "", /isn't Vercel Blob's/);
  assert.match(s.finished?.error ?? "", /isn't Vercel Blob's/, "the site is told why it ended early");
});

test("values are looked for on their pages, found ones aren't looked for again, and pictures are stored with the cell", async () => {
  const targets = [
    { key: "radius:7px", ref: { kind: "radius" as const, value: "7px" }, pages: ["/"] },
    { key: "radius:9px", ref: { kind: "radius" as const, value: "9px" }, pages: ["/pricing"] },
  ];
  const asked: Record<string, string[]> = {};
  const s = site({
    shoot: (slot, find) => {
      asked[key(slot)] = find.map((t) => t.key);
      const hit = find.find((t) => t.key === "radius:7px");
      return hit ? { previews: [{ key: hit.key, image: image(50) }] } : {};
    },
  });
  await runCapture(plan({ targets }), FAR(), s.deps);

  const landing = Object.entries(asked).filter(([cell]) => cell.startsWith("/ "));
  assert.equal(landing.filter(([, keys]) => keys.includes("radius:7px")).length, 1, "found once, then left alone");
  assert.ok(Object.entries(asked).every(([cell, keys]) => !keys.includes("radius:9px") || cell.startsWith("/pricing ")));
  const withPreview = s.calls.filter((c) => c.op === "record" && c.record.previews.length > 0);
  assert.equal(withPreview.length, 1);
  assert.ok(s.calls.some((c) => c.op === "target" && c.slot.preview === 0));
});

test("a cell with no image is still recorded, with its reason", async () => {
  const s = site({
    shoot: (slot) =>
      slot.route === "/pricing" ? { image: undefined, hash: undefined, reason: "http_error", skipped: "HTTP 500" } : {},
  });
  const outcome = await runCapture(plan(), FAR(), s.deps);

  assert.equal(outcome.recorded, 8);
  const skipped = s.calls.filter((c) => c.op === "record" && c.record.reason === "http_error");
  assert.equal(skipped.length, 4);
  assert.ok(skipped.every((c) => c.op === "record" && c.record.image === undefined && c.record.skipped === "HTTP 500"));
});

test("a protected deployment ends the run at once, and what was recorded is still closed", async () => {
  const s = site({ shoot: () => ({ image: undefined, reason: "protected", skipped: "login" }) });
  const outcome = await runCapture(plan(), FAR(), s.deps);

  assert.ok(s.shot.length <= 2, "nothing past the cells already in flight");
  assert.equal(outcome.recorded, 0);
  assert.match(outcome.error ?? "", /Deployment Protection/);
  assert.match(s.finished?.error ?? "", /Deployment Protection/);
});

test("a site that says the capture is gone ends it with nothing to close", async () => {
  const s = site({
    reply: (call) => (call.op === "record" ? { ok: false, gone: true, message: "replaced" } : undefined),
  });
  const outcome = await runCapture(plan(), FAR(), s.deps);

  assert.ok(s.shot.length <= 2);
  assert.equal(s.finished, null);
  assert.equal(s.calls.some((c) => c.op === "finish"), false);
  assert.deepEqual(outcome, { recorded: 0, shots: null, error: "The capture was replaced before it finished." });
});

test("a refused record stops the run and is passed on when the capture is closed", async () => {
  let n = 0;
  const s = site({
    reply: (call) =>
      call.op === "record" && ++n === 3 ? { ok: false, message: "The shot was refused: an empty image." } : undefined,
  });
  const outcome = await runCapture(plan(), FAR(), s.deps);

  // The two before it, and perhaps the cell that was in flight beside it.
  assert.ok(outcome.recorded === 2 || outcome.recorded === 3, `recorded ${outcome.recorded}`);
  assert.match(outcome.error ?? "", /an empty image/);
  assert.match(s.finished?.error ?? "", /an empty image/);
  assert.ok(s.shot.length < 8);
});

test("out of time, no further page is started and the rest is closed as it stands", async () => {
  const s = site();
  // Enough for nothing: a cell isn't started with under 25 seconds left.
  const outcome = await runCapture(plan(), Date.now() + 10_000, s.deps);

  assert.equal(s.shot.length, 0);
  assert.match(outcome.error ?? "", /ran out of time/);
  assert.match(s.finished?.error ?? "", /ran out of time/);
});

test("no more than two pages are in flight at once", async () => {
  let running = 0;
  let peak = 0;
  const s = site();
  const shoot = s.deps.shoot;
  s.deps.shoot = async (slot, find) => {
    peak = Math.max(peak, ++running);
    await new Promise((r) => setTimeout(r, 2));
    running--;
    return shoot(slot, find);
  };
  await runCapture(plan(), FAR(), s.deps);
  assert.equal(peak, 2);
});
