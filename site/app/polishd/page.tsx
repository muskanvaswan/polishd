// The dashboard's own stylesheet. Self-contained and scoped to
// .polishd-root, so it needs no Tailwind in this app and cannot
// affect anything outside the dashboard.
import "@polishd/next/dashboard.css";
import { createPolishdPage, metadata as dashboardMetadata } from "@polishd/next/dashboard";
// The site's description, audience and repo, so the dashboard opens already
// knowing them. Imported rather than read from disk, so it ships to Vercel.
import defaults from "../../polishd.defaults.json";

// Next requires these to be declared inline in the page module.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Server actions inherit this page's time limit; 300s gives the AI
// analyses headroom on hosts with strict function limits.
export const maxDuration = 300;
// The dashboard's own title, and robots noindex: it is a locked screen to
// anyone else, and robots.txt alone can't keep a linked URL out of results.
export const metadata = dashboardMetadata;

// In production the dashboard refuses to render until you either set
// POLISHD_DASHBOARD_TOKEN, pass your own `authenticate`, or opt out
// explicitly with POLISHD_DASHBOARD_PUBLIC=true. It can change your AI
// settings and spend your model tokens, so it is not public by default.
export default createPolishdPage({ defaults });
