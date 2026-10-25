"use client";

/**
 * Polishd — the Overview's snapshot gallery (client).
 *
 * The newest snapshot as a mosaic: desktop shots two columns wide, phone shots
 * one, light and dark side by side, laid straight on the page with no card
 * around them and no toggles in front — the site as it last rendered, at a
 * glance. Which shots make the cut is `planGallery`'s call; the tiles and the
 * lightbox are the Design tab's own, so a click opens the same full-height
 * view there and here. Nothing in it can start a capture — that, the other
 * renderings and the history stay on the Design tab.
 *
 * Rows line up because every tile is told to stretch: a grid item with an
 * aspect ratio keeps it by default (`normal` alignment behaves as `start` for
 * such boxes), so the phone tiles would otherwise sit a few pixels short of
 * the desktop tile beside them.
 */
import { useState } from "react";

import type { PolishdSnapshot } from "../server/snapshots";
import { TabLink } from "./chrome";
import { planGallery } from "./gallery-plan";
import { ShotLightbox, ShotTile, type ShotZoom } from "./snapshots";
import { relTime } from "./ui";

/** Tiles shown before the rest is left to the Design tab: three rows of six columns. */
const GALLERY_TILES = 12;

export default function SnapshotGallery({ snapshot }: { snapshot: PolishdSnapshot }) {
  const [zoom, setZoom] = useState<ShotZoom | null>(null);
  const { tiles, more } = planGallery(snapshot, GALLERY_TILES);

  return (
    <div data-component="overview-snapshots">
      <div className="grid grid-flow-dense grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {tiles.map((shot) => (
          <ShotTile
            key={`${snapshot.id}|${shot.file}`}
            snapshotId={snapshot.id}
            shot={shot}
            caption="overlay"
            component="overview-snapshot-open"
            frameClassName={
              shot.device === "phone"
                ? "w-full aspect-[4/5] self-stretch"
                : "col-span-2 w-full aspect-[16/10] self-stretch"
            }
            onZoom={setZoom}
          />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#555]">
        <span>
          {/* "just now" from the server can be "1m ago" by hydration — a
              relative time is allowed to differ, and shouldn't cost a re-render. */}
          Captured <span suppressHydrationWarning>{relTime(snapshot.capturedAt)}</span> ·{" "}
          {snapshot.origin}
        </span>
        {snapshot.noDarkMode && <span>Renders identically in dark mode</span>}
        {more > 0 && (
          <TabLink tab="design" className="transition-colors hover:text-white">
            {more} more {more === 1 ? "shot" : "shots"} on the Design tab →
          </TabLink>
        )}
      </div>
      {zoom && <ShotLightbox zoom={zoom} onClose={() => setZoom(null)} />}
    </div>
  );
}
