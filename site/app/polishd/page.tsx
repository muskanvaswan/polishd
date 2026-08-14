// The dashboard's own stylesheet. Self-contained and scoped to
// .polishd-root, so it needs no Tailwind in this app and cannot
// affect anything outside the dashboard.
import "@polishd/next/dashboard.css";
import { createPolishdPage } from "@polishd/next/dashboard";

// Next requires these to be declared inline in the page module.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// In production the dashboard refuses to render until you either set
// POLISHD_DASHBOARD_TOKEN, pass your own `authenticate`, or opt out
// explicitly with POLISHD_DASHBOARD_PUBLIC=true. It can change your AI
// settings and spend your model tokens, so it is not public by default.
export default createPolishdPage();
