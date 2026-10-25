"use client";

/**
 * Polishd — the Overview's snapshot gallery (client).
 *
 * The newest snapshot as a bento: the homepage hero largest, the homepage on
 * a phone as the tall tile beside it, and the heroes of the two most visited
 * other pages stacked in the last column — laid straight on the page, no card
 * around them and no toggles in front. Which shots make the cut is
 * `planGallery`'s call; the tiles and the lightbox are the Design tab's own,
 * so a click opens the same full-height view there and here. Nothing in it
 * can start a capture — that, the other renderings and the history stay on
 * the Design tab.
 *
 *     ┌─────────────┬────┬────────┐      Rows are a fraction of the gallery's
 *     │             │    │ second │      width (container query units), so
 *     │    hero     │ ph ├────────┤      every tile is a fixed shape whatever
 *     │             │    │ third  │      its picture: two columns on phones,
 *     └─────────────┴────┴────────┘      six from `lg`. Pictures fill their
 *                                        tile from the top, so each shows the
 * page's hero, cropped to the tile. With two pages the phone column goes and
 * the second page takes the whole last column; with one, the hero stands alone.
 */
import { useState } from "react";

import type { PolishdSnapshot } from "../server/snapshots";
import { TabLink } from "./chrome";
import { planGallery, type GallerySlot } from "./gallery-plan";
import { ShotLightbox, ShotTile, type ShotZoom } from "./snapshots";
import { ArrowRightIcon, relTime } from "./ui";

/** Grid spans per slot, given which slots the plan filled. */
function span(slot: GallerySlot, slots: ReadonlySet<GallerySlot>): string {
  const pair = slots.has("third");
  switch (slot) {
    case "hero":
      return `col-span-2 row-span-2 ${slots.has("phone") ? "lg:col-span-3" : "lg:col-span-4"}`;
    case "phone":
      return "col-span-1 row-span-2";
    case "second":
      return pair ? "col-span-1 row-span-1 lg:col-span-2" : "col-span-2 row-span-1 lg:col-span-2 lg:row-span-2";
    case "third":
      return "col-span-1 row-span-1 lg:col-span-2";
  }
}

export default function SnapshotGallery({
  snapshot,
  topPages,
}: {
  snapshot: PolishdSnapshot;
  /** Routes by traffic, most visited first — the order pages are picked in. */
  topPages: string[];
}) {
  const [zoom, setZoom] = useState<ShotZoom | null>(null);
  const { tiles, more } = planGallery(snapshot, topPages);
  const slots = new Set(tiles.map((t) => t.slot));

  return (
    <div data-component="overview-snapshots">
      {/* The wrapper is the query container; the grid's rows are sized from its width. */}
      <div className="@container">
        {tiles.length === 1 ? (
          <ShotTile
            snapshotId={snapshot.id}
            shot={tiles[0].shot}
            caption="overlay"
            component="overview-snapshot-open"
            frameClassName="aspect-video w-full"
            onZoom={setZoom}
          />
        ) : (
          <div className="grid grid-cols-2 auto-rows-[36cqw] gap-3 lg:grid-cols-6 lg:auto-rows-[14cqw]">
            {tiles.map(({ shot, slot }) => (
              <ShotTile
                key={`${snapshot.id}|${shot.file}`}
                snapshotId={snapshot.id}
                shot={shot}
                caption="overlay"
                component="overview-snapshot-open"
                frameClassName={`h-full w-full ${span(slot, slots)}`}
                onZoom={setZoom}
              />
            ))}
          </div>
        )}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-fg-3">
        <span>
          {/* "just now" from the server can be "1m ago" by hydration — a
              relative time is allowed to differ, and shouldn't cost a re-render. */}
          Captured <span suppressHydrationWarning>{relTime(snapshot.capturedAt)}</span> ·{" "}
          {snapshot.origin}
        </span>
        {tiles.length > 1 && <span>The homepage and the most visited pages after it</span>}
        {more > 0 && (
          <TabLink
            tab="design"
            className="group inline-flex items-center gap-1 font-medium transition-colors hover:text-fg"
          >
            {more} more {more === 1 ? "shot" : "shots"} on the Design tab
            <span className="transition-transform group-hover:translate-x-0.5">
              <ArrowRightIcon />
            </span>
          </TabLink>
        )}
      </div>
      {zoom && <ShotLightbox zoom={zoom} onClose={() => setZoom(null)} />}
    </div>
  );
}
