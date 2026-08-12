"use server";
/**
 * Polishd — the dashboard unlock action.
 *
 * This is the one action in the package that must be reachable *without*
 * authorization: it is what grants authorization in the first place, so
 * putting it behind `requirePolishdAuth()` would be a chicken-and-egg lock.
 * Everything it can do is therefore bounded by the token check below, and it
 * carries its own rate limit instead of the shared guard.
 *
 * It exists as a server action rather than a route because server actions can
 * set cookies. That is the whole reason the token never has to travel in a URL:
 * the form posts here, the cookie comes back, and the address bar never holds
 * the secret.
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  POLISHD_DASHBOARD_COOKIE,
  mintGrant,
  polishdDashboardToken,
  polishdTokenOptions,
  requestHeaders,
  takeAttempt,
  tokensMatch,
} from "./token-auth";

/** Blunt the timing signal, and make scripted guessing tedious. */
function pause(): Promise<void> {
  return new Promise((r) => setTimeout(r, 250 + Math.random() * 250));
}

export async function unlockPolishdDashboard(formData: FormData): Promise<void> {
  const { basePath, maxAgeSeconds } = polishdTokenOptions();
  const fail = (code: string) => redirect(`${basePath}?polishd_unlock=${code}`);

  if (!takeAttempt(await requestHeaders())) {
    await pause();
    fail("rate");
    return;
  }

  await pause();

  const token = polishdDashboardToken();
  const presented = String(formData.get("token") ?? "");
  // `===` short-circuits on the first differing byte, which is a timing oracle
  // over the secret. tokensMatch hashes both sides to a fixed width and uses
  // timingSafeEqual, so neither content nor length is observable.
  if (!token || presented.length === 0 || !tokensMatch(presented, token)) {
    fail("invalid");
    return;
  }

  const jar = await cookies();
  jar.set(POLISHD_DASHBOARD_COOKIE, mintGrant(token), {
    httpOnly: true, // never readable from JS
    sameSite: "lax",
    // Not hardcoded true: that would silently fail to set over plain HTTP,
    // making local development look like a wrong password.
    secure: process.env.NODE_ENV === "production",
    // Scoped so the grant never rides along on host app requests.
    path: basePath,
    maxAge: maxAgeSeconds,
  });

  redirect(basePath);
}
