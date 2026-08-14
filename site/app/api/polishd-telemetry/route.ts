/**
 * The cross-install telemetry collector.
 *
 * This is the endpoint every polishd installation's dashboard reports to
 * (with its owner's consent) — the receiving half of polishd dogfooding its
 * own dashboards. Events arrive tagged with an anonymous install id and land
 * in this site's own polishd database, so they show up on this site's own
 * dashboard at /polishd.
 */
import { createPolishdTelemetryRoute } from "@polishd/next/telemetry";

// node:sqlite / pg need the Node runtime — never the Edge runtime.
export const runtime = "nodejs";
// This route mutates per-request; it must never be statically cached.
export const dynamic = "force-dynamic";

// No allowedOrigins: dashboards report in from domains that can't be known
// in advance, and the route never uses cookies, so a wildcard exposes nothing.
export const { POST, OPTIONS } = createPolishdTelemetryRoute();
