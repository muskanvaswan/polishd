/**
 * The one site a request may have shot: the origin its browser named.
 *
 * Browsers set `Origin` on every cross-origin fetch and pages can't forge it,
 * so a dashboard calling the service can only ever get its own site shot.
 * A non-browser caller can send any value — accepted on purpose: the service
 * only shows what the public internet already sees, and `net.ts` keeps it off
 * everything that isn't public. Rate limits (limiter.ts) bound the rest.
 */
import { isLoopbackHostname, isPublicHostname } from "./net.ts";

export type OriginCheck =
  | { ok: true; origin: string; hostname: string }
  | { ok: false; code: "origin_required" | "origin_not_public"; message: string };

/**
 * Validate an `Origin` header: http(s), default port, a hostname that could be
 * public. `allowLoopback` is for running the service against a local site in
 * development and is never honored on Vercel (see config.ts).
 */
export function parseOriginHeader(
  value: string | null | undefined,
  { allowLoopback = false }: { allowLoopback?: boolean } = {},
): OriginCheck {
  if (!value || value === "null") {
    return {
      ok: false,
      code: "origin_required",
      message:
        "This service shoots the site that calls it, named by the browser's Origin header — " +
        "call it from the page you want shot.",
    };
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, code: "origin_required", message: "The Origin header isn't a URL." };
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.origin !== value) {
    return { ok: false, code: "origin_required", message: "The Origin header isn't an http(s) origin." };
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  // In local development a site on this machine may be shot, on any port.
  if (allowLoopback && isLoopbackHostname(hostname)) {
    return { ok: true, origin: url.origin, hostname };
  }
  if (url.port !== "") {
    return {
      ok: false,
      code: "origin_not_public",
      message: `Only sites on the default port can be shot; ${url.host} names port ${url.port}.`,
    };
  }
  if (!isPublicHostname(hostname)) {
    return {
      ok: false,
      code: "origin_not_public",
      message: `${url.host} isn't a public address, so the screenshot service can't reach it.`,
    };
  }
  return { ok: true, origin: url.origin, hostname };
}

/**
 * The caller's IP as Vercel reports it. Vercel overwrites these headers at its
 * edge, so on the platform they can be trusted; anywhere else they're only a
 * best effort, which is all a local run needs.
 */
export function clientIp(headers: Headers): string {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "unknown";
}
