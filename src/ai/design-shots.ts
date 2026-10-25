/**
 * Polishd — what the design review is shown of the site.
 *
 * The review reads aggregated design tokens, which say what values a site
 * uses but not what the pages look like. Right before it asks the model, the
 * dashboard runs a review capture (server/snapshots.ts, purpose "review"):
 * the first screen of the site's most-visited pages, desktop, in light and
 * dark, with each flagged value pictured in place — the element carrying it,
 * ringed, with its surroundings — from the light rendering only. This module
 * holds the pure rules of that: which pages, which values to look for, which
 * of the pictures to send and in what order, under caps that keep a review at
 * a few thousand tokens, and the lines of prompt that tell the model what each
 * image is. The orchestrator (design.ts) reads the bytes and makes the call.
 */
import type { SnapshotDevice, SnapshotTheme } from "../capture/protocol";
import type { PolishdDesignData } from "../server/design";
import type { ImageSize } from "../server/image-size";
import type { PageTraffic } from "../server/queries";
import type { PolishdSnapshot } from "../server/snapshots";
import {
  MAX_PREVIEW_TARGETS,
  designPreviewTargets,
  designValueKey,
  type DesignPreviewTarget,
} from "../shared/design-values";
import type { ImageLimits } from "./providers";

/** Pages whose first screen the review is shown, at most. */
export const MAX_REVIEW_PAGES = 3;
/** Flagged values pictured in place that the review is shown, at most. */
export const MAX_VALUE_CROPS = 6;

/**
 * The renderings a review capture shoots: desktop, light and dark. Light
 * first — that's where values are looked for, so a dark cell never costs a
 * crop; and a site with no dark mode drops the dark shot at the finish.
 */
export const REVIEW_RENDERINGS: { device: SnapshotDevice; theme: SnapshotTheme }[] = [
  { device: "desktop", theme: "light" },
  { device: "desktop", theme: "dark" },
];

/**
 * The pages to shoot: the most visited, ranked the way the Top pages table
 * ranks — distinct sessions, then page views — with the given order (the
 * design scan's, newest first) breaking ties and standing in when nothing has
 * been visited yet.
 */
export function pickReviewRoutes(
  routes: string[],
  traffic: ReadonlyMap<string, PageTraffic>,
  max = MAX_REVIEW_PAGES,
): string[] {
  const visits = (route: string): PageTraffic => traffic.get(route) ?? { sessions: 0, pageViews: 0 };
  // Array.prototype.sort is stable, so ties keep the given order.
  return [...new Set(routes)]
    .sort((a, b) => visits(b).sessions - visits(a).sessions || visits(b).pageViews - visits(a).pageViews)
    .slice(0, max);
}

/** The key a failing text color is looked for under: the same as a one-off of that color. */
const contrastKey = (fg: string) => `color:${fg.toLowerCase()}`;

/**
 * The values a review capture looks for: the text colors of measured
 * contrast failures first — the one finding a picture can show plainly —
 * then everything the Design tab flags (one-off type styles, colors and
 * radii, off-scale type, radii and padding), each once.
 */
export function designReviewTargets(data: PolishdDesignData): DesignPreviewTarget[] {
  const out: DesignPreviewTarget[] = [];
  const seen = new Set<string>();
  for (const pair of data.contrast) {
    if (pair.passes) continue;
    const ref = { kind: "color" as const, hex: pair.fg.toLowerCase(), roles: ["text" as const] };
    const key = designValueKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, ref, pages: pair.pages });
  }
  for (const t of designPreviewTargets(data)) {
    if (seen.has(t.key)) continue;
    seen.add(t.key);
    out.push(t);
  }
  return out.slice(0, MAX_PREVIEW_TARGETS);
}

/** A first-screen shot the review is shown. */
export interface ReviewHero {
  route: string;
  theme: string;
  file: string;
}

/** A flagged value pictured in place that the review is shown. */
export interface ReviewCrop {
  key: string;
  route: string;
  theme: string;
  file: string;
  /** The value in words, for the prompt and the card. */
  label: string;
}

export interface ReviewSelection {
  heroes: ReviewHero[];
  crops: ReviewCrop[];
}

const kindOf = (key: string): "font" | "color" | "radius" | "spacing" | null => {
  const kind = key.split(":")[0];
  return kind === "font" || kind === "color" || kind === "radius" || kind === "spacing" ? kind : null;
};

/**
 * The order flagged values are worth a look in. Contrast failures first: a
 * picture settles legibility. Then one-off type styles, colors and radii in
 * turn, each list in the Design tab's order (most used first), so the model
 * sees a spread rather than six strays of one kind. Off-scale padding last,
 * and only to fill: a pixel of padding isn't something a scaled screenshot
 * can show.
 */
export function cropPriority(data: PolishdDesignData): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  const push = (key: string) => {
    if (!seen.has(key)) {
      seen.add(key);
      order.push(key);
    }
  };
  for (const pair of data.contrast) if (!pair.passes) push(contrastKey(pair.fg));
  const flagged = designPreviewTargets(data).map((t) => t.key);
  const lists = (["font", "color", "radius"] as const).map((kind) =>
    flagged.filter((key) => kindOf(key) === kind && !seen.has(key)),
  );
  for (let i = 0; lists.some((l) => i < l.length); i++) {
    for (const list of lists) if (i < list.length) push(list[i]);
  }
  for (const key of flagged) if (kindOf(key) === "spacing") push(key);
  return order;
}

/**
 * What a flagged value is, in the words the prompt and the card use: the
 * measurement behind its key, and why it's flagged.
 */
export function describeValue(key: string, data: PolishdDesignData): string {
  const [kind, rest = ""] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
  switch (kind) {
    case "font": {
      const [family, size, weight] = rest.split("|");
      const style = `type style ${family} ${size}px/${weight}`;
      const measured = data.fonts.find(
        (f) => f.family === family && String(f.sizePx) === size && String(f.weight) === weight,
      );
      return measured?.outlier ? `${style} (one-off)` : measured?.offScale ? `${style} (off-scale)` : style;
    }
    case "color": {
      const hex = rest.toLowerCase();
      const failing = data.contrast.find((p) => !p.passes && p.fg.toLowerCase() === hex);
      if (failing) {
        return `text color ${hex}, failing WCAG AA on ${failing.bg} (${failing.ratio}:1 at ${failing.minSizePx}px)`;
      }
      const measured = data.colors.find((c) => c.hex.toLowerCase() === hex);
      const roles = measured
        ? (["text", "background", "border"] as const).filter((r) => measured.roles[r] > 0).join("/")
        : "";
      return `${roles ? `${roles} ` : ""}color ${hex}${measured?.outlier ? " (one-off)" : ""}`;
    }
    case "radius": {
      const measured = data.radii.find((r) => r.value === rest);
      return `corner radius ${rest}${measured?.outlier ? " (one-off)" : measured?.offScale ? " (off-scale)" : ""}`;
    }
    case "spacing": {
      const measured = data.spacing.find((s) => String(s.px) === rest);
      return `padding ${rest}px${measured?.offScale ? " (off-scale)" : ""}`;
    }
    default:
      return key;
  }
}

/**
 * Which of a review capture's pictures go to the model: every page's first
 * screen, light then dark, in the order the capture was planned (most
 * visited first); then the flagged values it found, by `cropPriority`, up to
 * the cap. Cells skipped at capture, and a dark shot dropped because the site
 * has no dark mode, are simply absent.
 */
export function selectReviewImages(
  capture: Pick<PolishdSnapshot, "routes" | "shots" | "previews">,
  data: PolishdDesignData,
): ReviewSelection {
  const pictured = capture.shots.filter((s) => s.file.length > 0);
  const routes = capture.routes ?? [...new Set(pictured.map((s) => s.route))];
  const heroes: ReviewHero[] = [];
  for (const route of routes) {
    for (const { theme } of REVIEW_RENDERINGS) {
      const shot = pictured.find((s) => s.route === route && s.device === "desktop" && s.theme === theme);
      if (shot) heroes.push({ route, theme, file: shot.file });
    }
  }
  const byKey = new Map((capture.previews ?? []).map((p) => [p.key, p]));
  const crops: ReviewCrop[] = [];
  for (const key of cropPriority(data)) {
    if (crops.length >= MAX_VALUE_CROPS) break;
    const p = byKey.get(key);
    if (!p || !p.file) continue;
    crops.push({ key, route: p.route, theme: p.theme, file: p.file, label: describeValue(key, data) });
  }
  return { heroes, crops };
}

const mb = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;

/**
 * Why a stored image can't go to the provider, or null when it can: a file
 * over the byte cap, an edge over what the provider accepts, or bytes that
 * aren't an image this module can size — which a provider would reject too.
 */
export function shotRefusal(size: ImageSize | null, bytes: number, limits: ImageLimits): string | null {
  if (bytes > limits.maxBytes) return `${mb(bytes)}, over the ${mb(limits.maxBytes)} the model accepts`;
  if (!size) return "not a readable WebP or PNG";
  if (size.width > limits.maxEdge || size.height > limits.maxEdge) {
    return `${size.width}×${size.height}px, over the ${limits.maxEdge}px edge the model accepts`;
  }
  return null;
}

/** The text right before a first-screen image. */
export function heroLabel(n: number, hero: Pick<ReviewHero, "route" | "theme">): string {
  return `Screenshot ${n}: first screen of ${hero.route} (desktop, ${hero.theme} theme)`;
}

/** The text right before a value picture. */
export function cropLabel(n: number, crop: Pick<ReviewCrop, "label" | "route" | "theme">): string {
  return `Screenshot ${n}: ${crop.label} — the element carrying it, ringed in amber, on ${crop.route} (desktop, ${crop.theme} theme)`;
}

/**
 * The prompt section that says what's attached and when it was captured, so
 * the model can tie each image to a path or value in the metrics. Scaling is
 * stated here and in the system prompt.
 */
export function screenshotsNote(selection: ReviewSelection, capturedAt: number): string {
  const day = new Date(capturedAt).toISOString().slice(0, 10);
  const total = selection.heroes.length + selection.crops.length;
  const pages = new Map<string, string[]>();
  for (const h of selection.heroes) pages.set(h.route, [...(pages.get(h.route) ?? []), h.theme]);
  const lines = [
    `SCREENSHOTS: ${total} attached, captured ${day}, scaled down.`,
  ];
  if (pages.size) {
    lines.push(
      "First screens (desktop) of the most-visited pages: " +
        [...pages.entries()].map(([route, themes]) => `${route} (${themes.join(", ")})`).join("; ") +
        ".",
    );
  }
  if (selection.crops.length) {
    lines.push(
      "Flagged values pictured in place, each ringed in amber: " +
        selection.crops
          .map((c, i) => `[${selection.heroes.length + i + 1}] ${c.label} on ${c.route}`)
          .join("; ") +
        ".",
    );
  }
  return lines.join("\n");
}
