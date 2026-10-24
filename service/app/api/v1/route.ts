/** GET /api/v1 — what this service is and how it's limited. */
import { SNAPSHOT_PROTOCOL_VERSION } from "../../../../src/capture/protocol.ts";
import { loadConfig } from "../../../lib/config.ts";
import { CORS_HEADERS, json } from "../../../lib/http.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const config = loadConfig();

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function GET(): Response {
  return json({
    v: SNAPSHOT_PROTOCOL_VERSION,
    service: "polishd-shots",
    ok: config.limiter !== null,
    limiter: config.limiter?.kind ?? "none",
    limits: Object.fromEntries(
      config.rules.map((r) => [r.scope, { shots: r.limit, windowSeconds: r.windowSec }]),
    ),
  });
}
