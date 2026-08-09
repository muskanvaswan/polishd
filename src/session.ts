/**
 * Polishd — anonymous session assignment (Edge-safe helper).
 *
 * Runs at the Edge before render (from the host app's `proxy.ts`). Its only job
 * is to guarantee every visitor carries an anonymous `polishd_session` cookie.
 * The id is a random UUID — no fingerprinting, no PII — so it is GDPR-safe by
 * construction. The ingest layer trusts this cookie as the sole source of
 * session identity.
 *
 * Kept framework-light: takes and returns a NextResponse so the host app can
 * compose it with any other proxy logic it runs.
 */
import { NextResponse, type NextRequest } from "next/server";

import { defaultPolishdConfig, type PolishdConfig } from "./config";

const ONE_YEAR = 60 * 60 * 24 * 365;

export function withPolishdSession(
  request: NextRequest,
  response: NextResponse = NextResponse.next(),
  config: Partial<PolishdConfig> = {},
): NextResponse {
  const cookieName = config.sessionCookie ?? defaultPolishdConfig.sessionCookie;
  if (request.cookies.get(cookieName)) return response;

  response.cookies.set(cookieName, crypto.randomUUID(), {
    httpOnly: true, // never exposed to JS — capture sends no session id itself
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ONE_YEAR,
  });
  return response;
}
