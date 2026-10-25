/**
 * Polishd — the dashboard's light/dark choice, shared by the server page that
 * renders it and the sidebar toggle that changes it.
 *
 * Dark is the default. The owner's choice lives in a cookie scoped to the
 * dashboard's own path, so the server renders the chosen theme on the first
 * paint — no flash of the other one — and nothing reaches the host app.
 * Plain constants only: imported from both server and client modules.
 */

export type PolishdTheme = "dark" | "light";

export const POLISHD_THEME_COOKIE = "polishd_theme";

/** A cookie value, or anything else, as a theme. Only "light" opts out of dark. */
export function themeFrom(value: string | undefined | null): PolishdTheme {
  return value === "light" ? "light" : "dark";
}
