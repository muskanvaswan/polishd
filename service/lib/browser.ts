/**
 * The capture browser: launched per function instance, leased through the
 * pool (pool.ts), and replaced when it wedges or wears out rather than kept.
 *
 * On Vercel it's `@sparticuz/chromium` — a Chromium built to unpack and run in
 * Lambda-shaped sandboxes. Locally it's your installed Chrome, or Playwright's
 * Chromium. The choice is made from the environment at runtime, never from
 * `process.platform`, which Turbopack inlines at build time.
 *
 * Every launch routes all traffic through the egress proxy (proxy.ts) with
 * loopback explicitly not bypassed, resolves no names itself, and keeps
 * WebRTC off the network, so the proxy is the only way out.
 */
import fs from "node:fs";

import { chromium, type Browser } from "playwright-core";

import type { ServiceConfig } from "./config.ts";
import { resolvePublic } from "./net.ts";
import {
  createBrowserPool,
  type BrowserPool,
  type Launched,
  type Lease,
  type Pressure,
} from "./pool.ts";
import { startEgressProxy, type EgressProxy } from "./proxy.ts";

/** A wedged Chromium may never answer `close`; after this long it's killed outright. */
const CLOSE_TIMEOUT_MS = 5_000;

function onServerless(): boolean {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

function firstLine(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.split("\n")[0] ?? message;
}

async function launch(config: ServiceConfig): Promise<Launched<Browser>> {
  const proxy = await startEgressProxy({
    resolve: (host) => resolvePublic(host, { allowLoopback: config.allowLoopback }),
    portAllowed: config.portAllowed,
  });
  const args = [
    "--force-color-profile=srgb",
    "--hide-scrollbars",
    // Without a proxy for UDP, WebRTC could reach addresses the proxy never sees.
    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    // Belt and braces: if anything ever tried to connect without the proxy,
    // it couldn't resolve a name to do it with.
    "--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1",
  ];
  const proxySettings = { server: `http://127.0.0.1:${proxy.port}`, bypass: "<-loopback>" };

  let browser: Browser;
  try {
    if (onServerless()) {
      const sparticuz = (await import("@sparticuz/chromium")).default;
      browser = await chromium.launch({
        args: [...sparticuz.args, ...args],
        executablePath: await sparticuz.executablePath(),
        proxy: proxySettings,
      });
    } else {
      browser = await launchLocal(args, proxySettings);
    }
  } catch (err) {
    await proxy.close();
    throw err;
  }
  const pid = await browserPid(browser);
  return {
    browser,
    close: () => closeBrowser(browser, pid, proxy),
    onDisconnected: (listener) => {
      browser.once("disconnected", listener);
    },
    ...(pid === null ? {} : { pressure: () => processPressure(pid) }),
  };
}

async function launchLocal(
  args: string[],
  proxy: { server: string; bypass: string },
): Promise<Browser> {
  let lastError: unknown;
  for (const channel of ["chrome", "msedge", undefined] as const) {
    try {
      return await chromium.launch({ args, proxy, ...(channel ? { channel } : {}) });
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("no browser could be launched");
}

/**
 * The browser process's id, asked over CDP since Playwright doesn't expose
 * it. Null where the domain isn't available: then there's no pressure
 * reading, and a close that hangs can't be followed by a kill.
 */
async function browserPid(browser: Browser): Promise<number | null> {
  try {
    const session = await browser.newBrowserCDPSession();
    try {
      const { processInfo } = await session.send("SystemInfo.getProcessInfo");
      return processInfo.find((p) => p.type === "browser")?.id ?? null;
    } finally {
      await session.detach().catch(() => {});
    }
  } catch {
    return null;
  }
}

/** Close politely, kill if that hangs, and take the proxy down with it. */
async function closeBrowser(browser: Browser, pid: number | null, proxy: EgressProxy): Promise<void> {
  const closed = browser.close().then(
    () => true,
    () => true, // already gone
  );
  const inTime = await Promise.race([closed, sleep(CLOSE_TIMEOUT_MS).then(() => false)]);
  if (!inTime && pid !== null) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Exited in the meantime.
    }
  }
  await proxy.close().catch(() => {});
}

/** Resident size and open descriptors of `pid`, from /proc — Linux only, so Vercel; null elsewhere. */
export function processPressure(pid: number): Pressure | null {
  if (process.platform !== "linux") return null;
  let rssBytes: number | null = null;
  let fds: number | null = null;
  try {
    const m = /^VmRSS:\s+(\d+)\s+kB/m.exec(fs.readFileSync(`/proc/${pid}/status`, "utf8"));
    if (m) rssBytes = Number(m[1]) * 1024;
  } catch {
    // Gone, or not readable here.
  }
  try {
    fds = fs.readdirSync(`/proc/${pid}/fd`).length;
  } catch {
    // Same.
  }
  return rssBytes === null && fds === null ? null : { rssBytes, fds };
}

let pool: BrowserPool<Browser> | null = null;

/** This instance's pool, made on first use. */
export function browserPool(config: ServiceConfig): BrowserPool<Browser> {
  pool ??= createBrowserPool<Browser>({
    ...config.browser,
    launch: () => launch(config),
    log: (message) => console.warn(`[shots] ${message}`),
  });
  return pool;
}

/** Run `work` holding a lease on a browser, once a slot is free. */
export async function withBrowser<T>(
  config: ServiceConfig,
  work: (lease: Lease<Browser>, pool: BrowserPool<Browser>) => Promise<T>,
): Promise<T> {
  const p = browserPool(config);
  const lease = await p.acquire();
  try {
    return await work(lease, p);
  } finally {
    p.release(lease);
  }
}

// ── Health ───────────────────────────────────────────────────────────────────

/**
 * - `ok`           a blank page was opened and screenshotted on the pooled browser
 * - `wedged`       the browser is up but couldn't do that; it has been retired
 * - `busy`         every slot was taken for the whole wait, so nothing was checked
 * - `unavailable`  no browser could be launched
 */
export type BrowserHealth = "ok" | "wedged" | "busy" | "unavailable";

export interface BrowserProbe {
  state: BrowserHealth;
  ms: number;
  detail?: string;
}

/** How long the probe waits for a slot: captures hold them for up to a shot each. */
const PROBE_WAIT_MS = 15_000;
/** A blank page's screenshot takes well under a second on a browser that works. */
const PROBE_TIMEOUT_MS = 8_000;

async function blankShot(browser: Browser): Promise<void> {
  const context = await browser.newContext({ viewport: { width: 64, height: 64 } });
  try {
    const page = await context.newPage();
    await page.goto("about:blank", { timeout: 3_000 });
    await page.screenshot({ type: "png" });
  } finally {
    await context.close().catch(() => {});
  }
}

/**
 * Exercise the browser the way a shot would, cheaply. What GET /api/v1
 * reports — a limiter check alone said "ok" through a whole outage — and the
 * one way a wedged instance gets replaced without a capture having to hit it.
 */
export async function probeBrowser(config: ServiceConfig): Promise<BrowserProbe> {
  const started = Date.now();
  const ms = () => Date.now() - started;
  const p = browserPool(config);

  const pending = p.acquire();
  let lease: Lease<Browser> | null;
  try {
    lease = await Promise.race([pending, sleep(PROBE_WAIT_MS).then(() => null)]);
  } catch (err) {
    return { state: "unavailable", ms: ms(), detail: firstLine(err) };
  }
  if (!lease) {
    // The slot will still be handed out; give it straight back.
    pending.then((l) => p.release(l), () => {});
    return { state: "busy", ms: ms(), detail: `${p.stats().active} captures in flight` };
  }
  try {
    await Promise.race([
      blankShot(lease.browser),
      sleep(PROBE_TIMEOUT_MS).then(() => {
        throw new Error("the blank page took too long");
      }),
    ]);
    return { state: "ok", ms: ms() };
  } catch (err) {
    const detail = firstLine(err);
    p.discard(lease, `the probe failed: ${detail}`);
    return { state: "wedged", ms: ms(), detail };
  } finally {
    p.release(lease);
  }
}
