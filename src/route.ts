/**
 * @polishd/next/route — the ingest endpoint.
 *
 * Consumers wire this up with a one-line re-export:
 *
 *   // src/app/api/polishd/route.ts
 *   export { POST, runtime, dynamic } from "@polishd/next/route";
 *
 * Or build a configured handler with `createPolishdRoute({ sessionCookie })`.
 */
import { NextResponse, type NextRequest } from "next/server";

import { resolveSessionCookie, type PolishdConfig } from "./config";
import { ingest } from "./server/ingest";

// node:sqlite / pg need the Node runtime — never the Edge runtime.
export const runtime = "nodejs";
// This route mutates per-request; it must never be statically cached.
export const dynamic = "force-dynamic";

export function createPolishdRoute(config: Partial<PolishdConfig> = {}) {
  // The cookie name is the only setting this handler reads, and it is resolved
  // the same way the proxy resolves it, so a `POLISHD_SESSION_COOKIE` set once
  // reaches both sides rather than half of them.
  const sessionCookie = resolveSessionCookie(config.sessionCookie);

  return async function POST(req: NextRequest) {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, reason: "bad_json" }, { status: 400 });
    }

    const cookieValue = req.cookies.get(sessionCookie)?.value;
    const result = await ingest(body, cookieValue);

    // Always succeed for valid requests so the beacon never retries on the
    // client; real failures (bad payloads) return 4xx above.
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  };
}

/** Default handler — used by the one-line re-export. */
export const POST = createPolishdRoute();
