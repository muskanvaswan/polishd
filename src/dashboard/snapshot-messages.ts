/**
 * Polishd — what the Site snapshots section says when it can't capture.
 *
 * In production the section only captures through Polishd's screenshot
 * service, and only with somewhere to store the images and the owner's
 * agreement; otherwise it moves to the bottom of the Design tab, turned off,
 * and says why. Some reasons are known when the tab renders (no Blob store,
 * the service declined); the rest only when a capture runs, because they're
 * the browser's: the site's CSP refuses the call, the service is down or
 * rate-limiting, or it can't reach the site (an intranet, a preview behind
 * Vercel's login). Each gets a sentence naming the cause and the fix. Pure —
 * no DOM, no React — so the test file pins the wording's branches.
 */
import type {
  RateLimitScope,
  ServiceErrorBody,
  SnapshotDisabledReason,
} from "../capture/protocol";

export type ServiceFailure =
  /** The site's Content-Security-Policy blocked the request. */
  | { kind: "csp" }
  /** No answer at all — the service is down, or the network is. */
  | { kind: "unreachable" }
  /** The service answered, with an error of its own. */
  | { kind: "down"; status: number }
  | { kind: "rate_limited"; scope: RateLimitScope; retryAfter: number }
  /** The service can't reach this origin from the internet. */
  | { kind: "not_public"; message: string }
  /** The service refused the request as malformed — a version mismatch, most likely. */
  | { kind: "rejected"; message: string };

/** Read a non-2xx service response into a failure. */
export function classifyServiceError(status: number, body: unknown): ServiceFailure {
  const error = (body as Partial<ServiceErrorBody> | null)?.error;
  const code = typeof error?.code === "string" ? error.code : null;
  const message = typeof error?.message === "string" ? error.message.slice(0, 300) : "";
  switch (code) {
    case "rate_limited": {
      const scope = error?.scope === "ip" || error?.scope === "global" ? error.scope : "origin";
      const retryAfter = Number(error?.retryAfter);
      return {
        kind: "rate_limited",
        scope,
        retryAfter: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 3600,
      };
    }
    case "origin_not_public":
    case "origin_unresolvable":
    case "origin_required":
      return { kind: "not_public", message };
    case "bad_request":
      return { kind: "rejected", message };
    default:
      if (status === 429) return { kind: "rate_limited", scope: "origin", retryAfter: 3600 };
      return { kind: "down", status };
  }
}

/** "about 3 minutes", "about an hour" — a retry hint at the precision it deserves. */
export function retryIn(seconds: number): string {
  if (seconds < 90) return "a minute or so";
  const minutes = Math.round(seconds / 60);
  if (minutes < 55) return `about ${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  return hours <= 1 ? "about an hour" : `about ${hours} hours`;
}

export interface FailureContext {
  /** The site being shot, e.g. "https://example.com". */
  origin: string;
  /** The service's own origin, for the CSP fix. */
  serviceOrigin: string;
}

/** The sentence the dashboard shows for a failure. */
export function serviceFailureMessage(failure: ServiceFailure, ctx: FailureContext): string {
  const host = hostOf(ctx.origin);
  switch (failure.kind) {
    case "csp":
      return (
        `Your site's Content-Security-Policy blocked the dashboard from calling Polishd's ` +
        `screenshot service. Add ${ctx.serviceOrigin} to connect-src (and https://vercel.com, ` +
        `for storing images in Vercel Blob), then redeploy.`
      );
    case "unreachable":
      return "Polishd's screenshot service didn't respond — it may be down, or this network can't reach it. Try again in a few minutes.";
    case "down":
      return `Polishd's screenshot service answered with an error (HTTP ${failure.status}). Try again in a few minutes.`;
    case "rate_limited": {
      const who =
        failure.scope === "origin"
          ? `how often ${host} can be shot`
          : failure.scope === "ip"
            ? "how many shots your network can take"
            : "how many shots it takes for everyone today";
      return `Polishd's screenshot service is limiting ${who}. Try again in ${retryIn(failure.retryAfter)}.`;
    }
    case "not_public":
      return (
        `Polishd's screenshot service can't reach ${host} — it only shoots sites the public ` +
        `internet can see${failure.message ? ` (${failure.message.replace(/\.$/, "")})` : ""}. ` +
        "Open the dashboard on the site's public domain, or run it locally with `next dev`, " +
        "where a browser on your machine takes the shots."
      );
    case "rejected":
      return `Polishd's screenshot service rejected the request${
        failure.message ? ` (${failure.message.replace(/\.$/, "")})` : ""
      } — updating @polishd/next usually fixes this.`;
  }
}

/** Shown when a preview deployment answers with Vercel's login. */
export function protectedMessage(origin: string): string {
  return (
    `${hostOf(origin)} is behind Vercel's Deployment Protection, so the screenshot service ` +
    `got Vercel's login page instead of your site. Capture from your production domain, or ` +
    `from a deployment without protection.`
  );
}

/** Why the section is off before any capture runs. */
export function disabledMessage(reason: SnapshotDisabledReason, storageIssue: string | null): string {
  switch (reason) {
    case "no_storage":
      return storageIssue ?? "Snapshot images have nowhere to be stored on this deployment.";
    case "declined":
      return (
        "Site snapshots are off because Polishd's screenshot service wasn't allowed. In production " +
        "it's the only way pages are shot — your server runs no browser. Review it below to turn " +
        "snapshots on; local development (`next dev`) shoots with your own browser and needs nothing."
      );
    case "turned_off":
      return (
        "Site snapshots are off on this deployment: POLISHD_SNAPSHOT_SERVICE=off keeps captures on " +
        "this server's own browser, which production doesn't have. Capture in local development instead."
      );
  }
}

/** Shown when the browser's upload to Vercel Blob fails. */
export function blobUploadMessage(detail: string, csp: boolean): string {
  return csp
    ? "Your site's Content-Security-Policy blocked the dashboard from uploading to Vercel Blob. " +
        "Add https://vercel.com to connect-src, then redeploy."
    : `Couldn't store the screenshots in Vercel Blob: ${detail}`;
}

function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

/** Byte ranges for a chunked upload: `[start, end)` pairs of at most `size`. */
export function chunkRanges(total: number, size: number): [number, number][] {
  const out: [number, number][] = [];
  for (let start = 0; start < total; start += size) out.push([start, Math.min(total, start + size)]);
  return out.length > 0 ? out : [[0, 0]];
}
