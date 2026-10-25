/**
 * Polishd — which shots the Overview's snapshot gallery shows.
 *
 * A snapshot holds every page at two sizes in two themes — up to 48 pictures.
 * The Design tab filters that down with toggles; the Overview shows one mosaic
 * instead, so the choice of what goes in it has to be made here. Each route
 * gets two tiles, a desktop shot and a phone shot, in opposite themes, and the
 * themes swap route by route — so a site with a dark mode shows both without
 * any page appearing twice, and a site without one simply shows light. A
 * missing rendering (dark dropped at capture, a cell skipped) falls back to
 * whatever the route does have.
 *
 * Pure, so the test file can pin the selection.
 */
import type { PolishdSnapshot, PolishdSnapshotShot } from "../server/snapshots";

export interface GalleryPlan {
  /** The shots to tile, in order. */
  tiles: PolishdSnapshotShot[];
  /** Pictured shots the gallery leaves to the Design tab. */
  more: number;
}

const other = (theme: string) => (theme === "light" ? "dark" : "light");

/** Up to `limit` tiles from the snapshot's pictured shots. */
export function planGallery(snapshot: PolishdSnapshot, limit: number): GalleryPlan {
  const pictured = snapshot.shots.filter((s) => s.file.length > 0);
  const routes = [...new Set(pictured.map((s) => s.route))];
  const find = (route: string, device: string, theme: string) =>
    pictured.find((s) => s.route === route && s.device === device && s.theme === theme);

  const tiles: PolishdSnapshotShot[] = [];
  routes.forEach((route, i) => {
    const desktopTheme = i % 2 === 0 ? "light" : "dark";
    const phoneTheme = other(desktopTheme);
    const desktop = find(route, "desktop", desktopTheme) ?? find(route, "desktop", other(desktopTheme));
    const phone = find(route, "phone", phoneTheme) ?? find(route, "phone", other(phoneTheme));
    if (desktop) tiles.push(desktop);
    if (phone) tiles.push(phone);
  });

  const shown = tiles.slice(0, Math.max(0, limit));
  return { tiles: shown, more: pictured.length - shown.length };
}
