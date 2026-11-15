/**
 * POST /api/v1/captures/done — a background capture's worker saying it's
 * finished, so its sandbox is stopped now rather than left to time out.
 *
 * The body is the sandbox's name, which this service made up when it started
 * the capture and only that worker was told. Knowing it stops that one
 * sandbox and nothing else; a wrong name stops nothing.
 */
import { stopCaptureSandbox } from "../../../../../lib/background.ts";
import { CORS_HEADERS, json, readBodyCapped } from "../../../../../lib/http.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: Request): Promise<Response> {
  const text = await readBodyCapped(req, 1024);
  let name: unknown = null;
  try {
    name = (JSON.parse(text ?? "null") as { name?: unknown } | null)?.name;
  } catch {
    name = null;
  }
  return json({ v: 1, ok: true, stopped: await stopCaptureSandbox(name) });
}
