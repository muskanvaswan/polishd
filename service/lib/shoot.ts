/**
 * One request's worth of shots: each route × device × theme in its own
 * browser context, through the shared capture core, inside the response's
 * byte budget and the request's time budget.
 */
import {
  DEVICES,
  looksLikeAuthWall,
  looksLikeBotCheck,
  preparePage,
  userAgentFor,
} from "allpages";
import type { Browser, BrowserContext, Page } from "playwright-core";

import {
  requestAction,
  shootRendering,
  silenceBeacons,
  type CapturePage,
  type ShootDeps,
} from "../../src/capture/core.ts";
import {
  RESPONSE_BUDGET_BYTES,
  shotWireBytes,
  type ShootRequest,
  type ShotResult,
} from "../../src/capture/protocol.ts";

const deps: ShootDeps = {
  preparePage: async (page) => {
    await preparePage(page as unknown as Page, {
      hide: [],
      delayMs: 0,
      lazyLoad: true,
      dismissBanners: true,
    });
  },
  looksLikeAuthWall,
  looksLikeBotCheck,
};

/** Seconds a page gets to reach DOMContentLoaded. */
const NAVIGATION_TIMEOUT_MS = 15_000;
/** Time the value-preview pass may add to a shot. */
const PREVIEW_BUDGET_MS = 8_000;
/** Time a single shot can take end to end, used to decide whether to start one. */
const SHOT_ESTIMATE_MS = 20_000;

/**
 * Install the request guard: top-level navigation stays on the origin, and
 * the site's own Polishd beacons are answered here so a capture never lands
 * in its analytics. (Connections themselves are policed by the egress proxy.)
 */
async function guard(context: BrowserContext, origin: string): Promise<void> {
  await context.route(
    () => true,
    async (route) => {
      const req = route.request();
      let mainFrame = true;
      try {
        mainFrame = req.frame().parentFrame() === null;
      } catch {
        // No frame (a worker's request) — not a navigation either way.
      }
      let postData: string | null = null;
      try {
        postData = req.method() === "POST" ? req.postData() : null;
      } catch {
        postData = null;
      }
      const action = requestAction(origin, {
        url: req.url(),
        method: req.method(),
        navigation: req.isNavigationRequest(),
        mainFrame,
        postData,
      });
      if (action === "abort") return route.abort("blockedbyclient");
      if (action === "stay") return route.fulfill({ status: 204 });
      if (action === "beacon") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: '{"ok":true,"stored":0}',
        });
      }
      return route.continue();
    },
  );
}

export async function shootAll(
  browser: Browser,
  origin: string,
  request: ShootRequest,
  deadline: number,
): Promise<ShotResult[]> {
  const shots: ShotResult[] = [];
  let spent = 200; // the envelope
  // A value pictured in one rendering isn't looked for again in the next.
  const found = new Set<string>();
  // The encoder runs in its own offline page, never in the site being shot.
  const encoderContext = await browser.newContext({ offline: true });
  try {
    const blank = (await encoderContext.newPage()) as unknown as CapturePage;
    for (const route of request.routes) {
      for (const deviceName of request.devices) {
        for (const theme of request.themes) {
          const device = DEVICES[deviceName];
          const remaining = RESPONSE_BUDGET_BYTES - spent;
          if (Date.now() + SHOT_ESTIMATE_MS > deadline || remaining < 200_000) {
            shots.push({
              route,
              device: deviceName,
              theme,
              reason: "budget",
              skipped: "didn't fit this request — ask for it on its own",
              previews: [],
              looked: [],
            });
            continue;
          }
          const context = await browser.newContext({
            viewport: { width: device.width, height: device.height },
            deviceScaleFactor: device.scale,
            isMobile: device.mobile,
            hasTouch: device.mobile,
            colorScheme: theme,
            reducedMotion: "reduce",
            // A service worker could answer requests the guard never sees.
            serviceWorkers: "block",
            acceptDownloads: false,
            userAgent: userAgentFor(device, browser.version()),
            locale: "en-US",
            extraHTTPHeaders: { "accept-language": "en-US,en;q=0.9" },
          });
          try {
            await context.addInitScript(silenceBeacons);
            await guard(context, origin);
            const page = await context.newPage();
            const shot = await shootRendering(page as unknown as CapturePage, blank, {
              origin,
              route,
              device,
              theme,
              find: request.find.filter((t) => !found.has(t.key)),
              viewportOnly: request.viewport === true,
              navigationTimeoutMs: NAVIGATION_TIMEOUT_MS,
              previewBudgetMs: PREVIEW_BUDGET_MS,
              // Leave room for the previews and the rest of the envelope.
              maxImageBytes: Math.min(3_400_000, remaining - 150_000),
            }, deps);
            spent += shotWireBytes(shot);
            for (const p of shot.previews) found.add(p.key);
            shots.push(shot);
          } finally {
            await context.close().catch(() => {});
          }
        }
      }
    }
  } finally {
    await encoderContext.close().catch(() => {});
  }
  return shots;
}
