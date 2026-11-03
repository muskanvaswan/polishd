/**
 * Polishd — anonymous session assignment (Edge-safe helper).
 *
 * Every visitor carries one anonymous `polishd_session` cookie. The id is a
 * random UUID — no fingerprinting, no PII — so it is GDPR-safe by
 * construction, and the cookie is httpOnly, so page script never reads it.
 *
 * The ingest route mints it on the first batch that arrives without one (see
 * route.ts), which is what makes a proxy optional. `withPolishdSession` is the
 * older way in, kept for hosts that already call it from their `proxy.ts`: it
 * mints the same cookie on the first page response instead, so it is there
 * before any event is sent. Both write the cookie through
 * {@link setSessionCookie}, so the two can't disagree about its shape.
 *
 * Kept framework-light: takes and returns a NextResponse so the host app can
 * compose it with any other proxy logic it runs.
 */
import { NextResponse, type NextRequest } from "next/server";

import { resolveSessionCookie, type PolishdConfig } from "./config";

const ONE_YEAR = 60 * 60 * 24 * 365;

/**
 * The shape a client's proposed session id must have to be adopted: a UUID, as
 * `crypto.randomUUID()` writes it. Anything else is ignored and the server
 * mints its own.
 */
const SESSION_HINT_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The id to mint for a request that arrived without a session cookie.
 *
 * The client proposes one id per page load and sends it with every batch.
 * Without it, two batches leaving the same page before the first response
 * lands (a design-scan flush and a tab-hide beacon, say) would each be minted
 * a different session, and one visit would count twice. Adopting the
 * proposal puts both in the same session and sets the same cookie twice.
 *
 * Trusting it costs nothing the cookie didn't already give away: ingest takes
 * any cookie value as the session id, so a client could always choose its own.
 * The proposal is only read when there is no cookie, and never overrides one.
 */
export function mintSessionId(hint: unknown): string {
  return typeof hint === "string" && SESSION_HINT_RE.test(hint)
    ? hint.toLowerCase()
    : crypto.randomUUID();
}

/** Write the session cookie onto `response`. The one place its attributes live. */
export function setSessionCookie(response: NextResponse, name: string, id: string): void {
  response.cookies.set(name, id, {
    httpOnly: true, // never exposed to JS — page script can't read the session id
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ONE_YEAR,
  });
}

export function withPolishdSession(
  request: NextRequest,
  response: NextResponse = NextResponse.next(),
  config: Partial<PolishdConfig> = {},
): NextResponse {
  // Resolved through the shared helper so the Edge proxy and the Node ingest
  // route cannot end up disagreeing about the name.
  const cookieName = resolveSessionCookie(config.sessionCookie);
  if (request.cookies.get(cookieName)) return response;

  setSessionCookie(response, cookieName, crypto.randomUUID());
  return response;
}
