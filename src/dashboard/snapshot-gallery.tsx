"use client";

/**
 * Polishd — the Overview's snapshot gallery (client).
 *
 * The newest snapshot as a small bento: the homepage hero largest, the
 * homepage on a phone as the tall tile beside it, and the heroes of the two
 * most visited other pages in the row under them — laid straight on the page,
 * no card around them and no toggles in front. Which shots make the cut is
 * `planGallery`'s call; the tiles and the lightbox are the Design tab's own,
 * so a click opens the same full-height view there and here. Nothing in it
 * can start a capture — that, the other renderings and the history stay on
 * the Design tab.
 *
 *     ┌──────────────┬────┐    Four columns; rows are a fraction of the
 *     │     hero     │ ph │    gallery's own width (container query units),
 *     │              │    │    so every tile is a fixed shape whatever its
 *     ├───────┬──────┴────┤    picture, and the whole thing fits half a page.
 *     │second │  third    │    Pictures fill their tile from the top, so each
 *     └───────┴───────────┘    shows the page's hero, cropped to the tile.
 *
 * With two pages the phone column goes and the second page takes the bottom
 * row; with one, the hero stands alone.
 */
import { useState } from "react";

import type { PolishdSnapshot } from "../server/snapshots";
import { TabLink } from "./chrome";
import { planGallery, type GallerySlot } from "./gallery-plan";
import { ShotLightbox, ShotTile, type ShotZoom } from "./snapshots";
import { ArrowRightIcon, relTime } from "./ui";

/** Grid spans per slot, given which slots the plan filled. */
function span(slot: GallerySlot, slots: ReadonlySet<GallerySlot>): string {
  switch (slot) {
    case "hero":
      return slots.has("phone") ? "col-span-3 row-span-2" : "col-span-4 row-span-2";
    case "phone":
      return "col-span-1 row-span-2";
    case "second":
      return slots.has("third") ? "col-span-2" : "col-span-4";
    case "third":
      return "col-span-2";
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
    <div data-component="overview-snapshots" className="flex flex-1 flex-col">
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
          <div className="grid grid-cols-4 auto-rows-[27cqw] gap-2">
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
      {/* Pinned to the column's foot, so it lines up with the brand board beside it. */}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1 pt-3 text-[12px] text-fg-3">
        <span className="truncate">
          {/* "just now" from the server can be "1m ago" by hydration — a
              relative time is allowed to differ, and shouldn't cost a re-render. */}
          Captured <span suppressHydrationWarning>{relTime(snapshot.capturedAt)}</span>
        </span>
        {more > 0 && (
          <TabLink
            tab="design"
            className="group inline-flex shrink-0 items-center gap-1 font-medium transition-colors hover:text-fg"
          >
            {more} more on the Design tab
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
