/**
 * Polishd — which design scans describe the site as it ships now.
 *
 * The Design tab merges one scan per page. Taking each page's newest scan is
 * right while a site is on one build, and wrong the day after a deploy: a
 * page nobody has revisited since still contributes the old build's type and
 * colors, and a page the new build removed never stops contributing at all.
 * So the merge is build-aware. Once every page the current build has served
 * has also been scanned on it, only the current build's scans are merged —
 * the old build's leftovers go, removed pages with them. Until then the
 * newest scan per page is still used, whichever build took it, because a
 * thin picture of the new build is worse than a complete one with a few
 * stale pages — and the tab says which pages are still waiting, so the owner
 * can go and load them.
 *
 * Pure: server/design.ts loads the rows and asks the store which build is
 * current; this decides. A store with no builds at all (nothing stamped yet)
 * keeps the newest-per-page reading, exactly as before builds were tracked.
 */
import type { DesignScanRow } from "./design-aggregate";

/** Where the current build's scans stand, for the Design tab's status. */
export interface DesignBuildCoverage {
  /** The build currently shipping — the one that appeared most recently. */
  build: string;
  /** When its first event arrived, ms since epoch. */
  firstSeen: number;
  /** Pages with a scan from this build. */
  scanned: number;
  /**
   * Pages this build has served (a page_view on it) with no scan from it
   * yet, sorted. Visiting each and letting it settle completes the picture.
   */
  pending: string[];
  /**
   * Pages shown from an older build's scan because this build hasn't scanned
   * them. Zero once the picture is complete.
   */
  carried: number;
  /** True when only this build's scans are merged. */
  complete: boolean;
}

export interface BuildScanSelection {
  /** The scans to merge. */
  scans: DesignScanRow[];
  /** Null when no build is known — the selection is then every newest scan. */
  coverage: DesignBuildCoverage | null;
}

/**
 * Choose the scans the Design tab merges.
 *
 * @param latest   The newest scan per page, from any build.
 * @param current  The build currently shipping, or null when none is known.
 * @param viewed   Paths with a page_view on the current build.
 */
export function selectBuildScans(
  latest: DesignScanRow[],
  current: { build: string; firstSeen: number } | null,
  viewed: ReadonlySet<string>,
): BuildScanSelection {
  if (!current) return { scans: latest, coverage: null };

  const onCurrent = latest.filter((s) => s.build === current.build);
  const scannedPaths = new Set(onCurrent.map((s) => s.path));
  const pending = [...viewed].filter((p) => !scannedPaths.has(p)).sort();
  // A build that has scanned nothing yet is never "complete": with no scans
  // of its own there is nothing to show instead of the old build's.
  const complete = onCurrent.length > 0 && pending.length === 0;

  return {
    scans: complete ? onCurrent : latest,
    coverage: {
      build: current.build,
      firstSeen: current.firstSeen,
      scanned: onCurrent.length,
      pending,
      carried: complete ? 0 : latest.length - onCurrent.length,
      complete,
    },
  };
}
