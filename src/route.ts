/**
 * @polishd/next/route — the ingest endpoint.
 *
 * Consumers wire this up in their own route module, declaring the segment
 * config inline — Next rejects a re-exported `runtime` or `dynamic`:
 *
 *   // src/app/api/polishd/route.ts
 *   import { createPolishdRoute } from "@polishd/next/route";
 *   export const runtime = "nodejs";
 *   export const dynamic = "force-dynamic";
 *   export const POST = createPolishdRoute();
 */
import { NextResponse, type NextRequest } from "next/server";

import { defaultPolishdConfig, resolveSessionCookie, type PolishdConfig } from "./config";
import { readJsonBody } from "./server/body";
import { ingest, sessionIdFromCookie } from "./server/ingest";
import { mintSessionId, setSessionCookie } from "./session";

// node:sqlite / pg need the Node runtime — never the Edge runtime.
export const runtime = "nodejs";
// This route mutates per-request; it must never be statically cached.
export const dynamic = "force-dynamic";

export function createPolishdRoute(config: Partial<PolishdConfig> = {}) {
  // The cookie name is resolved the way the proxy resolves it, so a
  // `POLISHD_SESSION_COOKIE` set once reaches both sides rather than half of
  // them — and it is folded into `cfg` so everything downstream, ingest
  // included, sees the same name this handler reads.
  const cfg = {
    ...defaultPolishdConfig,
    ...config,
    sessionCookie: resolveSessionCookie(config.sessionCookie),
  };

  return async function POST(req: NextRequest) {
    const read = await readJsonBody(req);
    if (!read.ok) {
      return NextResponse.json(
        { ok: false, reason: read.reason },
        { status: read.reason === "too_large" ? 413 : 400 },
      );
    }

    // The session is minted here, on the first batch that arrives without a
    // usable cookie, so no proxy is needed. The batch is stored under the new
    // id straight away and the cookie goes back on this response; every later
    // batch carries it. A host proxy calling `withPolishdSession` still works
    // and simply means the cookie is already there. A batch that may not be
    // minted a session goes to ingest without one, which drops and counts it.
    // A route switched off (`enabled: false`) captures nothing, so it hands
    // out no cookie either.
    const existing = sessionIdFromCookie(req.cookies.get(cfg.sessionCookie)?.value);
    const sessionId =
      existing ??
      (cfg.enabled && mayMintSession(req, read.body)
        ? mintSessionId((read.body as { sid?: unknown } | null)?.sid)
        : undefined);
    const result = await ingest(read.body, sessionId, cfg);

    // Always succeed for valid requests so the beacon never retries on the
    // client; real failures (bad payloads) return 4xx above.
    const res = NextResponse.json(result, { status: result.ok ? 200 : 400 });
    // Only a batch ingest accepted earns a cookie; a body it rejects gets none.
    if (!existing && sessionId && result.ok) setSessionCookie(res, cfg.sessionCookie, sessionId);
    return res;
  };
}

/**
 * Whether a batch without a session cookie may be minted one.
 *
 * It has to come from a page on this site. Every current browser says so in
 * `Sec-Fetch-Site`, on beacons too; one too old to send it (Safari before
 * 16.4) still sends `Origin` on a POST. A request with neither isn't a page's
 * capture script, so a bare scripted POST is dropped, as it was when a proxy
 * minted the cookie. Both headers can be forged; this only stops the naive.
 *
 * And it has to open a page. A page load's first batch always carries its
 * `page_view`, so a cookieless batch without one is the tail of a page whose
 * earlier batches had a cookie the browser has since lost. Firefox sends the
 * unload beacon without cookies while it quits, and minting for that would
 * count a visitor holding nothing but a `session_end`. The doctor's probe
 * opens no page and is minted anyway: proving that minting works is its job.
 */
function mayMintSession(req: NextRequest, body: unknown): boolean {
  const b = body as { events?: unknown; probe?: unknown } | null;
  const opensPage =
    b?.probe === true ||
    (Array.isArray(b?.events) &&
      b.events.some((e) => (e as { type?: unknown } | null)?.type === "page_view"));
  return opensPage && fromThisSite(req);
}

function fromThisSite(req: NextRequest): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const origin = req.headers.get("origin");
  if (!origin || origin === "null") return false;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  // Behind a proxy `Host` can name the upstream, so the forwarded host counts.
  const forwarded = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  return host === forwarded || host === req.headers.get("host") || host === req.nextUrl.host;
}

/** Default handler — used by the one-line re-export. */
export const POST = createPolishdRoute();
