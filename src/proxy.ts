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
import { NextResponse, type NextRequest } from "next/server";

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

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon|assets).*)"],
};

/**
 * Build a configured proxy — use when you need a non-default cookie name (e.g.
 * preserving a legacy `session` cookie across a migration):
 *
 *   const { proxy } = createPolishdProxy({ sessionCookie: "polish_session" });
 *   export { proxy };
 *   export const config = {
 *     matcher: ["/((?!api|_next/static|_next/image|favicon|assets).*)"],
 *   };
 */
export function createPolishdProxy(config: Partial<PolishdConfig> = {}) {
  return {
    proxy: (request: NextRequest) => withPolishdSession(request, undefined, config),
    matcher: polishdMatcher,
  };
}

// ── Composing with an existing proxy ─────────────────────────────────────────

/** A host's own proxy handler. May be sync or async, and may return nothing. */
export type PolishdComposableHandler = (
  request: NextRequest,
) => NextResponse | undefined | void | Promise<NextResponse | undefined | void>;

export interface ComposePolishdOptions {
  /**
   * The paths your own handler ran on *before* Polishd was added.
   *
   * This is the part of merging that goes wrong quietly. Next allows exactly
   * one proxy module per app, so adding Polishd means widening
   * `config.matcher` to the union of both — and Polishd's matcher is
   * near-total. Your handler, which you deliberately scoped to two routes,
   * silently starts running on every request in the app. Nothing errors; your
   * redirects and rewrites just begin firing where they never did before.
   *
   * Declare the original scope here and it is re-applied as an internal guard,
   * so the widened matcher feeds Polishd everything while your handler keeps
   * seeing exactly what it saw before.
   *
   * Accepts Next's matcher strings (`"/admin/:path*"`, `"/((?!api).*)"`) or a
   * `RegExp` when you want to be exact. Omit it only if your handler genuinely
   * did run on everything.
   */
  matcher?: string | RegExp | Array<string | RegExp>;
  /** Non-default cookie name, matching your route and client config. */
  config?: Partial<PolishdConfig>;
}

/**
 * Translate one Next matcher entry into a testable RegExp.
 *
 * Next's own matcher syntax is a subset of path-to-regexp: literal paths,
 * `:param` and `:param*` segments, and raw regex bodies in parentheses. Those
 * are handled here; anything more exotic can be passed as a `RegExp` directly.
 */
function toRegExp(pattern: string | RegExp): RegExp {
  if (pattern instanceof RegExp) return pattern;
  // Already regex-shaped, as in the near-total matcher Polishd itself uses.
  if (pattern.includes("(")) return new RegExp(`^${pattern}$`);
  let out = "";
  for (const seg of pattern.split("/").slice(1)) {
    if (seg.startsWith(":")) {
      // `:path*` matches zero or more segments, so the slash goes with it.
      out += seg.endsWith("*") ? "(?:/.*)?" : "/[^/]+";
    } else {
      out += `/${seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`;
    }
  }
  return new RegExp(`^${out || "/"}$`);
}

/**
 * Wrap an existing proxy handler so Polishd's session cookie is minted
 * alongside it:
 *
 *   // proxy.ts  (middleware.ts on Next 15)
 *   export const proxy = composePolishd(myProxy, { matcher: "/admin/:path*" });
 *   export const config = {
 *     // Still written by hand: Next statically parses this and it must be an
 *     // inline literal. The union of your paths and Polishd's.
 *     matcher: ["/((?!api|_next/static|_next/image|favicon|assets).*)"],
 *   };
 *
 * Your handler runs first and its response is threaded through, so a redirect
 * or rewrite you return carries the analytics cookie rather than losing it.
 * Returning nothing is fine — Polishd continues with a default response.
 *
 * Widening the matcher is safe from Polishd's side: `withPolishdSession`
 * returns early once the cookie is present (see session.ts), so the extra
 * paths cost a cookie lookup and nothing else.
 */
export function composePolishd(
  handler: PolishdComposableHandler,
  opts: ComposePolishdOptions = {},
) {
  const declared = opts.matcher === undefined ? [] : [opts.matcher].flat();
  const guards = declared.map(toRegExp);

  return async function proxy(request: NextRequest): Promise<NextResponse> {
    const inScope =
      guards.length === 0 || guards.some((re) => re.test(request.nextUrl.pathname));
    const response = inScope ? await handler(request) : undefined;
    return withPolishdSession(request, response ?? NextResponse.next(), opts.config);
  };
}
