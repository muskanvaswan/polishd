/**
 * Polishd — client capture layer.
 *
 * Vanilla DOM, no framework imports, so it drops cleanly into Next's
 * `instrumentation-client.ts` (runs before hydration) and is trivially
 * extractable into `@polishd/next`. It attaches global listeners, derives
 * behavioral signals (rage/dead clicks, scroll depth, web vitals), batches
 * events, and flushes on an interval, on soft navigation, and on pagehide.
 */
import { defaultPolishdConfig, type PolishdConfig } from "../config";
import type { PolishdEvent } from "../shared/types";

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

  const queue: PolishdEvent[] = [];
  let currentPath = location.pathname;
  let maxScrollPct = 0;

  const push = (e: Omit<PolishdEvent, "ts" | "path"> & Partial<Pick<PolishdEvent, "ts" | "path">>) => {
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

  // ---- DOM helpers ---------------------------------------------------------

  const INTERACTIVE = new Set(["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "LABEL", "SUMMARY"]);

  const isInteractive = (el: Element | null): boolean => {
    let node: Element | null = el;
    for (let depth = 0; node && depth < 4; depth++) {
      if (INTERACTIVE.has(node.tagName)) return true;
      const role = node.getAttribute("role");
      if (role && /button|link|menuitem|tab|checkbox|radio|switch/.test(role)) return true;
      if (node.hasAttribute("onclick") || (node as HTMLElement).isContentEditable) return true;
      node = node.parentElement;
    }
    return false;
  };

  /** True when the click coincided with the user highlighting text. */
  const hasTextSelection = (): boolean => {
    const sel = typeof window.getSelection === "function" ? window.getSelection() : null;
    return !!sel && !sel.isCollapsed && sel.toString().trim().length > 0;
  };

  /** Walk up for the nearest `data-component`, the key synthesis signal. */
  const componentOf = (el: Element | null): string | undefined => {
    let node: Element | null = el;
    for (let depth = 0; node && depth < 8; depth++) {
      const c = node.getAttribute("data-component");
      if (c) return c;
      node = node.parentElement;
    }
    return undefined;
  };

  /** Compact, stable-ish selector path (tag + id + first class), capped. */
  const selectorOf = (el: Element | null): string | undefined => {
    if (!el) return undefined;
    const parts: string[] = [];
    let node: Element | null = el;
    for (let depth = 0; node && depth < 4 && node.tagName !== "BODY"; depth++) {
      let part = node.tagName.toLowerCase();
      if (node.id) {
        parts.unshift(`${part}#${node.id}`);
        break;
      }
      const cls = (node.getAttribute("class") || "").trim().split(/\s+/)[0];
      if (cls) part += `.${cls}`;
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(">");
  };

  const labelOf = (el: Element | null): string | undefined => {
    const t = (el as HTMLElement | null)?.innerText || (el as HTMLElement | null)?.textContent || "";
    const trimmed = t.replace(/\s+/g, " ").trim();
    return trimmed ? trimmed.slice(0, 80) : undefined;
  };

  // ---- click + rage + dead -------------------------------------------------

  let lastClick = { selector: "", time: 0, count: 0 };

  const onClick = (ev: MouseEvent) => {
    const target = ev.target as Element | null;
    if (!target) return;
    const selector = selectorOf(target);
    const component = componentOf(target);
    const text = labelOf(target);
    const now = Date.now();

    // Rage: same selector clicked `count` times inside `windowMs`.
    if (selector === lastClick.selector && now - lastClick.time < cfg.rageClick.windowMs) {
      lastClick.count++;
      lastClick.time = now;
      if (lastClick.count === cfg.rageClick.count) {
        push({ type: "rage_click", selector, component, text });
      }
    } else {
      lastClick = { selector: selector ?? "", time: now, count: 1 };
    }

    // Dead: click that hits nothing interactive (likely confusion).
    if (!isInteractive(target)) {
      // A drag-to-highlight fires a click on the (non-interactive) text node on
      // mouse-up. That's intent, not confusion — don't log it as a dead click.
      if (hasTextSelection()) return;
      push({ type: "dead_click", selector, component, text });
    } else {
      push({ type: "click", selector, component, text });
    }
  };

  // ---- page views (incl. soft navigation) ----------------------------------

  const emitPageView = () => {
    // Flush the previous page's scroll depth before switching context.
    if (maxScrollPct > 0) push({ type: "scroll_depth", value: maxScrollPct });
    currentPath = location.pathname;
    maxScrollPct = 0;
    push({ type: "page_view", path: currentPath });
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

  // Coarse device buckets keyed off CSS-pixel width. Aligns with common
  // breakpoints (Tailwind sm/lg) so categories read intuitively on the
  // dashboard. The category is stored in `text` (a plain, portable column) so
  // it can be grouped without per-backend JSON querying.
  const deviceCategory = (w: number): string =>
    w < 640 ? "mobile" : w < 1024 ? "tablet" : "desktop";

  const emitViewport = () => {
    const w = window.innerWidth || document.documentElement.clientWidth || 0;
    const h = window.innerHeight || document.documentElement.clientHeight || 0;
    if (w <= 0) return;
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
    const pct = scrollable <= 0 ? 100 : Math.round((doc.scrollTop / scrollable) * 100);
    if (pct > maxScrollPct) maxScrollPct = Math.min(100, pct);
  };

  // ---- errors --------------------------------------------------------------

  const onError = (ev: ErrorEvent) => {
    push({
      type: "js_error",
      component: componentOf(ev.target as Element | null),
      meta: {
        message: String(ev.message).slice(0, 300),
        source: ev.filename || "",
        line: ev.lineno || 0,
      },
    });
  };

  const onRejection = (ev: PromiseRejectionEvent) => {
    const reason = ev.reason;
    push({
      type: "js_error",
      meta: { message: String(reason?.message ?? reason).slice(0, 300), kind: "unhandledrejection" },
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

  document.addEventListener("click", onClick, { capture: true, passive: true });
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("error", onError, true);
  addEventListener("unhandledrejection", onRejection);
  wrapHistory("pushState");
  wrapHistory("replaceState");
  addEventListener("popstate", () => {
    if (location.pathname !== currentPath) emitPageView();
  });

  // Final flush + session_end as the page goes away.
  addEventListener("pagehide", () => {
    if (maxScrollPct > 0) push({ type: "scroll_depth", value: maxScrollPct });
    push({ type: "session_end" });
    flush(true);
  });
  addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush(true);
  });

  observeVitals();
  setInterval(() => flush(false), cfg.flushIntervalMs);

  // One device/viewport sample per session, plus the initial page view.
  emitViewport();
  push({ type: "page_view", path: currentPath });
}
