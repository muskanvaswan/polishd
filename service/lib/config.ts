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
 * | SHOTS_ALLOW_LOOPBACK=1            | —       | local dev only: shoot localhost sites     |
 */
import { isLoopbackAddress } from "./net.ts";
import {
  memoryLimiter,
  upstashLimiter,
  type Limiter,
  type LimitRule,
} from "./limiter.ts";

export interface ServiceConfig {
  /** Let loopback origins through (local development). Never true on Vercel. */
  allowLoopback: boolean;
  rules: LimitRule[];
  /** Null when running on Vercel with no limiter configured — the service refuses work. */
  limiter: Limiter | null;
  /** Whether the capture browser may connect to `port` at `address`. */
  portAllowed(port: number, address: string): boolean;
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

  // Web ports only. A local run may also reach a site on this machine on any
  // port (next dev on :3000) — loopback only; private ranges stay blocked.
  const portAllowed = (port: number, address: string) =>
    port === 80 || port === 443 || (allowLoopback && isLoopbackAddress(address));
  return { allowLoopback, rules, limiter, portAllowed };
}
