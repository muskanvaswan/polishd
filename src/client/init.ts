/**
 * Polishd — client capture layer.
 *
 * Vanilla DOM, no framework imports, so it drops cleanly into Next's
 * `instrumentation-client.ts` (runs before hydration) and is trivially
 * extractable into `@polishd/next`. It attaches global listeners, derives
 * behavioral signals (rage/dead clicks, scroll depth, web vitals), batches
 * events, and flushes on an interval, on soft navigation, and on pagehide.
 */
import { defaultPolishdConfig, isDashboardPath, type PolishdConfig } from "../config";
import { sanitizeBuild } from "../shared/build";
import type { PolishdEvent, PolishdIngestBody } from "../shared/types";
import { detectClientBuild } from "./build";
import { startClickCapture } from "./click-capture";
import { scheduleDesignScan } from "./design-scan";
import { deviceCategory } from "./dom";

type InitOptions = Partial<PolishdConfig>;

let started = false;

// Next inlines this at build time. Guarded for any bundler that doesn't define
// `process`, in which case we simply stay quiet.
const IS_DEV =
  typeof process !== "undefined" && process.env && process.env.NODE_ENV !== "production";

export function initPolishd(options: InitOptions = {}): void {
  // Guard: client-only, run once, respect enable flag and Do Not Track.
  if (typeof window === "undefined" || started) return;
  const cfg: PolishdConfig = { ...defaultPolishdConfig, ...options };
  if (!cfg.enabled) return;
  if (navigator.doNotTrack === "1") return;
  // Per-session sampling decision, stable for the page's lifetime.
  if (cfg.sampleRate < 1 && Math.random() > cfg.sampleRate) return;
  started = true;

  // The build this bundle was made from, sent once per batch and stamped on
  // every event in it. The host's own label first, then what the build
  // inlined (client/build.ts); null leaves it to the server to stamp.
  const build = sanitizeBuild(cfg.build) ?? detectClientBuild();

  // The session id this page proposes, for the route to adopt if the request
  // arrives without a session cookie (see `mintSessionId` in session.ts). The
  // cookie is httpOnly, so the page can't tell whether it has one; it sends
  // this every time and the route ignores it once the cookie is set.
  const sid = proposeSessionId();

  const queue: PolishdEvent[] = [];
  let currentPath = location.pathname;
  let maxScrollPct = 0;

  const push = (e: Omit<PolishdEvent, "ts" | "path"> & Partial<Pick<PolishdEvent, "ts" | "path">>) => {
    // The dashboard is where you *read* the story, not part of it. Reading it
    // is browsing too — clicks, scrolls, page views — and left alone that
    // traffic outranks the real site. Drop it here, at the one funnel every
    // signal (including <PolishdMonitor>'s, via __polishdTrack) passes through,
    // and per-event rather than once at init so a soft navigation back out to
    // the real site resumes capture normally.
    if (isDashboardPath(e.path ?? currentPath, cfg.dashboardRoute)) return;
    queue.push({ ts: Date.now(), path: currentPath, ...e } as PolishdEvent);
    if (queue.length >= cfg.maxBatchSize) flush();
  };

  // Expose a track function so TrackingWrapper components can emit explicit
  // events (e.g. hover) without coupling to React internals.
  (window as Window & { __polishdTrack?: typeof push }).__polishdTrack = push;

  // ---- transport -----------------------------------------------------------

  // Ingest answers a batch with no session with `ok: true` and HTTP 200 — on
  // purpose, so beacons never retry — and `sendBeacon` cannot read a response
  // at all. The shipped route mints a session, so this only fires behind a
  // host's own handler that doesn't; it would be invisible from the browser
  // unless we deliberately look. One check of the first fetch flush is enough:
  // a handler like that drops every batch the same way.
  let diagnosed = false;
  const diagnose = (res: Response) => {
    if (diagnosed || !IS_DEV) return;
    diagnosed = true;
    res
      .json()
      .then((body: { stored?: number; reason?: string }) => {
        if (body?.reason !== "no_session") return;
        console.warn(
          "[polishd] events are being dropped: the ingest route stored this batch under " +
            "no session.\n" +
            "  The route from `createPolishdRoute()` mints one itself; a handler of your own " +
            "around `ingest()` has to pass a session id.\n" +
            "  Run `npx @polishd/next doctor` to check.",
        );
      })
      .catch(() => {
        // A body we can't parse is not a diagnosis; stay quiet.
      });
  };

  const flush = (useBeacon = false) => {
    if (queue.length === 0) return;
    const batch = queue.splice(0, queue.length);
    const payload: PolishdIngestBody = { events: batch, page: currentPath, sid };
    if (build) payload.build = build;
    const body = JSON.stringify(payload);
    // sendBeacon survives unload; fetch is used for periodic flushes.
    if (useBeacon && navigator.sendBeacon) {
      const ok = navigator.sendBeacon(cfg.apiRoute, new Blob([body], { type: "application/json" }));
      if (!ok) queue.unshift(...batch); // re-queue on beacon rejection
      return;
    }
    fetch(cfg.apiRoute, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    })
      .then(diagnose)
      .catch(() => {
        // Network hiccup: put events back so the next flush retries them.
        queue.unshift(...batch);
      });
  };

  // ---- click + rage + dead -------------------------------------------------

  // Shared with the dashboard's telemetry emitter (see click-capture.ts). A
  // click on something that isn't a control is held for a second and judged
  // by whether the page responded, so its event can arrive after later ones;
  // it carries its own click-time `ts` and `path`.
  const clicks = startClickCapture({
    rageCount: cfg.rageClick.count,
    rageWindowMs: cfg.rageClick.windowMs,
    path: () => currentPath,
    // The dashboard's clicks are dropped by `push` anyway; skip judging them.
    active: () => !isDashboardPath(currentPath, cfg.dashboardRoute),
    emit: push,
  });

  // ---- page views (incl. soft navigation) ----------------------------------

  const emitPageView = () => {
    // Flush the previous page's scroll depth before switching context.
    if (maxScrollPct > 0) push({ type: "scroll_depth", value: maxScrollPct });
    currentPath = location.pathname;
    maxScrollPct = 0;
    emitViewport(); // no-op unless the session started on the dashboard
    push({ type: "page_view", path: currentPath });
    emitDesignScan();
  };

  // ---- design scan (feeds the dashboard's Design tab) -----------------------

  // One scan per path per session and build, after the page settles. The
  // payload is a compact tally of the page's rendered typography, colors,
  // radii and paddings — the deterministic input to the design review. In
  // development every load scans: the design changes under the developer
  // between reloads, and the Design tab is where they go to see it.
  const emitDesignScan = () => {
    const path = currentPath;
    if (isDashboardPath(path, cfg.dashboardRoute)) return; // never scan the dashboard
    scheduleDesignScan(
      path,
      (payloadJson, elements) => {
        push({ type: "design_scan", path, meta: { payload: payloadJson, el: elements } });
        flush();
      },
      { build, once: !IS_DEV },
    );
  };

  // Patch History API so Next.js soft navigations emit page views.
  const wrapHistory = (method: "pushState" | "replaceState") => {
    const original = history[method];
    history[method] = function (this: History, ...args: Parameters<History["pushState"]>) {
      const ret = original.apply(this, args);
      if (location.pathname !== currentPath) emitPageView();
      return ret;
    };
  };

  // ---- viewport / device size ----------------------------------------------

  // The device category is stored in `text` (a plain, portable column) so it
  // can be grouped without per-backend JSON querying.
  // One sample per session. It's session-scoped rather than page-scoped, so a
  // session that happens to start on the dashboard defers it to the first real
  // page instead of losing it — hence the flag rather than a single init call.
  let viewportSent = false;

  const emitViewport = () => {
    if (viewportSent) return;
    if (isDashboardPath(currentPath, cfg.dashboardRoute)) return;
    const w = window.innerWidth || document.documentElement.clientWidth || 0;
    const h = window.innerHeight || document.documentElement.clientHeight || 0;
    if (w <= 0) return;
    viewportSent = true;
    push({
      type: "viewport",
      value: w,
      text: deviceCategory(w),
      meta: { w, h, dpr: Math.round((window.devicePixelRatio || 1) * 100) / 100 },
    });
  };

  // ---- scroll depth --------------------------------------------------------

  const onScroll = () => {
    const doc = document.documentElement;
    const scrollable = doc.scrollHeight - doc.clientHeight;
    // A page with (nearly) nothing to scroll hits 100% by existing — depth
    // carries no attention signal there, so record nothing and let the page
    // read "no scroll data" instead of a flattering 100.
    if (scrollable < doc.clientHeight * 0.1) return;
    const pct = Math.round((doc.scrollTop / scrollable) * 100);
    if (pct > maxScrollPct) maxScrollPct = Math.min(100, pct);
  };

  // ---- web vitals (LCP, CLS) ----------------------------------------------

  const observeVitals = () => {
    if (typeof PerformanceObserver === "undefined") return;
    try {
      // Largest Contentful Paint — last entry wins.
      let lcp = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) lcp = entry.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });

      // Cumulative Layout Shift — sum of non-input shifts.
      let cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as PerformanceEntry[]) {
          const e = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
          if (!e.hadRecentInput) cls += e.value;
        }
      }).observe({ type: "layout-shift", buffered: true });

      // Report the finalized values when the page is hidden.
      addEventListener(
        "visibilitychange",
        () => {
          if (document.visibilityState !== "hidden") return;
          if (lcp > 0) push({ type: "web_vital", value: Math.round(lcp), meta: { name: "LCP" } });
          push({ type: "web_vital", value: Math.round(cls * 1000) / 1000, meta: { name: "CLS" } });
        },
        { once: true },
      );
    } catch {
      /* unsupported entry types — skip vitals */
    }
  };

  // ---- lifecycle -----------------------------------------------------------

  addEventListener("scroll", onScroll, { passive: true });
  wrapHistory("pushState");
  wrapHistory("replaceState");
  addEventListener("popstate", () => {
    if (location.pathname !== currentPath) emitPageView();
  });

  // Final flush + session_end as the page goes away. Clicks still being
  // judged settle first: a page that hides or unloads right after a click
  // (a new tab, a full navigation) did respond to it.
  addEventListener("pagehide", () => {
    clicks.settle();
    if (maxScrollPct > 0) push({ type: "scroll_depth", value: maxScrollPct });
    push({ type: "session_end" });
    flush(true);
  });
  addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden") return;
    clicks.settle();
    flush(true);
  });

  observeVitals();
  setInterval(() => flush(false), cfg.flushIntervalMs);

  // One device/viewport sample per session, plus the initial page view.
  emitViewport();
  push({ type: "page_view", path: currentPath });
  emitDesignScan();
}

/**
 * A random UUID. `crypto.randomUUID` is missing outside secure contexts (a
 * plain-http LAN address in development), so fall back to building one from
 * `getRandomValues`, which every browser has.
 */
function proposeSessionId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
