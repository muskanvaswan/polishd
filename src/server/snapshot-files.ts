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

/**
 * The renderings every snapshot shoots, in order: the gallery's default view
 * first, so most value pictures match the shot the user is already looking
 * at — and so does the shot the design review is shown of a page.
 */
export const SNAPSHOT_RENDERINGS: { device: SnapshotDevice; theme: SnapshotTheme }[] = [
  { device: "desktop", theme: "light" },
  { device: "desktop", theme: "dark" },
  { device: "phone", theme: "light" },
  { device: "phone", theme: "dark" },
];

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

/** A capture's cells in the order they're shot — see `captureOrder`. */
export interface CaptureOrder {
  /** Shot first: the landing page in both themes, which settles dark mode. */
  probe: ShotSlot[];
  /** Everything else. A site the probe finds has one look skips the dark ones. */
  rest: ShotSlot[];
}

/**
 * The order a capture shoots its cells in. The landing page's phone view,
 * light and dark, goes first: it's the pair that says whether the site has a
 * dark mode at all (`darkModeVerdict`), so a site that renders the same either
 * way never has another page's dark rendering shot. The rest follow
 * rendering-major — every page's default view first, so the gallery's first
 * screen fills in first, and the cells in flight together are usually
 * different pages.
 *
 * The landing page is `/` when it's planned, the first route otherwise. A
 * plan without phone renderings (the design review's) probes the first device
 * it shoots in both themes; a plan with one theme has nothing to probe.
 */
export function captureOrder(
  routes: string[],
  renderings: { device: SnapshotDevice; theme: SnapshotTheme }[],
): CaptureOrder {
  const shoots = (device: SnapshotDevice, theme: SnapshotTheme) =>
    renderings.some((r) => r.device === device && r.theme === theme);
  const device = (["phone", ...renderings.map((r) => r.device)] as SnapshotDevice[]).find(
    (d) => shoots(d, "light") && shoots(d, "dark"),
  );
  const landing = routes.includes("/") ? "/" : routes[0];
  const probe: ShotSlot[] =
    device && landing !== undefined
      ? (["light", "dark"] as const).map((theme) => ({ route: landing, device, theme }))
      : [];
  const rest = renderings
    .flatMap((r) => routes.map((route) => ({ route, device: r.device, theme: r.theme })))
    .filter((s) => !probe.some((p) => p.route === s.route && p.device === s.device && p.theme === s.theme));
  return { probe, rest };
}

/** Values looked for somewhere and pictured nowhere, each once. */
export function previewMisses(looked: string[], found: string[]): string[] {
  const pictured = new Set(found);
  return [...new Set(looked)].filter((key) => !pictured.has(key));
}

/**
 * The dashboard tab a dashboard-telemetry page stands for: `/~polishd/design`
 * is the dashboard's Design tab. An install that reads dashboard telemetry
 * (Polishd's own site) measures these pages, and a local capture can shoot
 * them, where the development dashboard is open.
 */
export function dashboardTabOf(route: string): string | null {
  return /^\/~polishd\/([a-z0-9-]{1,40})$/.exec(route)?.[1] ?? null;
}

/** The path a local capture loads for `route`: dashboard pages map to their tab. */
export function capturePathFor(route: string, dashboardRoute: string): string {
  const tab = dashboardTabOf(route);
  return tab ? `${dashboardRoute.replace(/\/+$/, "") || "/"}?tab=${tab}` : route;
}
