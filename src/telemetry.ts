/**
 * @polishd/next/telemetry — the cross-install ingest endpoint.
 *
 * Mount this in the app that *collects* telemetry from other polishd
 * installations (for polishd itself, the landing site). It differs from the
 * first-party `@polishd/next/route` in that it accepts POSTs from any origin:
 * remote dashboards live on other people's domains, so the endpoint answers
 * CORS preflights and takes identity from the request body instead of the
 * first-party session cookie (see `ingestTelemetry` for the full contrast).
 *
 * Consumers wire it up with a one-line re-export:
 *
 *   // src/app/api/polishd-telemetry/route.ts
 *   export { POST, OPTIONS, runtime, dynamic } from "@polishd/next/telemetry";
 *
 * Or build a configured handler:
 *
 *   const { POST, OPTIONS } = createPolishdTelemetryRoute({
 *     allowedOrigins: ["https://example.com"],
 *   });
 */
import { NextResponse, type NextRequest } from "next/server";

import { defaultPolishdConfig, type PolishdConfig } from "./config";
import { ingestTelemetry, telemetryInstallId } from "./server/ingest";

// node:sqlite / pg need the Node runtime — never the Edge runtime.
export const runtime = "nodejs";
// This route mutates per-request; it must never be statically cached.
export const dynamic = "force-dynamic";

export interface PolishdTelemetryRouteOptions {
  /**
   * Origins allowed to POST telemetry. Omit to accept any origin — the right
   * default here, since dashboards report in from domains that can't be known
   * in advance. The endpoint never uses cookies or credentialed CORS, so a
   * wildcard exposes nothing; an allowlist merely narrows who may write.
   */
  allowedOrigins?: string[];
  /** Host-app config overrides (only `enabled` matters to this route). */
  config?: Partial<PolishdConfig>;
}

/**
 * CORS response headers for this request, or null when the origin is
 * disallowed. A request with no Origin header (same-origin, server-to-server)
 * is outside CORS entirely and passes with no headers added.
 */
function corsHeaders(
  origin: string | null,
  allowedOrigins?: string[],
): Record<string, string> | null {
  if (!origin) return {};
  if (!allowedOrigins) return { "Access-Control-Allow-Origin": "*" };
  if (allowedOrigins.includes(origin)) {
    return { "Access-Control-Allow-Origin": origin, Vary: "Origin" };
  }
  return null;
}

export function createPolishdTelemetryRoute(options: PolishdTelemetryRouteOptions = {}) {
  const { allowedOrigins } = options;
  const cfg = { ...defaultPolishdConfig, ...options.config };

  /** Answers the browser's CORS preflight for the cross-origin POST. */
  async function OPTIONS(req: NextRequest) {
    const cors = corsHeaders(req.headers.get("origin"), allowedOrigins);
    if (!cors) return new NextResponse(null, { status: 403 });
    return new NextResponse(null, {
      status: 204,
      headers: {
        ...cors,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  async function POST(req: NextRequest) {
    const cors = corsHeaders(req.headers.get("origin"), allowedOrigins);
    if (!cors) {
      return NextResponse.json(
        { ok: false, stored: 0, reason: "origin_not_allowed" },
        { status: 403 },
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { ok: false, stored: 0, reason: "bad_json" },
        { status: 400, headers: cors },
      );
    }

    // The reporting installation is named by where the request came from —
    // the browser-set Origin header — not by anything the payload claims.
    const install = telemetryInstallId(req.headers.get("origin"), req.headers.get("host"));
    const result = await ingestTelemetry(body, install, cfg);
    return NextResponse.json(result, { status: result.ok ? 200 : 400, headers: cors });
  }

  return { POST, OPTIONS };
}

/** Default handlers — used by the one-line re-export. */
export const { POST, OPTIONS } = createPolishdTelemetryRoute();
