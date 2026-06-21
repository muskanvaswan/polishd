/**
 * @buffd/next/proxy — anonymous session assignment.
 *
 * Consumers wire this up with a one-line re-export:
 *
 *   // src/proxy.ts   (Next 16; `middleware.ts` on Next 15)
 *   export { proxy, config } from "@buffd/next/proxy";
 *
 * To compose with your own proxy logic, import `withBuffdSession` and
 * `buffdMatcher` instead and thread the same NextResponse through.
 */
import type { NextRequest } from "next/server";

import { withBuffdSession } from "./session";

export { withBuffdSession };

/**
 * The matcher Buffd requires. Excluding ALL of `/api` is load-bearing: under
 * Next 16 + Turbopack, letting the proxy match any `/api/*` route breaks route
 * resolution for the entire `/api` segment (every route 404s). The proxy's only
 * job is setting the session cookie, which page navigations trigger — API
 * routes don't need it. This is Next's officially recommended matcher shape.
 */
export const buffdMatcher = ["/((?!api|_next/static|_next/image|favicon|assets).*)"];

export function proxy(request: NextRequest) {
  return withBuffdSession(request);
}

export const config = { matcher: buffdMatcher };
