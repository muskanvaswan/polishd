/**
 * @buffd/next/dashboard — the Buffd dashboard.
 *
 *   // src/app/buffd/page.tsx
 *   import { createBuffdPage } from "@buffd/next/dashboard";
 *   export { runtime, dynamic, metadata } from "@buffd/next/dashboard";
 *   export default createBuffdPage();            // unguarded
 *
 * Protect it by passing an `authenticate` callback (and optionally your own
 * login UI via `unauthorized`):
 *
 *   export default createBuffdPage({
 *     authenticate: isAuthenticated,
 *     unauthorized: <MyLogin />,
 *   });
 */
import type { Metadata } from "next";
import type { ReactNode } from "react";

import {
  getDeviceBreakdown,
  getElementStats,
  getMonitoredComponents,
  getOverview,
  getRecentErrors,
  getSessionJourneys,
  getTopInteractions,
  getTopPages,
  type DeviceBucket,
  type MonitoredComponent,
} from "../server/queries";
import ElementsTable from "./elements";
import TopFeaturesTable from "./features";
import JourneyList from "./journeys";
import TopPagesTable from "./pages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Buffd — What gets measured gets improved",
  robots: { index: false, follow: false },
};

// ── Design tokens (Vercel aesthetic) ────────────────────────────────────────
const border = "border-[#2e2e2e]";
const card = `border ${border} rounded-lg bg-[#0a0a0a]`;
const label = "text-[11px] font-medium uppercase tracking-[0.08em] text-[#666]";
const divider = `border-t ${border}`;

// ── Tooltip ──────────────────────────────────────────────────────────────────
function InfoTip({
  text,
  anchor = "center",
  below = false,
}: {
  text: string;
  anchor?: "left" | "center" | "right";
  below?: boolean;
}) {
  const anchorClass =
    anchor === "left" ? "left-0" : anchor === "right" ? "right-0" : "left-1/2 -translate-x-1/2";
  const vClass = below ? "top-full mt-2" : "bottom-full mb-2";
  return (
    <span className="group/tip relative ml-1 inline-flex translate-y-px cursor-help align-middle">
      <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full border border-[#444] text-[9px] font-bold leading-none text-[#666]">
        i
      </span>
      <span
        role="tooltip"
        className={`pointer-events-none absolute ${vClass} ${anchorClass} z-20 w-64 max-w-[calc(100vw-2rem)] rounded-lg border border-[#2e2e2e] bg-[#111] px-3 py-2 text-left text-[12px] font-normal normal-case leading-snug tracking-normal text-[#aaa] opacity-0 shadow-2xl transition-opacity duration-150 group-hover/tip:opacity-100`}
      >
        {text}
      </span>
    </span>
  );
}

// ── Stat card ────────────────────────────────────────────────────────────────
function Stat({
  label: labelText,
  value,
  tip,
  tone = "text-white",
}: {
  label: string;
  value: number;
  tip: string;
  tone?: string;
}) {
  return (
    <div className={`${card} px-4 py-4`}>
      <div className={`text-[28px] font-semibold tabular-nums leading-none ${tone}`}>
        {value.toLocaleString()}
      </div>
      <div className={`mt-2 flex items-center ${label}`}>
        {labelText}
        <InfoTip text={tip} />
      </div>
    </div>
  );
}

// ── Table header cell ────────────────────────────────────────────────────────
function Th({
  children,
  tip,
  align = "right",
}: {
  children: ReactNode;
  tip: string;
  align?: "left" | "right";
}) {
  return (
    <th
      className={`whitespace-nowrap py-2.5 ${
        align === "left" ? "pl-5 pr-6 text-left" : "px-4 text-right"
      } ${label}`}
    >
      <span className="inline-flex items-center gap-0.5">
        {children}
        <InfoTip text={tip} anchor={align === "left" ? "left" : "right"} below />
      </span>
    </th>
  );
}

// ── Device row (with usage bar) ──────────────────────────────────────────────
const DEVICE_META: Record<string, { label: string; icon: string }> = {
  mobile: { label: "Mobile", icon: "▪" },
  tablet: { label: "Tablet", icon: "▭" },
  desktop: { label: "Desktop", icon: "▭▭" },
};

function DeviceRow({ bucket }: { bucket: DeviceBucket }) {
  const meta = DEVICE_META[bucket.category] ?? { label: bucket.category, icon: "▫" };
  return (
    <div className={`flex items-center gap-3 px-4 py-3 sm:px-5 ${divider} first:border-t-0`}>
      <span className="w-16 shrink-0 text-[13px] font-medium capitalize text-white sm:w-20">
        {meta.label}
      </span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#1a1a1a]">
        <div
          className="h-full rounded-full bg-blue-500"
          style={{ width: `${Math.max(bucket.pct, 1.5)}%` }}
        />
      </div>
      <span className="w-10 shrink-0 text-right text-[13px] font-semibold tabular-nums text-white sm:w-12">
        {bucket.pct}%
      </span>
      <span className="hidden w-28 shrink-0 text-right text-[12px] tabular-nums text-[#666] sm:block">
        {bucket.sessions} {bucket.sessions === 1 ? "session" : "sessions"}
      </span>
      <span className="hidden w-20 shrink-0 text-right text-[12px] tabular-nums text-[#555] sm:block">
        {bucket.avgWidth === null ? "—" : `~${bucket.avgWidth}px`}
      </span>
    </div>
  );
}

// ── Section wrapper ──────────────────────────────────────────────────────────
function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-8">
      <div className={`mb-3 flex items-center gap-2 ${label}`}>{title}</div>
      {children}
    </section>
  );
}

// ── Monitored components helpers ─────────────────────────────────────────────
function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function MonitoredRow({ m }: { m: MonitoredComponent }) {
  const hasIssues = m.rageClicks > 0 || m.deadClicks > 0;
  return (
    <tr className={`${divider} first:border-t-0 align-top`}>
      <td className="py-2.5 pl-5 pr-4 min-w-[160px]">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[13px] font-medium text-white">{m.name}</span>
          <span className="rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider bg-purple-950 text-purple-400">
            monitored
          </span>
          {hasIssues && (
            <span className="rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider bg-red-950 text-red-400">
              issues
            </span>
          )}
        </div>
        <div className="mt-0.5 text-[11px] text-[#555]">
          {m.sessions} {m.sessions === 1 ? "session" : "sessions"} · {m.pages}{" "}
          {m.pages === 1 ? "page" : "pages"}
        </div>
      </td>
      <td className="py-2.5 px-4 text-right text-[13px] tabular-nums text-[#888]">
        {m.mounts > 0 ? m.mounts : <span className="text-[#444]">—</span>}
      </td>
      <td className="py-2.5 px-4 text-right text-[13px] font-semibold tabular-nums text-white">
        {m.componentViews > 0 ? m.componentViews : <span className="font-normal text-[#444]">—</span>}
      </td>
      <td className="py-2.5 px-4 text-right text-[13px] tabular-nums text-[#888]">
        {m.avgViewMs !== null ? fmtMs(m.avgViewMs) : <span className="text-[#444]">—</span>}
      </td>
      <td className="py-2.5 px-4 text-right text-[13px] tabular-nums text-[#888]">
        {m.avgScrollDepth !== null ? `${m.avgScrollDepth}%` : <span className="text-[#444]">—</span>}
      </td>
      <td className="py-2.5 px-4 text-right text-[13px] tabular-nums text-[#555]">
        {m.heightPx !== null ? `${m.heightPx}px` : <span className="text-[#444]">—</span>}
      </td>
      <td className="py-2.5 px-4 text-right text-[13px] tabular-nums text-[#888]">{m.clicks > 0 ? m.clicks : <span className="text-[#444]">—</span>}</td>
      <td className="py-2.5 px-4 text-right text-[13px] tabular-nums">
        {m.hovers > 0 ? <span className="text-[#888]">{m.hovers}</span> : <span className="text-[#444]">—</span>}
      </td>
      <td className="py-2.5 pl-4 pr-5 text-right text-[13px] tabular-nums">
        {m.rageClicks > 0 ? <span className="text-red-400">{m.rageClicks}</span> : <span className="text-[#444]">—</span>}
      </td>
    </tr>
  );
}

// ── Data loading ─────────────────────────────────────────────────────────────
export interface BuffdDashboardData {
  overview: Awaited<ReturnType<typeof getOverview>>;
  pages: Awaited<ReturnType<typeof getTopPages>>;
  elements: Awaited<ReturnType<typeof getElementStats>>;
  devices: Awaited<ReturnType<typeof getDeviceBreakdown>>;
  topUsed: Awaited<ReturnType<typeof getTopInteractions>>;
  journeys: Awaited<ReturnType<typeof getSessionJourneys>>;
  errors: Awaited<ReturnType<typeof getRecentErrors>>;
  monitored: Awaited<ReturnType<typeof getMonitoredComponents>>;
}

/** Fetch every dashboard query in parallel. Server-only. */
export async function loadBuffdDashboardData(): Promise<BuffdDashboardData> {
  const [overview, pages, elements, devices, topUsed, journeys, errors, monitored] =
    await Promise.all([
      getOverview(),
      getTopPages(8),
      getElementStats(12),
      getDeviceBreakdown(),
      getTopInteractions(12),
      getSessionJourneys(6),
      getRecentErrors(8),
      getMonitoredComponents(),
    ]);
  return { overview, pages, elements, devices, topUsed, journeys, errors, monitored };
}

// ── Dashboard (presentational) ───────────────────────────────────────────────
export function BuffdDashboard({ data }: { data: BuffdDashboardData }) {
  const { overview, pages, elements, devices, topUsed, journeys, errors, monitored } = data;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10 text-white">
      {/* Header */}
      <div className={`mb-8 flex items-start justify-between gap-3 border-b ${border} pb-6`}>
        <div>
          <p className={label}>Buffd</p>
          <h1 className="mt-1 text-[22px] font-semibold tracking-tight text-white">
            What gets measured gets improved
          </h1>
          <p className="mt-1 text-[13px] text-[#666]">
            Stage 1 — Capture. Hover{" "}
            <span className="inline-flex h-3 w-3 items-center justify-center rounded-full border border-[#444] text-[8px] font-bold text-[#666]">
              i
            </span>{" "}
            for calculation details.
          </p>
        </div>
        <div className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-medium ${
          overview.ready
            ? "bg-emerald-950 text-emerald-400"
            : "bg-[#1a1a1a] text-[#666]"
        }`}>
          {overview.ready ? "● collecting" : "○ no store"}
        </div>
      </div>

      {!overview.ready && (
        <div className={`mb-8 rounded-lg border border-amber-900/50 bg-amber-950/30 px-4 py-3 text-[13px] text-amber-400`}>
          The analytics store isn't writable in this environment. Run locally or configure a
          database — see the <span className="font-mono text-amber-300">@buffd/next</span> DATABASE.md guide.
        </div>
      )}

      {/* Stats */}
      <Section title="Overview">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat
            label="Sessions"
            value={overview.sessions}
            tip="Distinct anonymous visitors, counted by the buffd_session cookie. One cookie = one session; no fingerprinting."
          />
          <Stat
            label="Page views"
            value={overview.pageViews}
            tip="page_view events — initial page loads plus client-side (soft) navigations between routes."
          />
          <Stat
            label="Rage clicks"
            value={overview.rageClicks}
            tone="text-red-500"
            tip="3+ clicks on the same element within 500ms. A strong signal of frustration — something looks clickable or is broken."
          />
          <Stat
            label="Dead clicks"
            value={overview.deadClicks}
            tone="text-[#f5a623]"
            tip="Clicks on non-interactive elements (no link, button, or role within 4 ancestors). Users expected something to happen but nothing did."
          />
          <Stat
            label="JS errors"
            value={overview.jsErrors}
            tone="text-red-500"
            tip="Uncaught exceptions and unhandled promise rejections, with page and component context."
          />
          <Stat
            label="Events"
            value={overview.totalEvents}
            tip="Total raw signals captured across all event types."
          />
        </div>
      </Section>

      {/* Device sizes */}
      <Section
        title={
          <>
            Device sizes
            <InfoTip
              anchor="left"
              text="One viewport sample per session, taken at session start, bucketed by CSS width: mobile (<640px), tablet (640–1023px), desktop (≥1024px). Shows what screen size visitors actually use."
            />
          </>
        }
      >
        <div className={card}>
          {devices.length === 0 ? (
            <p className="px-5 py-8 text-center text-[13px] text-[#555]">
              No viewport data yet — browse the site then refresh.
            </p>
          ) : (
            devices.map((d) => <DeviceRow key={d.category} bucket={d} />)
          )}
        </div>
      </Section>

      {/* Top pages */}
      <Section
        title={
          <>
            Top pages
            <InfoTip
              anchor="left"
              text="The most-visited routes, ranked by distinct sessions. Click a page to open a chart of its sessions over time."
            />
          </>
        }
      >
        <TopPagesTable pages={pages} />
      </Section>

      {/* Monitored components */}
      <Section
        title={
          <>
            Monitored components
            <InfoTip
              anchor="left"
              text="Components explicitly wrapped in <BuffdMonitor>. Shows viewport engagement (views, avg time visible, scroll depth, dimensions) alongside click activity. A high view count with low clicks often signals interest without commitment."
            />
          </>
        }
      >
        <div className={card}>
          {monitored.length === 0 ? (
            <p className="px-5 py-8 text-center text-[13px] text-[#555]">
              No monitored components yet — wrap elements with{" "}
              <code className="font-mono text-[#777]">{"<BuffdMonitor name=\"…\">"}</code> to track them here.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px]">
                <thead>
                  <tr>
                    <Th align="left" tip="The name prop passed to <BuffdMonitor>. Sessions and pages shown beneath.">Component</Th>
                    <Th tip="Times this region rendered (mount events). Only content-tracked monitors emit these.">Mounts</Th>
                    <Th tip="Times this component entered the viewport for ≥500ms.">Views</Th>
                    <Th tip="Average time visible per viewport visit — a proxy for reading/engagement time.">Avg time</Th>
                    <Th tip="Average % of the component's height scrolled through per visit. 100% = user reached the bottom.">Scroll depth</Th>
                    <Th tip="Largest rendered height in px seen for this component — for an article, its full content height.">Height</Th>
                    <Th tip="Normal (non-rage, non-dead) clicks.">Clicks</Th>
                    <Th tip="Deliberate pointer hovers (≥200ms dwell).">Hovers</Th>
                    <Th tip="Rage clicks (3+ rapid clicks) — frustration signal.">Rage</Th>
                  </tr>
                </thead>
                <tbody>
                  {monitored.map((m) => (
                    <MonitoredRow key={m.name} m={m} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Section>

      {/* Session journeys */}
      <Section
        title={
          <>
            Sampled user journeys
            <InfoTip
              anchor="left"
              text="Full sessions sampled and ranked by a composite score (rage×3 + dead×2 + errors×2.5), preferring complete recordings and recent ones. Click a session to open its start-to-finish flow chart."
            />
          </>
        }
      >
        <JourneyList journeys={journeys} />
      </Section>

      {/* Most-used features */}
      <Section
        title={
          <>
            Most-used features
            <InfoTip
              anchor="left"
              text="Interactive elements ranked by raw click volume (successful clicks only — rage and dead clicks excluded). The buttons and features visitors actually use most."
            />
          </>
        }
      >
        <div className={card}>
          {topUsed.length === 0 ? (
            <p className="px-5 py-8 text-center text-[13px] text-[#555]">
              No clicks captured yet — browse the site then refresh.
            </p>
          ) : (
            <TopFeaturesTable
              features={topUsed}
              header={
                <tr>
                  <Th align="left" tip="Component name (from data-component) or DOM selector. Sample text and selector shown beneath.">Element</Th>
                  <Th tip="Total successful (interactive) clicks across all pages.">Clicks</Th>
                  <Th tip="Distinct sessions that clicked this element.">Sessions</Th>
                  <Th tip="How many distinct pages this element was clicked on.">Pages</Th>
                </tr>
              }
            />
          )}
        </div>
      </Section>

      {/* Element breakdown */}
      <Section
        title={
          <>
            Interactions by element
            <InfoTip
              anchor="left"
              text="Click-type events grouped by DOM selector. This is which UI element the issues are on — the primary input to Stage 2 synthesis. Components wrapped in <BuffdMonitor> are listed separately under Monitored components."
            />
          </>
        }
      >
        <div className={card}>
          {elements.length === 0 ? (
            <p className="px-5 py-8 text-center text-[13px] text-[#555]">
              No interactions captured yet — browse the site then refresh.
            </p>
          ) : (
            <ElementsTable
              elements={elements}
              header={
                <tr>
                  <Th align="left" tip="DOM selector path for the interacted element. Sample text shown beneath.">Element</Th>
                  <Th tip="rage×3 + dead×2 for this element across all pages.">Score</Th>
                  <Th tip="Normal (non-rage, non-dead) clicks.">Clicks</Th>
                  <Th tip="Rage clicks on this element.">Rage</Th>
                  <Th tip="Dead clicks on this element.">Dead</Th>
                  <Th tip="How many distinct pages this element appeared on.">Pages</Th>
                </tr>
              }
            />
          )}
        </div>
      </Section>

      {/* Recent errors */}
      {errors.length > 0 && (
        <Section title="Recent errors">
          <div className={card}>
            {errors.map((e, i) => (
              <div key={i} className={i > 0 ? divider : ""}>
                <div className="px-5 py-3">
                  <div className="font-mono text-[13px] text-red-400">{e.message}</div>
                  <div className="mt-0.5 text-[11px] text-[#555]">
                    {e.path}
                    {e.component ? ` · ${e.component}` : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </main>
  );
}

// ── Built-in fallback for a failed auth check ────────────────────────────────
function Unauthorized() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-6 text-center text-white">
      <p className={label}>Buffd</p>
      <h1 className="mt-2 text-[20px] font-semibold tracking-tight">Unauthorized</h1>
      <p className="mt-2 text-[13px] text-[#666]">
        This dashboard is protected. Pass an <code className="font-mono">unauthorized</code> element to
        <code className="font-mono"> createBuffdPage()</code> to render your own sign-in UI here.
      </p>
    </main>
  );
}

export interface CreateBuffdPageOptions {
  /**
   * Gate access to the dashboard. Return `true` to allow. If omitted the
   * dashboard renders unguarded (a dev-only console warning is logged).
   */
  authenticate?: () => boolean | Promise<boolean>;
  /** Rendered when `authenticate` resolves false. Defaults to a minimal screen. */
  unauthorized?: ReactNode;
}

let warnedUnguarded = false;

/**
 * Build the dashboard page component. Use as the default export of your
 * `app/buffd/page.tsx`.
 */
export function createBuffdPage(opts: CreateBuffdPageOptions = {}) {
  return async function BuffdPage() {
    if (opts.authenticate) {
      const ok = await opts.authenticate();
      if (!ok) return <>{opts.unauthorized ?? <Unauthorized />}</>;
    } else if (!warnedUnguarded && process.env.NODE_ENV !== "production") {
      warnedUnguarded = true;
      console.warn(
        "[buffd] dashboard is unguarded — pass `authenticate` to createBuffdPage() to protect it.",
      );
    }

    const data = await loadBuffdDashboardData();
    return <BuffdDashboard data={data} />;
  };
}
