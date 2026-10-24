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
import { isIgnorableError } from "../shared/error-noise";
import type { PolishdEvent } from "../shared/types";
import { startClickCapture } from "./click-capture";
import { scheduleDesignScan } from "./design-scan";
import { componentOf, deviceCategory, handleOf } from "./dom";
import { errorContextMeta } from "./error-context";
import { errorOrigin, startScriptProvenance } from "./script-provenance";

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

  // Start before anything else can throw: this is what lets an error name the
  // script it came from, and it has to be listening first.
  startScriptProvenance();

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

  // Ingest answers a missing session cookie with `ok: true` and HTTP 200 — on
  // purpose, so beacons never retry — and `sendBeacon` cannot read a response
  // at all. So a proxy that isn't running is invisible from the browser unless
  // we deliberately look. Inspect the first fetch flush of the page; if the
  // proxy is down every flush fails the same way, so one check is enough.
  let diagnosed = false;
  const diagnose = (res: Response) => {
    if (diagnosed || !IS_DEV) return;
    diagnosed = true;
    res
      .json()
      .then((body: { stored?: number; reason?: string }) => {
        if (body?.reason !== "no_session") return;
        console.warn(
          "[polishd] events are being dropped: the request carried no session cookie, " +
            "so the proxy that mints it isn't running on this path.\n" +
            "  Expected `proxy.ts` (Next 16+) or `middleware.ts` (Next 15) at the project " +
            "root, exporting a function of the same name.\n" +
            "  `config.matcher` must be an inline literal and must cover this path.\n" +
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
    const body = JSON.stringify({ events: batch, page: currentPath });
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

  // One scan per path per session, after the page settles. The payload is a
  // compact tally of the page's rendered typography, colors, radii and
  // paddings — the deterministic input to the design review.
  const emitDesignScan = () => {
    const path = currentPath;
    if (isDashboardPath(path, cfg.dashboardRoute)) return; // never scan the dashboard
    scheduleDesignScan(path, (payloadJson, elements) => {
      push({ type: "design_scan", path, meta: { payload: payloadJson, el: elements } });
      flush();
    });
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

  // ---- errors --------------------------------------------------------------

  // `window` hears every throw in the tab, including the ones from extensions
  // injected into the page. Those are not the site's bugs and nothing here can
  // fix them, so they never become events.
  //
  // Provenance decides first and decides most: the scripts this document
  // fetched are known (see `script-provenance.ts`), so code from anywhere else
  // is identifiable without knowing what it's called. The message rules in
  // `shared/error-noise.ts` only mop up what has no attributable frame at all —
  // extension plumbing that throws with the page as its only stack entry.
  //
  // Errors that aren't the site's but aren't confidently an extension's are
  // kept and labeled with `meta.origin`, never silently dropped.
  const captureError = (
    message: string,
    origin: ReturnType<typeof errorOrigin>,
    extra: Partial<PolishdEvent> & { meta: NonNullable<PolishdEvent["meta"]> },
  ) => {
    if (origin === "extension") return;
    if (isIgnorableError({ message, source: String(extra.meta.source ?? ""), ignore: cfg.ignoreErrors })) {
      return;
    }
    push({
      type: "js_error",
      ...extra,
      meta: {
        ...extra.meta,
        message: message.slice(0, 300),
        // Absent means "site" — the common case shouldn't pay for the label.
        ...(origin === "site" ? {} : { origin }),
      },
    });
  };

  // Each error also carries Next's digest, its top stack frame and the click
  // just before it, when there are any (see error-context.ts).
  const onError = (ev: ErrorEvent) => {
    const source = ev.filename || "";
    const line = ev.lineno || 0;
    captureError(String(ev.message), errorOrigin(source, ev.error?.stack), {
      // `window` for a runtime throw (no component); the failing element for a
      // resource load.
      component: componentOf(ev.target),
      meta: {
        source,
        line,
        ...errorContextMeta(ev.error, clicks.lastInteraction(), Date.now(), {
          source,
          line,
          col: ev.colno || 0,
          handle: handleOf(ev.target),
        }),
      },
    });
  };

  const onRejection = (ev: PromiseRejectionEvent) => {
    const reason = ev.reason;
    // A rejection carries no filename, so the stack is the only thing that can
    // place the code that threw it.
    captureError(String(reason?.message ?? reason), errorOrigin(undefined, reason?.stack), {
      meta: {
        kind: "unhandledrejection",
        ...errorContextMeta(reason, clicks.lastInteraction(), Date.now()),
      },
    });
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
  addEventListener("error", onError, true);
  addEventListener("unhandledrejection", onRejection);
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
