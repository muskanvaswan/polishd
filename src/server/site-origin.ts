/**
 * Polishd — the origin a site snapshot is taken of (server only).
 *
 * `POLISHD_SITE_ORIGIN` wins when set (proxies, tunnels); otherwise the origin
 * the dashboard was itself requested on. With the hosted screenshot service
 * that is also the only origin it will shoot — the service reads it from the
 * browser's own Origin header — so the two agree by construction.
 */
import { headers } from "next/headers";

export async function resolveSiteOrigin(): Promise<string | null> {
  const configured = process.env.POLISHD_SITE_ORIGIN;
  if (configured) return configured.replace(/\/+$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return null;
  const proto =
    h.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}
