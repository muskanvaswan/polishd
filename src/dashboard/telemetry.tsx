"use client";

/**
 * Polishd — the dashboard's own telemetry: emitter + consent prompt.
 *
 * The dashboard is polishd's product surface, and it is exactly the traffic
 * the package refuses to record for its hosts (the dashboard-path drop in
 * ingest). This emitter is the separate, opt-in channel that records it —
 * dashboard interactions only — and reports it to the polishd project's own
 * `@polishd/next/telemetry` endpoint, so the dashboard is improved by the same
 * signals it preaches.
 *
 * Everything about the transport differs from the host-site capture layer
 * because the POST crosses origins:
 *
 *   • The session id travels in the body, minted here (the httpOnly session
 *     cookie never leaves its origin). The *installation* sends no id at all:
 *     the collecting side names it by this page's hostname, taken from the
 *     Origin header the browser sets on the cross-origin POST.
 *   • Batches are sent as `text/plain`, which keeps the request inside CORS's
 *     "simple" class — no preflight — and is the only shape `sendBeacon` can
 *     deliver cross-origin anyway. The receiving route parses the body as
 *     JSON regardless of the header.
 *   • Paths are namespaced under `/~polishd/<tab>` so the receiving database
 *     can never confuse dashboard telemetry with the receiving site's own
 *     first-party pages.
 *
 * What is captured: page views (tab switches), clicks (with the same
 * rage/dead classification as the host capture layer, via the shared DOM
 * helpers), scroll depth of the dashboard's own scroll container, JS errors
 * raised while the dashboard is up, one design scan of the dashboard per tab
 * per session, one viewport sample per session, and session end. Everything
 * the full dashboard experience needs on the collecting side — and never
 * anything from the host site's own pages: capture suspends the moment the
 * URL leaves the dashboard's mount path.
 */
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { isIgnorableError } from "../shared/error-noise";
import type { PolishdEvent } from "../shared/types";
import {
  componentOf,
  deviceCategory,
  hasTextSelection,
  isInteractive,
  labelOf,
  selectorOf,
} from "../client/dom";
import { scheduleDesignScan } from "../client/design-scan";
import { errorOrigin, startScriptProvenance } from "../client/script-provenance";
import type { PolishdTelemetryInstallState } from "../server/telemetry";
import { denyPolishdTelemetry, grantPolishdTelemetry } from "./telemetry-consent";

const PATH_PREFIX = "/~polishd";
const SESSION_KEY = "polishd_telemetry_session";
const FLUSH_INTERVAL_MS = 15_000;
const MAX_BATCH = 50;
const RAGE_COUNT = 3;
const RAGE_WINDOW_MS = 500;

declare global {
  interface Window {
    __polishdTelemetryStarted?: boolean;
  }
}

/** The telemetry path for the tab currently in the URL. */
function telemetryPath(): string {
  const tab = new URLSearchParams(location.search).get("tab");
  return `${PATH_PREFIX}/${tab || "analytics"}`;
}

/** A session id that survives soft navigation but not the browser session. */
function sessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const minted = crypto.randomUUID();
    sessionStorage.setItem(SESSION_KEY, minted);
    return minted;
  } catch {
    // Storage blocked — a per-page-load id is the honest fallback.
    return crypto.randomUUID();
  }
}

function start(endpoint: string, installState: PolishdTelemetryInstallState | null): void {
  const sid = sessionId();
  // The route the dashboard is mounted at, learned from where we woke up.
  // Capture is suspended whenever the URL wanders off it — the listeners
  // below outlive the dashboard page, and host-site interactions must never
  // leak into telemetry.
  const mountPath = location.pathname;
  const onDashboard = () => location.pathname === mountPath;

  const queue: PolishdEvent[] = [];
  let currentPath = telemetryPath();

  const flush = (useBeacon = false) => {
    if (queue.length === 0) return;
    const batch = queue.splice(0, queue.length);
    const body = JSON.stringify({ sessionId: sid, events: batch });
    if (useBeacon && navigator.sendBeacon) {
      const ok = navigator.sendBeacon(endpoint, new Blob([body], { type: "text/plain" }));
      if (!ok) queue.unshift(...batch);
      return;
    }
    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body,
      keepalive: true,
    }).catch(() => {
      queue.unshift(...batch);
    });
  };

  const push = (
    e: Omit<PolishdEvent, "ts" | "path"> & Partial<Pick<PolishdEvent, "ts" | "path">>,
  ) => {
    if (!onDashboard()) return;
    queue.push({ ts: Date.now(), path: currentPath, ...e } as PolishdEvent);
    if (queue.length >= MAX_BATCH) flush();
  };

  // ---- clicks (same classification as the host capture layer) --------------

  let lastClick = { selector: "", time: 0, count: 0 };

  document.addEventListener(
    "click",
    (ev) => {
      const target = ev.target as Element | null;
      if (!target || !onDashboard()) return;
      const selector = selectorOf(target);
      const component = componentOf(target);
      const text = labelOf(target);
      const now = Date.now();

      if (selector === lastClick.selector && now - lastClick.time < RAGE_WINDOW_MS) {
        lastClick.count++;
        lastClick.time = now;
        if (lastClick.count === RAGE_COUNT) {
          push({ type: "rage_click", selector, component, text });
        }
      } else {
        lastClick = { selector: selector ?? "", time: now, count: 1 };
      }

      if (!isInteractive(target)) {
        if (hasTextSelection()) return;
        push({ type: "dead_click", selector, component, text });
      } else {
        push({ type: "click", selector, component, text });
      }
    },
    { capture: true, passive: true },
  );

  // ---- scroll depth (of whatever actually scrolls) --------------------------

  // The dashboard scrolls inside its own shell container, not the document,
  // so this listens in the capture phase and reads whichever element fired —
  // only meaningfully scrollable ones contribute.
  let maxScrollPct = 0;

  document.addEventListener(
    "scroll",
    (ev) => {
      if (!onDashboard()) return;
      const t = ev.target;
      const el = t instanceof Element ? t : document.documentElement;
      const scrollable = el.scrollHeight - el.clientHeight;
      if (scrollable <= 0) return;
      const pct = Math.min(100, Math.round((el.scrollTop / scrollable) * 100));
      if (pct > maxScrollPct) maxScrollPct = pct;
    },
    { capture: true, passive: true },
  );

  /** Report the outgoing tab's depth before the path context changes. */
  const flushScrollDepth = () => {
    if (maxScrollPct <= 0) return;
    push({ type: "scroll_depth", value: maxScrollPct });
    maxScrollPct = 0;
  };

  // ---- errors ---------------------------------------------------------------

  // Extension throws reach `window` here too — and the dashboard is a page the
  // owner keeps open, so its tab collects them for as long as it's up. Same
  // provenance test as first-party capture.
  startScriptProvenance();

  addEventListener(
    "error",
    (ev) => {
      if (!onDashboard()) return;
      const message = String(ev.message);
      const source = ev.filename || "";
      const origin = errorOrigin(source, ev.error?.stack);
      if (origin === "extension" || isIgnorableError({ message, source })) return;
      push({
        type: "js_error",
        meta: {
          message: message.slice(0, 300),
          source,
          line: ev.lineno || 0,
          ...(origin === "site" ? {} : { origin }),
        },
      });
    },
    true,
  );
  addEventListener("unhandledrejection", (ev) => {
    if (!onDashboard()) return;
    const reason = ev.reason;
    const message = String(reason?.message ?? reason);
    const origin = errorOrigin(undefined, reason?.stack);
    if (origin === "extension" || isIgnorableError({ message })) return;
    push({
      type: "js_error",
      meta: {
        message: message.slice(0, 300),
        kind: "unhandledrejection",
        ...(origin === "site" ? {} : { origin }),
      },
    });
  });

  // ---- design scan (the dashboard's own rendered design) --------------------

  // One scan per tab per session, labeled with the telemetry path. On the
  // collecting side this is what feeds the Design tab: the dashboard's design
  // as real installs actually render it.
  const emitDesignScan = () => {
    const path = currentPath;
    scheduleDesignScan(
      path,
      (payloadJson, elements) => {
        push({ type: "design_scan", path, meta: { payload: payloadJson, el: elements } });
        flush();
      },
      { scanDashboard: true, stillCurrent: () => onDashboard() && telemetryPath() === path },
    );
  };

  // ---- page views (tab switches ride on the History API) -------------------

  const onNavigate = () => {
    if (!onDashboard()) return;
    const next = telemetryPath();
    if (next === currentPath) return;
    flushScrollDepth();
    currentPath = next;
    push({ type: "page_view", path: currentPath });
    emitDesignScan();
  };

  const wrapHistory = (method: "pushState" | "replaceState") => {
    const original = history[method];
    history[method] = function (this: History, ...args: Parameters<History["pushState"]>) {
      const ret = original.apply(this, args);
      onNavigate();
      return ret;
    };
  };
  wrapHistory("pushState");
  wrapHistory("replaceState");
  addEventListener("popstate", onNavigate);

  // ---- lifecycle -----------------------------------------------------------

  addEventListener("pagehide", () => {
    flushScrollDepth();
    push({ type: "session_end" });
    flush(true);
  });
  addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush(true);
  });
  setInterval(() => flush(false), FLUSH_INTERVAL_MS);

  const w = window.innerWidth || document.documentElement.clientWidth || 0;
  if (w > 0) {
    push({ type: "viewport", value: w, text: deviceCategory(w) });
  }

  // One install-state snapshot per session: whether a model is connected and
  // which provider/model — the product questions ("how many installs actually
  // configure AI?") that click events can't answer. Server-resolved, no key.
  if (installState) {
    const STATE_KEY = "polishd_telemetry_state";
    let sent = false;
    try {
      sent = sessionStorage.getItem(STATE_KEY) !== null;
      if (!sent) sessionStorage.setItem(STATE_KEY, "1");
    } catch {
      /* storage blocked — a duplicate per page load is tolerable */
    }
    if (!sent) {
      push({
        type: "install_state",
        meta: {
          hasModel: installState.hasModel,
          provider: installState.provider,
          model: installState.model,
        },
      });
    }
  }

  push({ type: "page_view", path: currentPath });
  emitDesignScan();
}

/**
 * Mounted by the dashboard page only when consent is granted. Renders nothing;
 * starts the capture singleton once per page load (the listeners are global
 * and deliberately never torn down — capture suspends off-dashboard instead).
 */
export function PolishdTelemetryEmitter({
  endpoint,
  installState = null,
}: {
  endpoint: string;
  installState?: PolishdTelemetryInstallState | null;
}) {
  useEffect(() => {
    if (window.__polishdTelemetryStarted) return;
    if (navigator.doNotTrack === "1") return;
    window.__polishdTelemetryStarted = true;
    start(endpoint, installState);
  }, [endpoint, installState]);
  return null;
}

/**
 * The one-time opt-in prompt, shown while consent is "unset". Both buttons
 * persist the decision through a guarded server action; "Share" refreshes the
 * server render so the emitter mounts immediately rather than on next visit.
 */
export function PolishdTelemetryConsent() {
  const router = useRouter();
  const [dismissed, setDismissed] = useState(false);
  const [pending, startTransition] = useTransition();
  if (dismissed) return null;

  const decide = (granted: boolean) =>
    startTransition(async () => {
      try {
        if (granted) {
          await grantPolishdTelemetry();
          router.refresh();
        } else {
          await denyPolishdTelemetry();
        }
      } catch {
        // Denied or store unavailable — the banner will be back next render;
        // hiding it now keeps this visit usable either way.
      }
      setDismissed(true);
    });

  return (
    <div
      role="dialog"
      aria-label="Polishd telemetry consent"
      className="fixed bottom-4 right-4 z-50 w-[340px] max-w-[calc(100vw-2rem)] rounded-xl border border-[#2e2e2e] bg-[#111] p-4 shadow-2xl"
    >
      <p className="text-[13px] font-medium text-white">Help improve polishd?</p>
      <p className="mt-1.5 text-[12px] leading-relaxed text-[#888]">
        Share anonymous usage of <span className="text-[#aaa]">this dashboard</span> — clicks and
        tab views inside it, plus which model provider you&apos;ve connected (never the key) —
        reported under your site&apos;s domain. Never your site&apos;s analytics, never your
        visitors&apos; data. Opt out any time with{" "}
        <code className="font-mono text-[11px] text-[#aaa]">POLISHD_TELEMETRY=off</code>.
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => decide(true)}
          className="rounded-lg bg-white px-3 py-1.5 text-[12px] font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          Share
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => decide(false)}
          className="rounded-lg border border-[#2e2e2e] px-3 py-1.5 text-[12px] text-[#888] transition-colors hover:text-white disabled:opacity-50"
        >
          No thanks
        </button>
      </div>
    </div>
  );
}
