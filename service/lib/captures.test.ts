import assert from "node:assert/strict";
import { test } from "node:test";

import { CAPTURE_WINDOW_SEC, captureKeys, memoryCaptureGate, upstashCaptureGate } from "./captures.ts";
import { loadConfig } from "./config.ts";
import { LimiterUnavailableError } from "./limiter.ts";

const WEEK_MS = 7 * 86_400_000;
/** The start of an epoch week, so the arithmetic below reads plainly. */
const T0 = 2950 * WEEK_MS;
const MINUTE = 60_000;
const DAY = 86_400_000;

test("keys carry the hostname and the week, and the retry hint runs to the week's end", () => {
  const keys = captureKeys("example.com", T0 + 2 * DAY);
  assert.equal(keys.open, "capture:open:example.com");
  assert.equal(keys.count, "capture:count:example.com:2950");
  assert.equal(keys.resetIn, 5 * 86_400);
});

test("a capture's requests are one capture; a site gets two a week", async () => {
  const gate = memoryCaptureGate(2);
  // Forty-odd requests over a few minutes: one capture.
  for (let i = 0; i < 48; i++) {
    assert.deepEqual(await gate.admit("example.com", T0 + i * 5_000), { ok: true });
  }
  // The next day: a second.
  assert.deepEqual(await gate.admit("example.com", T0 + DAY), { ok: true });
  assert.deepEqual(await gate.admit("example.com", T0 + DAY + MINUTE), { ok: true });
  // The day after: refused until the week turns.
  assert.deepEqual(await gate.admit("example.com", T0 + 2 * DAY), { ok: false, retryAfter: 5 * 86_400 });
  assert.deepEqual(await gate.admit("example.com", T0 + 2 * DAY + 1_000), {
    ok: false,
    retryAfter: 5 * 86_400 - 1,
  });
});

test("a retry inside the capture's window isn't a second capture; one after it is", async () => {
  const gate = memoryCaptureGate(1);
  assert.equal((await gate.admit("example.com", T0)).ok, true);
  assert.equal((await gate.admit("example.com", T0 + (CAPTURE_WINDOW_SEC - 1) * 1000)).ok, true);
  assert.equal((await gate.admit("example.com", T0 + CAPTURE_WINDOW_SEC * 1000)).ok, false);
});

test("each site has its own captures, and a new week brings them back", async () => {
  const gate = memoryCaptureGate(1);
  assert.equal((await gate.admit("a.example", T0)).ok, true);
  assert.equal((await gate.admit("b.example", T0)).ok, true);
  assert.equal((await gate.admit("a.example", T0 + DAY)).ok, false);
  assert.equal((await gate.admit("a.example", T0 + WEEK_MS)).ok, true);
});

/** An Upstash stand-in that keeps keys the way Redis would, minus expiry. */
function fakeUpstash() {
  const store = new Map<string, number | string>();
  const calls: string[][][] = [];
  const fetch = async (_url: string, init: RequestInit) => {
    const commands = JSON.parse(String(init.body)) as string[][];
    calls.push(commands);
    const results = commands.map(([op, key]) => {
      if (op === "SET") {
        if (store.has(key!)) return { result: null };
        store.set(key!, "1");
        return { result: "OK" };
      }
      if (op === "INCR") {
        const n = Number(store.get(key!) ?? 0) + 1;
        store.set(key!, n);
        return { result: n };
      }
      if (op === "DEL") return { result: store.delete(key!) ? 1 : 0 };
      return { result: 1 }; // EXPIRE
    });
    return new Response(JSON.stringify(results));
  };
  return { fetch, store, calls };
}

test("redis: the first request opens the capture and counts it; the rest only look", async () => {
  const upstash = fakeUpstash();
  const gate = upstashCaptureGate(2, { url: "https://redis.example/", token: "t", fetch: upstash.fetch });

  assert.deepEqual(await gate.admit("example.com", T0), { ok: true });
  assert.deepEqual(upstash.calls, [
    [["SET", "capture:open:example.com", "1", "NX", "EX", String(CAPTURE_WINDOW_SEC)]],
    [
      ["INCR", "capture:count:example.com:2950"],
      ["EXPIRE", "capture:count:example.com:2950", String(7 * 86_400)],
    ],
  ]);

  assert.deepEqual(await gate.admit("example.com", T0 + 5_000), { ok: true });
  assert.equal(upstash.calls.length, 3, "one round trip for a request inside an open capture");
  assert.equal(upstash.store.get("capture:count:example.com:2950"), 1);
});

test("redis: a capture over the week's count is refused and its marker taken back", async () => {
  const upstash = fakeUpstash();
  const gate = upstashCaptureGate(1, { url: "https://redis.example", token: "t", fetch: upstash.fetch });

  assert.equal((await gate.admit("example.com", T0)).ok, true);
  upstash.store.delete("capture:open:example.com"); // the window ran out

  assert.deepEqual(await gate.admit("example.com", T0 + DAY), { ok: false, retryAfter: 6 * 86_400 });
  assert.equal(upstash.store.has("capture:open:example.com"), false);
  // Still refused, rather than waved through on a marker the refusal left.
  assert.equal((await gate.admit("example.com", T0 + DAY + MINUTE)).ok, false);
});

test("redis: an unreadable answer is the limiter being down, not a pass", async () => {
  const gate = upstashCaptureGate(2, {
    url: "https://redis.example",
    token: "t",
    fetch: async () => new Response("nope", { status: 500 }),
  });
  await assert.rejects(gate.admit("example.com", T0), LimiterUnavailableError);
});

test("config: two a week by default, a number changes it, off removes it", () => {
  assert.equal(loadConfig({}).captures?.perWeek, 2);
  assert.equal(loadConfig({}).captures?.kind, "memory");
  assert.equal(loadConfig({ SHOTS_CAPTURES_PER_WEEK: "5" }).captures?.perWeek, 5);
  assert.equal(loadConfig({ SHOTS_CAPTURES_PER_WEEK: "off" }).captures, null);
  assert.equal(loadConfig({ SHOTS_CAPTURES_PER_WEEK: "0" }).captures, null);
  const onVercel = loadConfig({ VERCEL: "1", KV_REST_API_URL: "https://r.example", KV_REST_API_TOKEN: "t" });
  assert.equal(onVercel.captures?.kind, "redis");
});
