/**
 * Polishd — which shots the Overview's snapshot gallery shows, and where.
 *
 * A snapshot holds every page at two sizes in two themes — up to 48 pictures.
 * The Design tab filters that down with toggles; the Overview shows a bento
 * of four instead: the homepage's hero largest, the homepage on a phone
 * beside it, and the heroes of the two most visited other pages under them.
 * Pages are ranked by the traffic the analytics saw, so the gallery leads
 * with what visitors actually see; the homepage leads whenever it's pictured
 * at all.
 *
 * The desktop tiles take the light rendering, the phone tile the dark one
 * where the site has it — one deliberate contrast tile, which also says "this
 * site has a dark mode" without a toggle. When there aren't enough pages to
 * fill the four tiles, the pages that are there lend their other renderings:
 * a dark desktop shot, then a phone shot, before a tile is left out. A site
 * with one page still gets a full bento of that page.
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

type Shot = PolishdSnapshotShot | undefined;

const other = (theme: string) => (theme === "light" ? "dark" : "light");

/**
 * The bento for `snapshot`, with pages ranked by `topRoutes` (most visited
 * first). Routes the analytics never saw follow in the snapshot's own order.
 */
export function planGallery(snapshot: PolishdSnapshot, topRoutes: string[]): GalleryPlan {
  const pictured = snapshot.shots.filter((s) => s.file.length > 0);
  const routes = [...new Set(pictured.map((s) => s.route))];
  const find = (route: string, device: string, theme: string): Shot =>
    pictured.find((s) => s.route === route && s.device === device && s.theme === theme);
  const pick = (route: string, device: string, prefer: string): Shot =>
    find(route, device, prefer) ?? find(route, device, other(prefer));

  const ranked = [
    ...topRoutes.filter((r) => routes.includes(r)),
    ...routes.filter((r) => !topRoutes.includes(r)),
  ];
  // The homepage leads when it's pictured; otherwise the most visited page is.
  const home = routes.includes("/") ? "/" : ranked.find((r) => pick(r, "desktop", "light")) ?? ranked[0];
  if (!home) return { tiles: [], more: 0 };
  const others = ranked.filter((r) => r !== home);

  // Each shot tiles once; a slot takes the first candidate still free.
  const used = new Set<PolishdSnapshotShot>();
  const first = (candidates: Shot[]): Shot => {
    for (const c of candidates) {
      if (c && !used.has(c)) {
        used.add(c);
        return c;
      }
    }
    return undefined;
  };

  // Desktop shots for the landscape tiles, in the order they're borrowed: the
  // other pages' light renderings by traffic, then their dark ones, then the
  // homepage's dark one.
  const landscape: Shot[] = [
    ...others.map((r) => find(r, "desktop", "light")),
    ...others.map((r) => find(r, "desktop", "dark")),
    find(home, "desktop", "dark"),
  ];
  // Phone shots for the tall tile: the homepage first, dark where the site
  // has it, then the other pages, then whatever of the homepage is left.
  const portrait: Shot[] = [
    pick(home, "phone", "dark"),
    ...others.flatMap((r) => [pick(r, "phone", "dark"), find(r, "phone", "light")]),
    find(home, "phone", "light"),
  ];

  const tiles: GalleryTile[] = [];
  // A homepage shot only on a phone still leads — in the hero's frame.
  const hero = first([pick(home, "desktop", "light"), pick(home, "phone", "light"), ...landscape]);
  if (hero) tiles.push({ shot: hero, slot: "hero" });
  // The tall tile is for a phone shot; a desktop page in it would be a sliver.
  const phone = first(portrait);
  if (phone) tiles.push({ shot: phone, slot: "phone" });
  const second = first([...landscape, ...portrait]);
  if (second) tiles.push({ shot: second, slot: "second" });
  const third = first([...landscape, ...portrait]);
  if (third) tiles.push({ shot: third, slot: "third" });

  return { tiles, more: pictured.length - tiles.length };
}
