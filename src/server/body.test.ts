import assert from "node:assert/strict";
import { test } from "node:test";

import { readJsonBody } from "./body.ts";

const post = (body: BodyInit, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/polishd", { method: "POST", body, headers, duplex: "half" } as RequestInit);

test("a body within the cap parses", async () => {
  assert.deepEqual(await readJsonBody(post('{"events":[]}'), 100), { ok: true, body: { events: [] } });
});

test("malformed JSON is bad_json, not a throw", async () => {
  assert.deepEqual(await readJsonBody(post("not json"), 100), { ok: false, reason: "bad_json" });
  assert.deepEqual(await readJsonBody(post(""), 100), { ok: false, reason: "bad_json" });
});

test("an oversized body is refused on its declared length", async () => {
  const res = await readJsonBody(post("{}", { "content-length": "5000" }), 100);
  assert.deepEqual(res, { ok: false, reason: "too_large" });
});

test("an oversized body with no length header is refused while streaming", async () => {
  const big = JSON.stringify({ events: "x".repeat(500) });
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const bytes = new TextEncoder().encode(big);
      for (let i = 0; i < bytes.length; i += 64) controller.enqueue(bytes.slice(i, i + 64));
      controller.close();
    },
  });
  assert.deepEqual(await readJsonBody(post(stream), 100), { ok: false, reason: "too_large" });
});

test("a multi-byte body is decoded across chunk boundaries", async () => {
  const text = JSON.stringify({ label: "Café — 東京" });
  const bytes = new TextEncoder().encode(text);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3));
      controller.close();
    },
  });
  assert.deepEqual(await readJsonBody(post(stream), 1000), { ok: true, body: { label: "Café — 東京" } });
});
