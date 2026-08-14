import { createPolishdRoute } from "@polishd/next/route";

// node:sqlite / pg need the Node runtime — never the Edge runtime.
export const runtime = "nodejs";
// This route mutates per-request; it must never be statically cached.
export const dynamic = "force-dynamic";

export const POST = createPolishdRoute();
