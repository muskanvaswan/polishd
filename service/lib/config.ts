/**
 * The service's settings, all from the environment. Nothing here is a secret
 * except the Redis token; the service holds no credentials for any site.
 *
 * | Variable                          | Default | Meaning                                   |
 * |-----------------------------------|---------|-------------------------------------------|
 * | KV_REST_API_URL / _TOKEN          | —       | Upstash Redis (Vercel Marketplace names)  |
 * | UPSTASH_REDIS_REST_URL / _TOKEN   | —       | the same, under Upstash's own names       |
 * | SHOTS_LIMITER=memory              | —       | run without Redis on Vercel (soft limits) |
 * | SHOTS_LIMIT_ORIGIN_PER_HOUR       | 150     | shots per target site per hour            |
 * | SHOTS_LIMIT_IP_PER_HOUR           | 300     | shots per caller IP per hour              |
 * | SHOTS_LIMIT_GLOBAL_PER_DAY        | 200     | shots per day, all callers together       |
 * | SHOTS_CAPTURES_PER_WEEK           | 2       | full captures per site per week; `off`    |
 * | SHOTS_ALLOW_LOOPBACK=1            | —       | local dev only: shoot localhost sites     |
 * | SHOTS_MAX_CONCURRENT              | 2       | captures in flight at once per instance   |
 * | SHOTS_BROWSER_MAX_SHOTS           | 24      | shots a browser takes before it's replaced |
 * | SHOTS_BROWSER_MAX_RSS_MB          | 768     | …or the resident size that replaces it    |
 * | SHOTS_BROWSER_MAX_FDS             | 700     | …or the open descriptors that do          |
 * | SHOTS_ENGINE=sandbox              | —       | shoot in a Vercel Sandbox (sandbox.ts)    |
 * | SHOTS_SANDBOX_SNAPSHOT_ID         | —       | the sandbox image (npm run sandbox:build) |
 * | SHOTS_SANDBOX_VCPUS               | 2       | vCPUs per sandbox, 2 GB of memory each    |
 * | SHOTS_SANDBOX_TIMEOUT_MIN         | 3       | minutes a new sandbox lives unextended    |
 *
 * The browser limits are the pool's (pool.ts). All captures on an instance
 * share one single-process Chromium, so `SHOTS_MAX_CONCURRENT` is also how
 * many full-page bitmaps can be in that process at once; 2 lets a dashboard's
 * own pair of requests run together while a third caller waits.
 *
 * With the sandbox engine the browser limits don't apply — every job there
 * launches its own Chromium — except `SHOTS_MAX_CONCURRENT`, which is then
 * how many jobs run in the sandbox at once.
 */
import { memoryCaptureGate, upstashCaptureGate, type CaptureGate } from "./captures.ts";
import { isLoopbackAddress } from "./net.ts";
import {
  memoryLimiter,
  upstashLimiter,
  type Limiter,
  type LimitRule,
} from "./limiter.ts";
import type { PoolLimits } from "./pool.ts";
import type { SandboxSettings } from "./sandbox.ts";

export interface ServiceConfig {
  /** Let loopback origins through (local development). Never true on Vercel. */
  allowLoopback: boolean;
  rules: LimitRule[];
  /** Null when running on Vercel with no limiter configured — the service refuses work. */
  limiter: Limiter | null;
  /** How often one site may be shot in full (captures.ts). Null: no such limit. */
  captures: CaptureGate | null;
  /** Whether the capture browser may connect to `port` at `address`. */
  portAllowed(port: number, address: string): boolean;
  /** When the capture browser is replaced, and how many captures share it. */
  browser: PoolLimits;
  /** Where Chromium runs: in this function, or in a Vercel Sandbox. */
  engine: "function" | "sandbox";
  sandbox: SandboxSettings;
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): ServiceConfig {
  const onVercel = Boolean(env.VERCEL);
  const allowLoopback = !onVercel && env.SHOTS_ALLOW_LOOPBACK === "1";
  const rules: LimitRule[] = [
    { scope: "ip", limit: positiveInt(env.SHOTS_LIMIT_IP_PER_HOUR, 300), windowSec: 3600 },
    { scope: "origin", limit: positiveInt(env.SHOTS_LIMIT_ORIGIN_PER_HOUR, 150), windowSec: 3600 },
    { scope: "global", limit: positiveInt(env.SHOTS_LIMIT_GLOBAL_PER_DAY, 200), windowSec: 86_400 },
  ];

  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  let limiter: Limiter | null;
  if (url && token) limiter = upstashLimiter(rules, { url, token });
  else if (!onVercel || env.SHOTS_LIMITER === "memory") limiter = memoryLimiter(rules);
  else limiter = null;

  const rawCaptures = env.SHOTS_CAPTURES_PER_WEEK?.trim().toLowerCase();
  const perWeek = rawCaptures === "off" || rawCaptures === "0" ? 0 : positiveInt(rawCaptures, 2);
  let captures: CaptureGate | null = null;
  if (perWeek > 0) {
    if (url && token) captures = upstashCaptureGate(perWeek, { url, token });
    else if (limiter) captures = memoryCaptureGate(perWeek);
  }

  // Web ports only. A local run may also reach a site on this machine on any
  // port (next dev on :3000) — loopback only; private ranges stay blocked.
  const portAllowed = (port: number, address: string) =>
    port === 80 || port === 443 || (allowLoopback && isLoopbackAddress(address));

  const browser: PoolLimits = {
    maxConcurrent: positiveInt(env.SHOTS_MAX_CONCURRENT, 2),
    maxShots: positiveInt(env.SHOTS_BROWSER_MAX_SHOTS, 24),
    maxRssBytes: positiveInt(env.SHOTS_BROWSER_MAX_RSS_MB, 768) * 1024 * 1024,
    maxFds: positiveInt(env.SHOTS_BROWSER_MAX_FDS, 700),
  };
  const engine = env.SHOTS_ENGINE === "sandbox" ? "sandbox" : "function";
  const sandbox: SandboxSettings = {
    snapshotId: env.SHOTS_SANDBOX_SNAPSHOT_ID?.trim() || null,
    vcpus: positiveInt(env.SHOTS_SANDBOX_VCPUS, 2),
    timeoutMs: positiveInt(env.SHOTS_SANDBOX_TIMEOUT_MIN, 3) * 60_000,
  };
  return { allowLoopback, rules, limiter, captures, portAllowed, browser, engine, sandbox };
}
