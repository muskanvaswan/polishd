/**
 * The capture browser, launched once per function instance and reused.
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
import { chromium, type Browser } from "playwright-core";

import { resolvePublic } from "./net.ts";
import { startEgressProxy, type EgressProxy } from "./proxy.ts";
import type { ServiceConfig } from "./config.ts";

let launching: Promise<{ browser: Browser; proxy: EgressProxy }> | null = null;

function onServerless(): boolean {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

async function launch(config: ServiceConfig): Promise<{ browser: Browser; proxy: EgressProxy }> {
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

  try {
    let browser: Browser;
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
    return { browser, proxy };
  } catch (err) {
    await proxy.close();
    throw err;
  }
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

/** The shared browser, launched on first use and relaunched if it dies. */
export async function getBrowser(config: ServiceConfig): Promise<Browser> {
  if (!launching) {
    const attempt = launch(config);
    launching = attempt;
    attempt
      .then(({ browser, proxy }) => {
        browser.on("disconnected", () => {
          if (launching === attempt) launching = null;
          void proxy.close();
        });
      })
      .catch(() => {
        if (launching === attempt) launching = null;
      });
  }
  return (await launching).browser;
}

/**
 * A small gate on concurrent captures per instance: each one is a browser
 * context with a full page in it, and an instance that took on more than a
 * few at once would run out of memory before it ran out of time.
 */
const MAX_CONCURRENT = 3;
let active = 0;
const waiting: (() => void)[] = [];

export async function withCaptureSlot<T>(work: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
  try {
    return await work();
  } finally {
    active--;
    waiting.shift()?.();
  }
}
