/**
 * Polishd — the naming and bookkeeping rules behind a snapshot's images.
 *
 * Every image a capture stores has a name the server derives from its slot —
 * route index, device, theme, and for a value preview its position — so a
 * name the browser sends back can only ever be one this capture minted, and
 * an upload can never land outside the snapshot's own folder. Pure, so the
 * test file can pin the edges without a store or a disk.
 */
import type { SnapshotDevice, SnapshotTheme } from "../capture/protocol";

/** One cell of a capture: a route in one rendering, or one value picture shot there. */
export interface ShotSlot {
  route: string;
  device: SnapshotDevice;
  theme: SnapshotTheme;
  /** Set for a value preview: its position among the cell's previews. */
  preview?: number;
}

/** Value pictures kept per cell, matching the service's per-request cap. */
export const MAX_PREVIEWS_PER_SHOT = 16;

const DEVICES = new Set(["phone", "desktop"]);
const THEMES = new Set(["light", "dark"]);
const FILE = /^(v-)?r(\d{1,3})-(phone|desktop)-(light|dark)(?:-(\d{1,2}))?\.(webp|png)$/;

/** The file name for a slot, or null when the slot isn't part of the capture. */
export function snapshotFileFor(routes: string[], slot: ShotSlot, type: string): string | null {
  const r = routes.indexOf(slot.route);
  if (r < 0) return null;
  if (!DEVICES.has(slot.device) || !THEMES.has(slot.theme)) return null;
  if (type !== "image/webp" && type !== "image/png") return null;
  const ext = type === "image/png" ? "png" : "webp";
  if (slot.preview === undefined) return `r${r}-${slot.device}-${slot.theme}.${ext}`;
  if (!Number.isInteger(slot.preview) || slot.preview < 0 || slot.preview >= MAX_PREVIEWS_PER_SHOT) {
    return null;
  }
  return `v-r${r}-${slot.device}-${slot.theme}-${slot.preview}.${ext}`;
}

export interface ParsedSnapshotFile {
  routeIndex: number;
  device: SnapshotDevice;
  theme: SnapshotTheme;
  preview?: number;
  dir: "shots" | "previews";
}

/** Read a minted name back — null for anything that isn't one. */
export function parseSnapshotFile(file: string): ParsedSnapshotFile | null {
  const m = FILE.exec(file);
  if (!m) return null;
  const isPreview = m[1] === "v-";
  if (isPreview !== (m[5] !== undefined)) return null;
  const preview = isPreview ? Number(m[5]) : undefined;
  if (preview !== undefined && preview >= MAX_PREVIEWS_PER_SHOT) return null;
  return {
    routeIndex: Number(m[2]),
    device: m[3] as SnapshotDevice,
    theme: m[4] as SnapshotTheme,
    ...(preview !== undefined ? { preview } : {}),
    dir: isPreview ? "previews" : "shots",
  };
}

/**
 * The image type a stored file holds. Snapshots captured before the service
 * existed were PNGs named by allpages (`r0-home--desktop--light.png`); new ones
 * are WebP.
 */
export function imageMime(file: string): "image/webp" | "image/png" {
  return file.endsWith(".webp") ? "image/webp" : "image/png";
}

/**
 * Whether the site has a dark mode at all, from the pixel hashes of each
 * route/device's light and dark shots: when every pair rendered identically,
 * it doesn't, and the dark shots are redundant. Any pair that differs means
 * some pages do theme, and then every dark shot is worth keeping.
 */
export function darkModeVerdict(
  shots: { route: string; device: string; theme: string; hash?: string }[],
): { noDarkMode: boolean; redundant: number[] } {
  const redundant: number[] = [];
  let pairs = 0;
  for (const [i, dark] of shots.entries()) {
    if (dark.theme !== "dark" || !dark.hash) continue;
    const light = shots.find(
      (s) => s.theme === "light" && s.hash && s.route === dark.route && s.device === dark.device,
    );
    if (!light) continue;
    pairs++;
    if (light.hash !== dark.hash) return { noDarkMode: false, redundant: [] };
    redundant.push(i);
  }
  return pairs > 0 ? { noDarkMode: true, redundant } : { noDarkMode: false, redundant: [] };
}

/** Values looked for somewhere and pictured nowhere, each once. */
export function previewMisses(looked: string[], found: string[]): string[] {
  const pictured = new Set(found);
  return [...new Set(looked)].filter((key) => !pictured.has(key));
}
