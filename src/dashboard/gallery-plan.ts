/**
 * Polishd — which shots the Overview's snapshot gallery shows, and where.
 *
 * A snapshot holds every page at two sizes in two themes — up to 48 pictures.
 * The Design tab filters that down with toggles; the Overview shows a bento
 * of four instead: the homepage's hero largest, the heroes of the two most
 * visited other pages beside it, and the homepage on a phone. Pages are
 * ranked by the traffic the analytics saw, so the gallery leads with what
 * visitors actually see; the homepage leads whenever it's pictured at all.
 *
 * The desktop tiles take the light rendering, the phone tile the dark one
 * where the site has it — one deliberate contrast tile, which also says "this
 * site has a dark mode" without a toggle. A missing rendering (dark dropped
 * at capture, a cell skipped) falls back to whatever the page does have.
 *
 * Pure, so the test file can pin the selection.
 */
import type { PolishdSnapshot, PolishdSnapshotShot } from "../server/snapshots";

/** Where a tile sits in the bento — see snapshot-gallery.tsx for the grid. */
export type GallerySlot = "hero" | "phone" | "second" | "third";

export interface GalleryTile {
  shot: PolishdSnapshotShot;
  slot: GallerySlot;
}

export interface GalleryPlan {
  tiles: GalleryTile[];
  /** Pictured shots the gallery leaves to the Design tab. */
  more: number;
}

const other = (theme: string) => (theme === "light" ? "dark" : "light");

/**
 * The bento for `snapshot`, with pages ranked by `topRoutes` (most visited
 * first). Routes the analytics never saw follow in the snapshot's own order.
 */
export function planGallery(snapshot: PolishdSnapshot, topRoutes: string[]): GalleryPlan {
  const pictured = snapshot.shots.filter((s) => s.file.length > 0);
  const routes = [...new Set(pictured.map((s) => s.route))];
  const find = (route: string, device: string, theme: string) =>
    pictured.find((s) => s.route === route && s.device === device && s.theme === theme);
  const pick = (route: string, device: string, prefer: string) =>
    find(route, device, prefer) ?? find(route, device, other(prefer));

  const ranked = [
    ...topRoutes.filter((r) => routes.includes(r)),
    ...routes.filter((r) => !topRoutes.includes(r)),
  ];
  // The homepage leads when it's pictured; otherwise the most visited page is.
  const home = routes.includes("/") ? "/" : ranked.find((r) => pick(r, "desktop", "light")) ?? ranked[0];
  if (!home) return { tiles: [], more: 0 };

  const tiles: GalleryTile[] = [];
  // A homepage shot only on a phone still leads — in the hero's frame.
  const hero = pick(home, "desktop", "light") ?? pick(home, "phone", "light");
  if (hero) tiles.push({ shot: hero, slot: "hero" });

  const others = ranked.filter((r) => r !== home && pick(r, "desktop", "light")).slice(0, 2);
  // The phone tile is the tall column between the hero and the stacked pair;
  // without the pair there is no column for it, so it's left to the Design tab.
  const phone = hero?.device === "desktop" && others.length === 2 ? pick(home, "phone", "dark") : undefined;
  if (phone) tiles.push({ shot: phone, slot: "phone" });

  others.forEach((route, i) => {
    const shot = pick(route, "desktop", "light");
    if (shot) tiles.push({ shot, slot: i === 0 ? "second" : "third" });
  });

  return { tiles, more: pictured.length - tiles.length };
}
