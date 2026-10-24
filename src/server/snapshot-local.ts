/**
 * Polishd — the local stand-in for the screenshot service (server only).
 *
 * Polishd's hosted screenshot service can only reach public sites, so a
 * dashboard on `localhost` (or anywhere else the internet can't see) shoots
 * with a browser on its own machine instead: your installed Chrome or Edge,
 * or Playwright's Chromium. Same capture core as the service
 * (capture/core.ts), same request guard, same WebP output — the dashboard
 * drives both through one loop and can't tell them apart. It also stands in
 * when the service can't be reached, wherever this server has a browser.
 *
 * On Vercel there is no browser to launch, and none is bundled: production
 * captures go through the service. That's the point of the service — no
 * 70 MB Chromium and no tracing configuration in every host app.
 *
 * The browser is launched once and kept for a minute after its last shot, so
 * a capture's forty-odd shots don't pay forty launches. It's parked on
 * `globalThis` so a dev-server module reload doesn't orphan it.
 */
import type { Browser, BrowserContext, Page } from "playwright-core";

import {
  requestAction,
  shootRendering,
  type CapturePage,
  type ShootDeps,
} from "../capture/core";
import type { FindTarget, ShotResult, SnapshotDevice, SnapshotTheme } from "../capture/protocol";

/** How long an idle local browser is kept before it's closed. */
const IDLE_CLOSE_MS = 60_000;
const NAVIGATION_TIMEOUT_MS = 20_000;
const PREVIEW_BUDGET_MS = 10_000;
/** The same per-image budget the service works to. */
const MAX_IMAGE_BYTES = 3_400_000;

interface LocalBrowserState {
  browser: Promise<Browser> | null;
  timer: ReturnType<typeof setTimeout> | null;
}

const STATE_KEY = Symbol.for("polishd.snapshot.localBrowser");
function state(): LocalBrowserState {
  const g = globalThis as unknown as Record<symbol, LocalBrowserState | undefined>;
  return (g[STATE_KEY] ??= { browser: null, timer: null });
}

/**
 * Why this server can't shoot locally, or null when it (probably) can. Only
 * Vercel is known for certain to have no browser; elsewhere the launch is the
 * test.
 */
export function localCaptureUnavailable(): string | null {
  return process.env.VERCEL
    ? "This deployment has no browser of its own — snapshots here are shot by Polishd's screenshot service."
    : null;
}

async function launch(): Promise<Browser> {
  const { chromium } = await import("playwright-core");
  const args = ["--force-color-profile=srgb", "--hide-scrollbars"];
  // Never auto-download a browser: that's a 120 MB side effect no dashboard
  // button should trigger silently.
  let lastError: unknown;
  for (const channel of ["chrome", "msedge", undefined] as const) {
    try {
      return await chromium.launch({ args, ...(channel ? { channel } : {}) });
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(
    "Couldn't start a browser for screenshots — no Chrome or Edge was found, and " +
      "Playwright's Chromium isn't installed. Run `npx playwright install chromium` " +
      `once, then capture again.${
        lastError instanceof Error ? ` (${lastError.message.split("\n")[0]})` : ""
      }`,
  );
}

async function localBrowser(): Promise<Browser> {
  const s = state();
  if (s.timer) clearTimeout(s.timer);
  s.timer = null;
  if (!s.browser) {
    const attempt = launch();
    s.browser = attempt;
    attempt.then(
      (b) => b.on("disconnected", () => {
        if (s.browser === attempt) s.browser = null;
      }),
      () => {
        if (s.browser === attempt) s.browser = null;
      },
    );
  }
  return s.browser;
}

function releaseLater(): void {
  const s = state();
  if (s.timer) clearTimeout(s.timer);
  s.timer = setTimeout(() => {
    const current = s.browser;
    s.browser = null;
    s.timer = null;
    void current?.then((b) => b.close()).catch(() => {});
  }, IDLE_CLOSE_MS);
  s.timer.unref?.();
}

async function guard(context: BrowserContext, origin: string): Promise<void> {
  await context.route(
    () => true,
    async (route) => {
      const req = route.request();
      let mainFrame = true;
      try {
        mainFrame = req.frame().parentFrame() === null;
      } catch {
        // A worker's request: no frame, and not a navigation.
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

/**
 * Shoot one rendering of one route on this machine. Resolves to the same
 * `ShotResult` the service returns, or rejects with a message when no browser
 * could be launched.
 */
export async function shootLocally(input: {
  origin: string;
  route: string;
  device: SnapshotDevice;
  theme: SnapshotTheme;
  find: FindTarget[];
}): Promise<ShotResult> {
  const unavailable = localCaptureUnavailable();
  if (unavailable) throw new Error(unavailable);

  const allpages = await import("allpages");
  const device = allpages.DEVICES[input.device];
  const deps: ShootDeps = {
    preparePage: async (page) => {
      await allpages.preparePage(page as unknown as Page, {
        hide: [],
        delayMs: 0,
        lazyLoad: true,
        dismissBanners: true,
      });
    },
    looksLikeAuthWall: allpages.looksLikeAuthWall,
    looksLikeBotCheck: allpages.looksLikeBotCheck,
  };

  const browser = await localBrowser();
  const encoderContext = await browser.newContext({ offline: true });
  const context = await browser.newContext({
    viewport: { width: device.width, height: device.height },
    deviceScaleFactor: device.scale,
    isMobile: device.mobile,
    hasTouch: device.mobile,
    colorScheme: input.theme,
    reducedMotion: "reduce",
    serviceWorkers: "block",
    acceptDownloads: false,
    userAgent: allpages.userAgentFor(device, browser.version()),
    locale: "en-US",
    extraHTTPHeaders: { "accept-language": "en-US,en;q=0.9" },
  });
  try {
    await guard(context, input.origin);
    const page = await context.newPage();
    const blank = await encoderContext.newPage();
    return await shootRendering(
      page as unknown as CapturePage,
      blank as unknown as CapturePage,
      {
        origin: input.origin,
        route: input.route,
        device,
        theme: input.theme,
        find: input.find,
        navigationTimeoutMs: NAVIGATION_TIMEOUT_MS,
        previewBudgetMs: PREVIEW_BUDGET_MS,
        maxImageBytes: MAX_IMAGE_BYTES,
      },
      deps,
    );
  } finally {
    await context.close().catch(() => {});
    await encoderContext.close().catch(() => {});
    releaseLater();
  }
}
