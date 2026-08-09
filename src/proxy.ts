/**
 * @polishd/next/proxy — anonymous session assignment.
 *
 * Consumers wire this up with a one-line re-export:
 *
 *   // src/proxy.ts   (Next 16; `middleware.ts` on Next 15)
 *   export { proxy, config } from "@polishd/next/proxy";
 *
 * To compose with your own proxy logic, import `withPolishdSession` and
 * `polishdMatcher` instead and thread the same NextResponse through.
 */
import type { NextRequest } from "next/server";

import type { PolishdConfig } from "./config";
import { withPolishdSession } from "./session";

export { withPolishdSession };

/**
 * The matcher Polishd requires. Excluding ALL of `/api` is load-bearing: under
 * Next 16 + Turbopack, letting the proxy match any `/api/*` route breaks route
 * resolution for the entire `/api` segment (every route 404s). The proxy's only
 * job is setting the session cookie, which page navigations trigger — API
 * routes don't need it. This is Next's officially recommended matcher shape.
 */
export const polishdMatcher = ["/((?!api|_next/static|_next/image|favicon|assets).*)"];

export function proxy(request: NextRequest) {
  return withPolishdSession(request);
}

export const config = { matcher: polishdMatcher };

/**
 * Build a configured proxy — use when you need a non-default cookie name (e.g.
 * preserving a legacy `session` cookie across a migration):
 *
 *   const { proxy, matcher } = createPolishdProxy({ sessionCookie: "polish_session" });
 *   export { proxy };
 *   export const config = { matcher };
 */
export function createPolishdProxy(config: Partial<PolishdConfig> = {}) {
  return {
    proxy: (request: NextRequest) => withPolishdSession(request, undefined, config),
    matcher: polishdMatcher,
  };
}
