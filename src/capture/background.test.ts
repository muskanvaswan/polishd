import assert from "node:assert/strict";
import { test } from "node:test";

import { isBlobUploadUrl, parseBackgroundCaptureRequest, parseCaptureCall } from "./background.ts";

const TOKEN = "ab".repeat(32);
const request = {
  v: 1,
  origin: "https://example.com",
  callback: "/api/polishd",
  id: "mh2x9k1a",
  token: TOKEN,
  routes: ["/", "/pricing"],
  renderings: [
    { device: "desktop", theme: "light" },
    { device: "phone", theme: "dark" },
  ],
  targets: [{ key: "radius:7px", ref: { kind: "radius", value: "7px" }, pages: ["/pricing", "/gone"] }],
};

test("a capture request is read back whole, with a target's pages held to the plan's routes", () => {
  const parsed = parseBackgroundCaptureRequest(request);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.ok && parsed.value, {
    ...request,
    targets: [{ key: "radius:7px", ref: { kind: "radius", value: "7px" }, pages: ["/pricing"] }],
  });
});

test("a capture request is refused for anything that could send the worker elsewhere", () => {
  const bad = (patch: Record<string, unknown>) => parseBackgroundCaptureRequest({ ...request, ...patch }).ok;
  assert.equal(bad({ origin: "https://example.com/path" }), false, "an origin with a path");
  assert.equal(bad({ origin: "ftp://example.com" }), false, "not a web origin");
  assert.equal(bad({ callback: "https://evil.example/api" }), false, "a callback off the site");
  assert.equal(bad({ callback: "//evil.example/api" }), false, "a protocol-relative callback");
  assert.equal(bad({ token: "short" }), false, "a guessable token");
  assert.equal(bad({ id: "../../etc" }), false, "an id that isn't one");
  assert.equal(bad({ routes: [] }), false, "no routes");
  assert.equal(bad({ routes: Array.from({ length: 13 }, (_, i) => `/p${i}`) }), false, "too many routes");
  assert.equal(bad({ routes: ["https://evil.example/"] }), false, "a route that isn't a path");
  assert.equal(bad({ renderings: [{ device: "tablet", theme: "light" }] }), false, "an unknown rendering");
  assert.equal(bad({ v: 2 }), false, "another version");
});

test("a beacon isn't a capture call; a capture call without its id and token is refused", () => {
  assert.equal(parseCaptureCall({ events: [] }), null);
  assert.equal(parseCaptureCall(null), null);
  assert.equal(parseCaptureCall({ capture: { v: 1, op: "hello" } })?.ok, false);
  assert.equal(parseCaptureCall({ capture: { v: 1, id: "abc", token: "nope", op: "hello" } })?.ok, false);
  assert.equal(parseCaptureCall({ capture: { v: 1, id: "abc", token: TOKEN, op: "explode" } })?.ok, false);
});

test("each call is rebuilt field by field", () => {
  const head = { v: 1, id: "abc", token: TOKEN };
  const call = (c: Record<string, unknown>) => {
    const parsed = parseCaptureCall({ capture: { ...head, ...c } });
    return parsed?.ok ? parsed.value.call : null;
  };
  assert.deepEqual(call({ op: "hello", extra: 1 }), { op: "hello" });
  assert.deepEqual(
    call({ op: "target", slot: { route: "/", device: "phone", theme: "light", junk: true }, type: "image/webp", size: 10 }),
    { op: "target", slot: { route: "/", device: "phone", theme: "light" }, type: "image/webp", size: 10 },
  );
  assert.equal(call({ op: "target", slot: { route: "/", device: "watch", theme: "light" }, type: "image/webp", size: 1 }), null);
  assert.deepEqual(call({ op: "chunk", file: "r0-phone-light.webp", offset: 0, data: "AAAA", last: 1 }), {
    op: "chunk",
    file: "r0-phone-light.webp",
    offset: 0,
    data: "AAAA",
    last: false,
  });
  assert.deepEqual(
    call({
      op: "record",
      record: {
        route: "/",
        device: "desktop",
        theme: "dark",
        hash: "h".repeat(100),
        reason: "made_up",
        image: { file: "r0-desktop-dark.webp", url: "https://x.public.blob.vercel-storage.com/a.webp", evil: 1 },
        previews: [{ key: "radius:7px", image: { file: "v-r0-desktop-dark-0.webp" } }],
        looked: ["radius:7px", 7],
        access: "public",
        engine: "local",
      },
    }),
    {
      op: "record",
      record: {
        route: "/",
        device: "desktop",
        theme: "dark",
        hash: "h".repeat(64),
        image: { file: "r0-desktop-dark.webp", url: "https://x.public.blob.vercel-storage.com/a.webp" },
        previews: [{ key: "radius:7px", image: { file: "v-r0-desktop-dark-0.webp" } }],
        looked: ["radius:7px"],
        access: "public",
      },
    },
  );
  assert.deepEqual(call({ op: "finish", error: "x".repeat(400) }), { op: "finish", error: "x".repeat(300) });
});

test("a worker only uploads to Vercel's Blob API", () => {
  assert.equal(isBlobUploadUrl("https://vercel.com/api/blob/?pathname=a.webp"), true);
  assert.equal(isBlobUploadUrl("https://blob.vercel-storage.com/a.webp"), true);
  assert.equal(isBlobUploadUrl("http://vercel.com/api/blob/"), false);
  assert.equal(isBlobUploadUrl("https://vercel.com.evil.example/api/blob/"), false);
  assert.equal(isBlobUploadUrl("https://169.254.169.254/latest/meta-data"), false);
  assert.equal(isBlobUploadUrl("not a url"), false);
});
