/**
 * The capture gate: how often one site may be shot in full — twice a week,
 * unless `SHOTS_CAPTURES_PER_WEEK` says otherwise.
 *
 * The shot limits (limiter.ts) stop abuse; this one bounds what a site costs.
 * A dashboard's capture arrives as forty-odd requests, one rendering each, so
 * the gate counts captures rather than shots: the first full-page request
 * from a site opens a capture and spends one of its week's, and every request
 * in the twenty minutes after that belongs to it. A site with its captures
 * spent is refused as `rate_limited`, scope `origin`, until the week turns —
 * which the dashboard already words as "limiting how often <site> can be
 * shot. Try again in…".
 *
 * Refusing at the door is the point of counting captures: a shot budget
 * would run out halfway down a page list and leave half a snapshot.
 *
 * First-screen requests (`viewport`) pass without being counted. Those are
 * the design review's six small shots, taken each time a review is written;
 * they stay under the shot limits like everything else.
 *
 * Fixed weeks, counted from the epoch like the shot windows, so the count
 * key expires with its week. Keys hold the hostname and nothing else.
 */
import { LimiterUnavailableError, upstashPipeline, type UpstashOptions } from "./limiter.ts";

/** How long after its first request a capture's other requests belong to it. */
export const CAPTURE_WINDOW_SEC = 20 * 60;
const WEEK_SEC = 7 * 86_400;

export type CaptureDecision = { ok: true } | { ok: false; retryAfter: number };

export interface CaptureGate {
  kind: "redis" | "memory";
  perWeek: number;
  /** Let a full-page request for `origin` through, opening a capture if none is open. */
  admit(origin: string, nowMs?: number): Promise<CaptureDecision>;
}

export function captureKeys(
  origin: string,
  nowMs: number,
): { open: string; count: string; resetIn: number } {
  const nowSec = Math.floor(nowMs / 1000);
  const week = Math.floor(nowSec / WEEK_SEC);
  return {
    open: `capture:open:${origin}`,
    count: `capture:count:${origin}:${week}`,
    resetIn: Math.max(1, (week + 1) * WEEK_SEC - nowSec),
  };
}

export function memoryCaptureGate(perWeek: number): CaptureGate {
  const open = new Map<string, number>();
  const counts = new Map<string, { n: number; expires: number }>();
  return {
    kind: "memory",
    perWeek,
    async admit(origin, nowMs = Date.now()) {
      for (const [k, until] of open) if (until <= nowMs) open.delete(k);
      for (const [k, v] of counts) if (v.expires <= nowMs) counts.delete(k);
      const keys = captureKeys(origin, nowMs);
      if (open.has(keys.open)) return { ok: true };
      const entry = counts.get(keys.count) ?? { n: 0, expires: nowMs + keys.resetIn * 1000 };
      if (entry.n >= perWeek) return { ok: false, retryAfter: keys.resetIn };
      entry.n++;
      counts.set(keys.count, entry);
      open.set(keys.open, nowMs + CAPTURE_WINDOW_SEC * 1000);
      return { ok: true };
    },
  };
}

export function upstashCaptureGate(perWeek: number, upstash: UpstashOptions): CaptureGate {
  return {
    kind: "redis",
    perWeek,
    async admit(origin, nowMs = Date.now()) {
      const keys = captureKeys(origin, nowMs);
      // Only one of a capture's first requests sets the marker; the rest find it.
      const [opened] = await upstashPipeline(upstash, [
        ["SET", keys.open, "1", "NX", "EX", String(CAPTURE_WINDOW_SEC)],
      ]);
      if (opened !== "OK") return { ok: true };

      const [count] = await upstashPipeline(upstash, [
        ["INCR", keys.count],
        ["EXPIRE", keys.count, String(keys.resetIn)],
      ]);
      const n = Number(count);
      if (!Number.isFinite(n)) {
        throw new LimiterUnavailableError("the rate limiter answered something unreadable");
      }
      if (n <= perWeek) return { ok: true };
      // Over: take the marker back, so the capture this refused isn't open.
      await upstashPipeline(upstash, [["DEL", keys.open]]).catch(() => {});
      return { ok: false, retryAfter: keys.resetIn };
    },
  };
}
