/**
 * One request's worth of shots: each route × device × theme in its own
 * browser context, through the shared capture core, inside the response's
 * byte budget and the request's time budget.
 *
 * The browser comes from the pool on a lease. A shot that fails because of
 * the browser rather than the page — `browserFaultOf` in the core — retires
 * that browser, takes a fresh one on the same lease, and is tried once more;
 * everything already shot is kept. Before this, a wedged Chromium failed
 * every shot on its instance for as long as the instance lived.
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
  browserFaultOf,
  requestAction,
  shootRendering,
  silenceBeacons,
  type BrowserFault,
  type CapturePage,
  type ShootDeps,
} from "../../src/capture/core.ts";
import {
  RESPONSE_BUDGET_BYTES,
  shotWireBytes,
  type FindTarget,
  type ShootRequest,
  type ShotResult,
  type SnapshotDevice,
  type SnapshotTheme,
} from "../../src/capture/protocol.ts";
import type { BrowserPool, Lease } from "./pool.ts";

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

/** What the cell says when even a fresh browser couldn't shoot it. */
const REPLACED_TEXT = "the screenshot service's browser had to be replaced — try this page again";

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

interface Cell {
  route: string;
  device: SnapshotDevice;
  theme: SnapshotTheme;
}

/** The encoder's page: an offline context of its own on the current browser. */
interface Encoder {
  context: BrowserContext;
  blank: CapturePage;
}

async function openEncoder(browser: Browser): Promise<Encoder> {
  const context = await browser.newContext({ offline: true });
  try {
    return { context, blank: (await context.newPage()) as unknown as CapturePage };
  } catch (err) {
    await context.close().catch(() => {});
    throw err;
  }
}

function failedCell(cell: Cell, message: string): ShotResult {
  const first = message.split("\n")[0] ?? message;
  return {
    ...cell,
    reason: "failed",
    skipped: first.length > 80 ? `${first.slice(0, 77)}…` : first,
    previews: [],
    looked: [],
  };
}

/** An error from outside the core: the browser's fault, or not ours to swallow. */
function faultOrThrow(err: unknown): BrowserFault {
  const fault = browserFaultOf(err instanceof Error ? err.message : String(err));
  if (!fault) throw err;
  return fault;
}

interface Outcome {
  shot: ShotResult;
  fault: BrowserFault | null;
}

/** One cell on one browser: the shot, and the browser fault if it had one. */
async function shootCell(
  browser: Browser,
  encoder: Encoder,
  origin: string,
  cell: Cell,
  find: FindTarget[],
  viewportOnly: boolean,
  maxImageBytes: number,
): Promise<Outcome> {
  const device = DEVICES[cell.device];
  let context: BrowserContext;
  try {
    context = await browser.newContext({
      viewport: { width: device.width, height: device.height },
      deviceScaleFactor: device.scale,
      isMobile: device.mobile,
      hasTouch: device.mobile,
      colorScheme: cell.theme,
      reducedMotion: "reduce",
      // A service worker could answer requests the guard never sees.
      serviceWorkers: "block",
      acceptDownloads: false,
      userAgent: userAgentFor(device, browser.version()),
      locale: "en-US",
      extraHTTPHeaders: { "accept-language": "en-US,en;q=0.9" },
    });
  } catch (err) {
    return { shot: failedCell(cell, String(err instanceof Error ? err.message : err)), fault: faultOrThrow(err) };
  }
  let fault: BrowserFault | null = null;
  try {
    await context.addInitScript(silenceBeacons);
    await guard(context, origin);
    const page = await context.newPage();
    const shot = await shootRendering(
      page as unknown as CapturePage,
      encoder.blank,
      {
        origin,
        route: cell.route,
        device,
        theme: cell.theme,
        find,
        viewportOnly,
        navigationTimeoutMs: NAVIGATION_TIMEOUT_MS,
        previewBudgetMs: PREVIEW_BUDGET_MS,
        maxImageBytes,
      },
      {
        ...deps,
        onBrowserFault: (f) => {
          fault ??= f;
        },
      },
    );
    return { shot, fault };
  } catch (err) {
    return { shot: failedCell(cell, String(err instanceof Error ? err.message : err)), fault: faultOrThrow(err) };
  } finally {
    await context.close().catch(() => {});
  }
}

export async function shootAll(
  pool: BrowserPool<Browser>,
  lease: Lease<Browser>,
  origin: string,
  request: ShootRequest,
  deadline: number,
): Promise<ShotResult[]> {
  const shots: ShotResult[] = [];
  let spent = 200; // the envelope
  // A value pictured in one rendering isn't looked for again in the next.
  const found = new Set<string>();

  // The encoder runs in its own offline page, never in the site being shot.
  // It lives on the browser, so a replacement gets a new one.
  const held: { encoder: Encoder | null } = { encoder: null };
  const replaceBrowser = async (reason: string) => {
    await held.encoder?.context.close().catch(() => {});
    held.encoder = null;
    await pool.swap(lease, reason);
  };
  const ensureEncoder = async (): Promise<Encoder> => {
    if (held.encoder) return held.encoder;
    try {
      held.encoder = await openEncoder(lease.browser);
    } catch (err) {
      // Can't even open an offline context: replace the browser and try once more.
      await replaceBrowser(`browser fault (${faultOrThrow(err)}) opening the encoder`);
      held.encoder = await openEncoder(lease.browser);
    }
    return held.encoder;
  };

  try {
    for (const route of request.routes) {
      for (const deviceName of request.devices) {
        for (const theme of request.themes) {
          const cell: Cell = { route, device: deviceName, theme };
          const remaining = RESPONSE_BUDGET_BYTES - spent;
          if (Date.now() + SHOT_ESTIMATE_MS > deadline || remaining < 200_000) {
            shots.push({
              ...cell,
              reason: "budget",
              skipped: "didn't fit this request — ask for it on its own",
              previews: [],
              looked: [],
            });
            continue;
          }
          const find = request.find.filter((t) => !found.has(t.key));
          // Leave room for the previews and the rest of the envelope.
          const maxImageBytes = Math.min(3_400_000, remaining - 150_000);
          const shoot = async () =>
            shootCell(
              lease.browser,
              await ensureEncoder(),
              origin,
              cell,
              find,
              request.viewport === true,
              maxImageBytes,
            );

          let outcome = await shoot();
          if (outcome.fault) {
            await replaceBrowser(`browser fault (${outcome.fault}) shooting ${cell.device}/${cell.theme}`);
            if (Date.now() + SHOT_ESTIMATE_MS <= deadline) {
              outcome = await shoot();
              if (outcome.fault) {
                // A fresh browser faulting at once means the instance itself
                // is short of room; don't keep that one either.
                pool.discard(lease, `browser fault (${outcome.fault}) right after a relaunch`);
              }
            }
            if (outcome.fault) outcome.shot = { ...outcome.shot, skipped: REPLACED_TEXT };
          }
          pool.noteShots(lease, 1);
          spent += shotWireBytes(outcome.shot);
          for (const p of outcome.shot.previews) found.add(p.key);
          shots.push(outcome.shot);
        }
      }
    }
  } finally {
    await held.encoder?.context.close().catch(() => {});
  }
  return shots;
}
