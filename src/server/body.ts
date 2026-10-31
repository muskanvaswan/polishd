/**
 * Read a JSON request body without trusting its size.
 *
 * The ingest routes are public POSTs, and Next puts no limit on a route
 * handler's body — `req.json()` buffers whatever arrives before a single
 * event is looked at. A real batch is tiny (50 events, sent by `sendBeacon`,
 * which browsers cap at 64KB), so anything near the cap is not ours.
 *
 * `Content-Length` is checked first so an honest oversized request costs
 * nothing; the stream is still counted, because the header is optional and a
 * chunked request carries none.
 */

/** 1MB — Next's own default for server action bodies, and ~16× a beacon. */
export const MAX_BODY_BYTES = 1_000_000;

export type JsonBodyResult =
  | { ok: true; body: unknown }
  | { ok: false; reason: "bad_json" | "too_large" };

export async function readJsonBody(
  req: Request,
  maxBytes: number = MAX_BODY_BYTES,
): Promise<JsonBodyResult> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, reason: "too_large" };

  const chunks: Uint8Array[] = [];
  let total = 0;
  if (req.body) {
    const reader = req.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, body: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { ok: false, reason: "bad_json" };
  }
}
