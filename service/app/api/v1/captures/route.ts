/**
 * POST /api/v1/captures — take a whole capture of a site in the background.
 *
 * Posted by a site's own server (`@polishd/next`, once a week), not a
 * browser: the body names the site, the pages, and where on that site to
 * report. The answer is immediate — 202 once a sandbox has the job — and the
 * capture goes on without this function: the worker shoots every page,
 * uploads each image to the site's storage and records each shot with the
 * site. See src/capture/background.ts for the contract.
 *
 * Only with the sandbox engine: a function can't outlive its own request.
 */
import { parseBackgroundCaptureRequest } from "../../../../../src/capture/background.ts";
import { confirmWithSite, startCaptureSandbox } from "../../../../lib/background.ts";
import { loadConfig } from "../../../../lib/config.ts";
import { CORS_HEADERS, errorResponse, json, readBodyCapped } from "../../../../lib/http.ts";
import { LimiterUnavailableError } from "../../../../lib/limiter.ts";
import { resolvePublic } from "../../../../lib/net.ts";
import { clientIp, parseOriginHeader } from "../../../../lib/origin.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** A plan of twelve routes and sixty-four values is a few kilobytes; this is generous. */
const MAX_CAPTURE_REQUEST_BYTES = 256 * 1024;

const config = loadConfig();

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: Request): Promise<Response> {
  const text = await readBodyCapped(req, MAX_CAPTURE_REQUEST_BYTES);
  if (text === null) return errorResponse("bad_request", "The request body is too large.");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return errorResponse("bad_request", "The request body isn't JSON.");
  }
  const parsed = parseBackgroundCaptureRequest(body);
  if (!parsed.ok) return errorResponse("bad_request", `Bad request: ${parsed.message}.`);
  const request = parsed.value;

  // The site is named in the body here, and held to the same rules as one
  // named by a browser's Origin header: a web origin, on a public address.
  const origin = parseOriginHeader(request.origin, { allowLoopback: config.allowLoopback });
  if (!origin.ok) return errorResponse(origin.code, origin.message);
  const resolved = await resolvePublic(origin.hostname, { allowLoopback: config.allowLoopback });
  if (!resolved.ok) {
    return resolved.reason === "unresolvable"
      ? errorResponse("origin_unresolvable", `${origin.hostname} doesn't resolve in public DNS.`)
      : errorResponse(
          "origin_not_public",
          `${origin.hostname} resolves to a private address, so the screenshot service can't reach it.`,
        );
  }

  if (!config.limiter) {
    return errorResponse(
      "unavailable",
      "The screenshot service has no rate limiter configured, so it isn't taking work.",
    );
  }
  if (config.engine !== "sandbox" || !config.sandbox.snapshotId) {
    return errorResponse("unavailable", "The screenshot service isn't set up for background captures.");
  }

  // Before anything is spent: is this a capture the site itself started?
  const confirmed = await confirmWithSite(request);
  if (!confirmed.ok) return errorResponse("bad_request", confirmed.message);

  const cost = request.routes.length * request.renderings.length;
  try {
    if (config.captures) {
      const admitted = await config.captures.admit(origin.hostname);
      if (!admitted.ok) {
        return errorResponse("rate_limited", "The screenshot service has taken this site's full captures for the week.", {
          retryAfter: admitted.retryAfter,
          scope: "origin",
        });
      }
    }
    const decision = await config.limiter.consume({ ip: clientIp(req.headers), origin: origin.hostname }, cost);
    if (!decision.ok) {
      return errorResponse("rate_limited", "The screenshot service is rate-limiting this capture.", {
        retryAfter: decision.retryAfter,
        scope: decision.scope,
      });
    }
  } catch (err) {
    if (err instanceof LimiterUnavailableError) {
      return errorResponse("unavailable", "The screenshot service's rate limiter is unavailable.");
    }
    throw err;
  }

  try {
    const doneUrl = new URL("/api/v1/captures/done", req.url).toString();
    await startCaptureSandbox(config.sandbox, request, doneUrl);
    return json({ v: 1, ok: true, id: request.id, shots: cost }, 202);
  } catch (err) {
    console.error("[shots] background capture failed to start:", err instanceof Error ? err.message.split("\n")[0] : err);
    return errorResponse("internal", "The screenshot service couldn't start the capture.");
  }
}
