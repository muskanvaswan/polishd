import assert from "node:assert/strict";
import { test } from "node:test";

import { loadConfig } from "./config.ts";
import {
  hashIp,
  keysFor,
  LimiterUnavailableError,
  memoryLimiter,
  upstashLimiter,
  type LimitRule,
} from "./limiter.ts";

const RULES: LimitRule[] = [
  { scope: "ip", limit: 10, windowSec: 3600 },
  { scope: "origin", limit: 6, windowSec: 3600 },
  { scope: "global", limit: 20, windowSec: 86_400 },
];
const T0 = Date.UTC(2026, 9, 24, 12, 30, 0);
const who = { ip: "203.0.113.7", origin: "example.com" };

test("keys carry the hostname and a hash of the IP — never the IP or a path", () => {
  const keys = keysFor(RULES, who, T0).map((k) => k.key);
  assert.ok(keys.every((k) => !k.includes("203.0.113.7")));
  assert.ok(keys.some((k) => k.includes(hashIp("203.0.113.7"))));
  assert.ok(keys.some((k) => k.startsWith("shots:origin:example.com:")));
  assert.ok(keys.some((k) => k.startsWith("shots:global:all:")));
});

test("the retry hint counts down to the end of the window", () => {
  const [ip] = keysFor(RULES, who, T0);
  assert.equal(ip.resetIn, 30 * 60); // 12:30 → 13:00
});

test("each origin gets its own budget; the origin limit trips first", async () => {
  const limiter = memoryLimiter(RULES);
  assert.deepEqual(await limiter.consume(who, 4, T0), { ok: true });
  const over = await limiter.consume(who, 4, T0);
  assert.equal(over.ok, false);
  assert.equal(!over.ok && over.scope, "origin");
  // Another site from the same caller still has room under the IP limit.
  assert.deepEqual(await limiter.consume({ ...who, origin: "other.example" }, 1, T0), { ok: true });
});

test("one caller spraying many sites hits the per-IP limit", async () => {
  const limiter = memoryLimiter(RULES);
  for (let i = 0; i < 10; i++) {
    assert.equal((await limiter.consume({ ip: "198.51.100.1", origin: `s${i}.example` }, 1, T0)).ok, true);
  }
  const over = await limiter.consume({ ip: "198.51.100.1", origin: "s10.example" }, 1, T0);
  assert.equal(!over.ok && over.scope, "ip");
});

test("the global cap stops everyone once the day's budget is spent", async () => {
  const limiter = memoryLimiter(RULES);
  for (let i = 0; i < 20; i++) {
    await limiter.consume({ ip: `198.51.100.${i}`, origin: `s${i}.example` }, 1, T0);
  }
  const over = await limiter.consume({ ip: "192.0.2.200", origin: "fresh.example" }, 1, T0);
  assert.equal(!over.ok && over.scope, "global");
});

test("a new window starts fresh", async () => {
  const limiter = memoryLimiter(RULES);
  await limiter.consume(who, 6, T0);
  assert.equal((await limiter.consume(who, 1, T0)).ok, false);
  assert.equal((await limiter.consume(who, 1, T0 + 3600_000)).ok, true);
});

test("Upstash is driven by one pipelined INCRBY/EXPIRE per rule", async () => {
  let sent: unknown;
  const limiter = upstashLimiter(RULES, {
    url: "https://redis.example/",
    token: "t0ken",
    fetch: async (url, init) => {
      assert.equal(url, "https://redis.example/pipeline");
      assert.equal((init.headers as Record<string, string>).authorization, "Bearer t0ken");
      sent = JSON.parse(String(init.body));
      return Response.json([
        { result: 3 }, { result: 1 },
        { result: 7 }, { result: 1 }, // origin: 7 > 6
        { result: 9 }, { result: 1 },
      ]);
    },
  });
  const decision = await limiter.consume(who, 3, T0);
  assert.equal(!decision.ok && decision.scope, "origin");
  const commands = sent as string[][];
  assert.equal(commands.length, 6);
  assert.deepEqual(commands[0].slice(0, 1).concat(commands[0].slice(2)), ["INCRBY", "3"]);
  // 12:30 → the hourly key expires at 13:00, the daily one at midnight.
  assert.deepEqual(commands[1].slice(0, 1).concat(commands[1].slice(2)), ["EXPIRE", "1800"]);
  assert.deepEqual(commands[5].slice(0, 1).concat(commands[5].slice(2)), ["EXPIRE", String(11.5 * 3600)]);
});

test("an unreachable or confused Redis fails closed", async () => {
  const down = upstashLimiter(RULES, {
    url: "https://redis.example",
    token: "t",
    fetch: async () => {
      throw new Error("ECONNRESET");
    },
  });
  await assert.rejects(down.consume(who, 1, T0), LimiterUnavailableError);
  const garbled = upstashLimiter(RULES, {
    url: "https://redis.example",
    token: "t",
    fetch: async () => Response.json({ nope: true }),
  });
  await assert.rejects(garbled.consume(who, 1, T0), LimiterUnavailableError);
  const refused = upstashLimiter(RULES, {
    url: "https://redis.example",
    token: "t",
    fetch: async () => new Response("unauthorized", { status: 401 }),
  });
  await assert.rejects(refused.consume(who, 1, T0), LimiterUnavailableError);
});

test("config: Redis when configured, memory locally, refusal on Vercel without it", () => {
  assert.equal(loadConfig({ KV_REST_API_URL: "https://r", KV_REST_API_TOKEN: "t", VERCEL: "1" }).limiter?.kind, "redis");
  assert.equal(loadConfig({ UPSTASH_REDIS_REST_URL: "https://r", UPSTASH_REDIS_REST_TOKEN: "t" }).limiter?.kind, "redis");
  assert.equal(loadConfig({}).limiter?.kind, "memory");
  assert.equal(loadConfig({ VERCEL: "1" }).limiter, null);
  assert.equal(loadConfig({ VERCEL: "1", SHOTS_LIMITER: "memory" }).limiter?.kind, "memory");
});

test("config: loopback on odd ports only in local development", () => {
  const local = loadConfig({ SHOTS_ALLOW_LOOPBACK: "1" });
  assert.equal(local.allowLoopback, true);
  assert.equal(local.portAllowed(3000, "127.0.0.1"), true);
  assert.equal(local.portAllowed(3000, "93.184.215.14"), false);
  assert.equal(local.portAllowed(443, "93.184.215.14"), true);
  const vercel = loadConfig({ SHOTS_ALLOW_LOOPBACK: "1", VERCEL: "1", SHOTS_LIMITER: "memory" });
  assert.equal(vercel.allowLoopback, false);
  assert.equal(vercel.portAllowed(3000, "127.0.0.1"), false);
  assert.equal(vercel.portAllowed(22, "93.184.215.14"), false);
  assert.equal(vercel.portAllowed(443, "93.184.215.14"), true);
});

test("config: limits are tunable and bad values fall back to defaults", () => {
  const cfg = loadConfig({ SHOTS_LIMIT_ORIGIN_PER_HOUR: "40", SHOTS_LIMIT_GLOBAL_PER_DAY: "-3" });
  const limit = (scope: string) => cfg.rules.find((r) => r.scope === scope)?.limit;
  assert.equal(limit("origin"), 40);
  assert.equal(limit("global"), 200);
  assert.equal(limit("ip"), 300);
});
