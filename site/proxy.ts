import type { NextRequest } from "next/server";
import { withPolishdSession } from "@polishd/next/proxy";

export function proxy(request: NextRequest) {
  return withPolishdSession(request);
}

// Next statically parses config.matcher, so it must be an inline literal
// here. Excluding all of /api is required — under Next 16 + Turbopack a
// matcher that touches /api breaks the whole /api segment.
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon|assets).*)"],
};
