/**
 * Polishd — which dataset the dashboard reads.
 *
 * An installation that collects cross-install telemetry (Polishd's own site)
 * holds two datasets in one events table: its own visitors, and the
 * dashboard usage other installs report. `POLISHD_ANALYTICS_SOURCE` picks the
 * one every feature reads by default; the Analytics tab can also show the
 * other, from `?source=` (see server/queries.ts `EventFilter`).
 *
 * Pure, so the dashboard's client components can share the labels.
 */

/** The site's own first-party events, or the cross-install telemetry it collects. */
export type PolishdAnalyticsSource = "site" | "telemetry";

export const ANALYTICS_SOURCES: { id: PolishdAnalyticsSource; label: string; title: string }[] = [
  { id: "site", label: "Site", title: "This site's own visitors" },
  {
    id: "telemetry",
    label: "Telemetry",
    title: "Dashboard usage reported by other Polishd installs",
  },
];

/** A query-string value as a source, or null for anything that isn't one. */
export function parseAnalyticsSource(raw: unknown): PolishdAnalyticsSource | null {
  return raw === "site" || raw === "telemetry" ? raw : null;
}
