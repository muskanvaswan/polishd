/**
 * Response helpers: CORS for any origin (no credentials — the service never
 * reads cookies, and a credentialed request would be refused by the browser
 * against `*` anyway), JSON with no caching, and the v1 error envelope.
 */
import type {
  RateLimitScope,
  ServiceErrorBody,
  ServiceErrorCode,
} from "../../src/capture/protocol.ts";

export const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-expose-headers": "retry-after",
  "access-control-max-age": "7200",
};

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extra,
    },
  });
}

const STATUS: Record<ServiceErrorCode, number> = {
  bad_request: 400,
  origin_required: 403,
  origin_not_public: 403,
  origin_unresolvable: 422,
  rate_limited: 429,
  unavailable: 503,
  internal: 500,
};

export function errorResponse(
  code: ServiceErrorCode,
  message: string,
  extra: { retryAfter?: number; scope?: RateLimitScope } = {},
): Response {
  const body: ServiceErrorBody = { v: 1, error: { code, message, ...extra } };
  return json(
    body,
    STATUS[code],
    extra.retryAfter ? { "retry-after": String(extra.retryAfter) } : {},
  );
}

/** Read at most `max` bytes of the body as text, or null when it's longer. */
export async function readBodyCapped(req: Request, max: number): Promise<string | null> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
