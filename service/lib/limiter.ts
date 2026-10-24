/**
 * Rate limits: per caller IP, per target origin, and one global daily cap.
 *
 * Two jobs: stop the service being used to hammer a site (per origin) or as
 * someone's free screenshot farm (per IP), and keep total use inside the
 * hosting plan's included compute (global). Costs are counted in shots — one
 * route × device × theme — since that's what a request spends.
 *
 * Fixed windows in Upstash Redis over its REST API (no SDK): one pipelined
 * INCRBY + EXPIRE per rule. Keys hold nothing but the origin's hostname (or a
 * hash of the IP) and the window number, and expire with the window — the
 * only trace of a capture the service keeps. Locally, an in-memory map does
 * the same job; on Vercel the service refuses to run without Redis unless
 * told otherwise (config.ts), because per-instance memory isn't a limit at all
 * once requests fan out across instances.
 */
import { createHash } from "node:crypto";

import type { RateLimitScope } from "../../src/capture/protocol.ts";

export interface LimitRule {
  scope: RateLimitScope;
  /** Shots allowed per window. */
  limit: number;
  windowSec: number;
}

export type LimitDecision =
  | { ok: true }
  | { ok: false; scope: RateLimitScope; retryAfter: number };

export interface Limiter {
  kind: "redis" | "memory";
  consume(who: { ip: string; origin: string }, cost: number, nowMs?: number): Promise<LimitDecision>;
}

export class LimiterUnavailableError extends Error {}

/** The IP never appears in a key — only a short hash of it. */
export function hashIp(ip: string): string {
  return createHash("sha256").update(ip).digest("hex").slice(0, 16);
}

interface KeyedRule {
  rule: LimitRule;
  key: string;
  /** Seconds until the window this key counts resets. */
  resetIn: number;
}

export function keysFor(
  rules: LimitRule[],
  who: { ip: string; origin: string },
  nowMs: number,
): KeyedRule[] {
  const nowSec = Math.floor(nowMs / 1000);
  return rules.map((rule) => {
    const window = Math.floor(nowSec / rule.windowSec);
    const id = rule.scope === "ip" ? hashIp(who.ip) : rule.scope === "origin" ? who.origin : "all";
    return {
      rule,
      key: `shots:${rule.scope}:${id}:${window}`,
      resetIn: Math.max(1, (window + 1) * rule.windowSec - nowSec),
    };
  });
}

/**
 * The first rule a set of post-increment counts breaks. The global cap is
 * checked last so a caller over their own limit is told about their own limit.
 */
function verdict(keyed: KeyedRule[], counts: number[]): LimitDecision {
  const order: RateLimitScope[] = ["ip", "origin", "global"];
  for (const scope of order) {
    const i = keyed.findIndex((k) => k.rule.scope === scope);
    if (i >= 0 && counts[i] > keyed[i].rule.limit) {
      return { ok: false, scope, retryAfter: keyed[i].resetIn };
    }
  }
  return { ok: true };
}

export function memoryLimiter(rules: LimitRule[]): Limiter {
  const counts = new Map<string, { n: number; expires: number }>();
  return {
    kind: "memory",
    async consume(who, cost, nowMs = Date.now()) {
      for (const [k, v] of counts) if (v.expires <= nowMs) counts.delete(k);
      const keyed = keysFor(rules, who, nowMs);
      const after = keyed.map(({ key, resetIn }) => {
        const entry = counts.get(key) ?? { n: 0, expires: nowMs + resetIn * 1000 };
        entry.n += cost;
        counts.set(key, entry);
        return entry.n;
      });
      return verdict(keyed, after);
    },
  };
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export function upstashLimiter(
  rules: LimitRule[],
  { url, token, fetch: doFetch = fetch }: { url: string; token: string; fetch?: FetchLike },
): Limiter {
  const endpoint = `${url.replace(/\/+$/, "")}/pipeline`;
  return {
    kind: "redis",
    async consume(who, cost, nowMs = Date.now()) {
      const keyed = keysFor(rules, who, nowMs);
      const commands = keyed.flatMap(({ key, rule }) => [
        ["INCRBY", key, String(cost)],
        // Re-arming the TTL each time is harmless: the window number is in
        // the key, so a key is never counted past its own window anyway.
        ["EXPIRE", key, String(rule.windowSec)],
      ]);
      let res: Response;
      try {
        res = await doFetch(endpoint, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify(commands),
          signal: AbortSignal.timeout(3000),
        });
      } catch {
        throw new LimiterUnavailableError("the rate limiter didn't answer");
      }
      if (!res.ok) throw new LimiterUnavailableError(`the rate limiter answered ${res.status}`);
      const body = (await res.json().catch(() => null)) as { result?: unknown; error?: string }[] | null;
      if (!Array.isArray(body) || body.length !== commands.length) {
        throw new LimiterUnavailableError("the rate limiter answered something unreadable");
      }
      const counts = keyed.map((_, i) => Number(body[i * 2]?.result));
      if (counts.some((n) => !Number.isFinite(n))) {
        throw new LimiterUnavailableError("the rate limiter answered something unreadable");
      }
      return verdict(keyed, counts);
    },
  };
}
