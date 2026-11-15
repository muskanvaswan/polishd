/**
 * Polishd — the origin a site snapshot is taken of (server only).
 *
 * `POLISHD_SITE_ORIGIN` wins when set (proxies, tunnels); otherwise the origin
 * the dashboard was itself requested on. With the hosted screenshot service
 * that is also the only origin it will shoot — the service reads it from the
 * browser's own Origin header — so the two agree by construction.
 */
import { headers } from "next/headers";

/** The origin a request arrived on, from its headers — or the configured one. Pure. */
export function siteOriginFrom(headers: { get(name: string): string | null }): string | null {
  const configured = process.env.POLISHD_SITE_ORIGIN;
  if (configured) return configured.replace(/\/+$/, "");
  const host = headers.get("x-forwarded-host")?.split(",")[0]?.trim() || headers.get("host");
  if (!host) return null;
  const proto =
    headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function resolveSiteOrigin(): Promise<string | null> {
  return siteOriginFrom(await headers());
}
