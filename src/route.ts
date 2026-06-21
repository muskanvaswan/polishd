/**
 * @buffd/next/route — the ingest endpoint.
 *
 * Consumers wire this up with a one-line re-export:
 *
 *   // src/app/api/buffd/route.ts
 *   export { POST, runtime, dynamic } from "@buffd/next/route";
 *
 * Or build a configured handler with `createBuffdRoute({ sessionCookie })`.
 */
import { NextResponse, type NextRequest } from "next/server";

import { defaultBuffdConfig, type BuffdConfig } from "./config";
import { ingest } from "./server/ingest";

// node:sqlite / pg need the Node runtime — never the Edge runtime.
export const runtime = "nodejs";
// This route mutates per-request; it must never be statically cached.
export const dynamic = "force-dynamic";

export function createBuffdRoute(config: Partial<BuffdConfig> = {}) {
  const cfg = { ...defaultBuffdConfig, ...config };

  return async function POST(req: NextRequest) {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, reason: "bad_json" }, { status: 400 });
    }

    const cookieValue = req.cookies.get(cfg.sessionCookie)?.value;
    const result = await ingest(body, cookieValue);

    // Always succeed for valid requests so the beacon never retries on the
    // client; real failures (bad payloads) return 4xx above.
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  };
}

/** Default handler — used by the one-line re-export. */
export const POST = createBuffdRoute();
