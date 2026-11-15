import { NextResponse, type NextRequest } from "next/server";

/**
 * The demo's dashboard is public to look at and closed to change.
 *
 * Polishd's dashboard isn't a read-only report: its server actions change the
 * model settings, spend the model key, and file issues. A real app keeps it
 * behind a token or its own auth. This demo wants anyone to be able to open
 * /polishd and look around, so in production every request that isn't a plain
 * read is refused here, before it reaches a page — which is where server
 * actions run. `app/polishd/page.tsx` makes the same decision again through
 * the dashboard's own `authenticate`.
 *
 * Capture still works: it posts to /api/polishd, which this proxy doesn't
 * match (and under Next 16 a proxy must not match /api at all).
 *
 * To change anything — connect a model, regenerate the reviews — run the app
 * in development against the same database (see README.md).
 */
const READ_ONLY = process.env.NODE_ENV === "production";

export function proxy(request: NextRequest) {
  if (!READ_ONLY) return NextResponse.next();
  const read = request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS";
  if (read && !request.headers.has("next-action")) return NextResponse.next();
  return new NextResponse("This demo's dashboard is read-only.", { status: 403 });
}

export const config = {
  matcher: ["/((?!api/|_next/).*)"],
};
