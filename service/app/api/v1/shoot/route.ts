/**
 * POST /api/v1/shoot — photograph routes of the calling site.
 *
 * The site is whatever origin the caller's browser put in its `Origin`
 * header; the body only says which paths, devices and themes. See
 * src/capture/protocol.ts for the wire contract.
 */
import { MAX_REQUEST_BYTES, parseShootRequest } from "../../../../../src/capture/protocol.ts";
import { withBrowser } from "../../../../lib/browser.ts";
import { loadConfig } from "../../../../lib/config.ts";
import { CORS_HEADERS, errorResponse, json, readBodyCapped } from "../../../../lib/http.ts";
import { LimiterUnavailableError } from "../../../../lib/limiter.ts";
import { resolvePublic } from "../../../../lib/net.ts";
import { clientIp, parseOriginHeader } from "../../../../lib/origin.ts";
import { shootAll } from "../../../../lib/shoot.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Wall-clock budget for the shots, inside `maxDuration`. */
const SHOOT_BUDGET_MS = 50_000;

const config = loadConfig();

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: Request): Promise<Response> {
  const started = Date.now();

  const origin = parseOriginHeader(req.headers.get("origin"), { allowLoopback: config.allowLoopback });
  if (!origin.ok) return errorResponse(origin.code, origin.message);

  const text = await readBodyCapped(req, MAX_REQUEST_BYTES);
  if (text === null) return errorResponse("bad_request", "The request body is too large.");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return errorResponse("bad_request", "The request body isn't JSON.");
  }
  const parsed = parseShootRequest(body);
  if (!parsed.ok) return errorResponse("bad_request", `Bad request: ${parsed.message}.`);
  const request = parsed.value;

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
  const cost = request.routes.length * request.devices.length * request.themes.length;
  try {
    const decision = await config.limiter.consume(
      { ip: clientIp(req.headers), origin: origin.hostname },
      cost,
    );
    if (!decision.ok) {
      const who =
        decision.scope === "origin"
          ? "this site"
          : decision.scope === "ip"
            ? "your network"
            : "everyone right now";
      return errorResponse("rate_limited", `The screenshot service is rate-limiting ${who}.`, {
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
    const shots = await withBrowser(config, (lease, pool) =>
      shootAll(pool, lease, origin.origin, request, started + SHOOT_BUDGET_MS),
    );
    return json({ v: 1, origin: origin.origin, shots });
  } catch (err) {
    // The message only — never the URL or anything the page returned.
    console.error("[shots] capture failed:", err instanceof Error ? err.message.split("\n")[0] : err);
    return errorResponse("internal", "The screenshot service failed to take the shot.");
  }
}
