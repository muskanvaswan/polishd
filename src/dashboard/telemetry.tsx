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
 *   • Identity travels in the body — an anonymous session id minted here (the
 *     httpOnly session cookie never leaves its origin) plus the stable
 *     anonymous install id the server resolved from `polishd_meta`.
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
 * helpers), one viewport sample per session, and session end. Nothing else —
 * no scroll depth, no errors, no design scans, and never anything from the
 * host site's own pages: capture suspends the moment the URL leaves the
 * dashboard's mount path.
 */
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import type { PolishdEvent } from "../shared/types";
import {
  componentOf,
  deviceCategory,
  hasTextSelection,
  isInteractive,
  labelOf,
  selectorOf,
} from "../client/dom";
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

function start(endpoint: string, installId: string): void {
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
    const body = JSON.stringify({ installId, sessionId: sid, events: batch });
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

  // ---- page views (tab switches ride on the History API) -------------------

  const onNavigate = () => {
    if (!onDashboard()) return;
    const next = telemetryPath();
    if (next === currentPath) return;
    currentPath = next;
    push({ type: "page_view", path: currentPath });
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
  push({ type: "page_view", path: currentPath });
}

/**
 * Mounted by the dashboard page only when consent is granted. Renders nothing;
 * starts the capture singleton once per page load (the listeners are global
 * and deliberately never torn down — capture suspends off-dashboard instead).
 */
export function PolishdTelemetryEmitter({
  endpoint,
  installId,
}: {
  endpoint: string;
  installId: string;
}) {
  useEffect(() => {
    if (window.__polishdTelemetryStarted) return;
    if (navigator.doNotTrack === "1") return;
    window.__polishdTelemetryStarted = true;
    start(endpoint, installId);
  }, [endpoint, installId]);
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
        tab views inside it, tied to a random install id. Never your site&apos;s analytics, never
        your visitors&apos; data. Opt out any time with{" "}
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
