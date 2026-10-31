/**
 * @polishd/next/dashboard — the Polishd dashboard.
 *
 *   // src/app/polishd/page.tsx
 *   import { createPolishdPage } from "@polishd/next/dashboard";
 *   export { runtime, dynamic, metadata } from "@polishd/next/dashboard";
 *   export default createPolishdPage();            // unguarded
 *
 * Protect it by passing an `authenticate` callback (and optionally your own
 * login UI via `unauthorized`):
 *
 *   export default createPolishdPage({
 *     authenticate: isAuthenticated,
 *     unauthorized: <MyLogin />,
 *   });
 */
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { after } from "next/server";
import { Suspense, type ReactNode } from "react";

import Link from "next/link";

import { registerPolishdDashboardRoute, type PolishdConfig } from "../config";
import {
  ANALYTICS_WINDOWS,
  parseAnalyticsRange,
  rangeBuild,
  rangeLabel,
  type AnalyticsRange,
} from "../shared/analytics-range";
import { shortBuild } from "../shared/build";
import { captureStatus, type CaptureHealth } from "../shared/capture-status";

import {
  getTelemetryInstalls,
  getTelemetryTopPaths,
  hasTelemetryInstalls,
  type BuildStat,
  type PolishdDashboardData,
  type DeviceBucket,
  type ElementStat,
  type MonitoredComponent,
  type OverviewStats,
  type TopInteraction,
} from "../server/queries";
import {
  loadBuilds,
  loadCurrentBuild,
  loadDashboardData,
  loadDevices,
  loadElements,
  loadHealth,
  loadJourneys,
  loadMonitored,
  loadOverview,
  loadPages,
  loadTopUsed,
  loadTrends,
} from "./data";
import RangePicker, { type RangeOption } from "./range-picker";
import {
  polishdAuthContext,
  registerPolishdAuth,
  type PolishdAuthenticate,
  type PolishdAuthPolicy,
} from "../ai/guard";
import {
  polishdDashboardToken,
  polishdTokenAuth,
  type PolishdTokenAuthOptions,
} from "./token-auth";
import { unlockPolishdDashboard } from "./unlock";
import { loadPolishdTelemetryState } from "../server/telemetry";
import { PolishdTelemetryConsent, PolishdTelemetryEmitter } from "./telemetry";
import { loadDesignReview, loadDesignReviewState } from "../ai/design";
import { loadOverviewState } from "../ai/overview";
import { checkDispatchReadiness, loadDispatchState } from "../ai/dispatch";
import { fixTriggerOf, isDispatchReady } from "../ai/dispatch-readiness";
import { listFixRuns, loadIssueThreads } from "../ai/fix-dispatch";
import { listFixSuggestions } from "../ai/fix";
import { listFiledIssues } from "../ai/issues";
import { loadProfileState } from "../ai/profile";
import { generateSummary, getAISettingsPublic, loadSummary, loadSummaryState } from "../ai/summary";
import { getDesignData } from "../server/design";
import { resolveSiteOrigin } from "../server/site-origin";
import { listSnapshots, snapshotAvailability } from "../server/snapshots";
import { buildBrandKit } from "../shared/brand-kit";
import type {
  PolishdAISettingsPublic,
  PolishdProjectProfile,
  PolishdSummary,
} from "../ai/types";
import DashboardChrome, { TabSkeleton, type PolishdDashboardTab } from "./chrome";
import { POLISHD_THEME_COOKIE, themeFrom, type PolishdTheme } from "./theme";
import ActionablesView from "./actionables";
import { DesignPanel } from "./design";
import InstallsView from "./installs";
import OverviewPanel from "./overview";
import ElementsTable from "./elements";
import TopFeaturesTable from "./features";
import JourneyList from "./journeys";
import TopPagesTable from "./pages";
import SettingsView from "./settings";
import ShowMore from "./show-more";
import SummaryCard from "./summary";
import OverviewStatTiles from "./metric-trends";
import {
  Badge,
  BrandWordmark,
  Callout,
  Code,
  EmptyState,
  InfoIcon,
  InfoTip,
  LockIcon,
  PageHeader,
  Section,
  StatusPill,
  card,
  divider,
  inputCls,
  labelCls as label,
  primaryBtn,
  relTime,
} from "./ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Polishd — What gets measured gets improved",
  robots: { index: false, follow: false },
};

/** A share of traffic, kept readable when it rounds to nothing. */
function formatShare(pct: number): string {
  if (pct >= 10) return `${Math.round(pct)}%`;
  if (pct >= 1) return `${pct.toFixed(1)}%`;
  return "<1%";
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
      className={`whitespace-nowrap border-b border-line bg-sunken py-2.5 ${
        align === "left" ? "pl-5 pr-6 text-left" : "px-4 text-right"
      } ${label}`}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        <InfoTip text={tip} anchor={align === "left" ? "left" : "right"} below />
      </span>
    </th>
  );
}

// ── Device row (with usage bar) ──────────────────────────────────────────────
const DEVICE_LABEL: Record<string, string> = {
  mobile: "Mobile",
  tablet: "Tablet",
  desktop: "Desktop",
};

function DeviceRow({ bucket }: { bucket: DeviceBucket }) {
  const name = DEVICE_LABEL[bucket.category] ?? bucket.category;
  return (
    <div className={`flex items-center gap-4 px-4 py-3.5 sm:px-5 ${divider} first:border-t-0`}>
      <span className="w-16 shrink-0 text-[13px] font-medium capitalize text-fg sm:w-20">
        {name}
      </span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-raised">
        <div
          className="h-full rounded-full bg-accent"
          style={{ width: `${Math.max(bucket.pct, 1.5)}%` }}
        />
      </div>
      <span className="w-12 shrink-0 text-right text-[13px] font-semibold tabular-nums text-fg">
        {bucket.pct}%
      </span>
      <span className="hidden w-28 shrink-0 text-right text-[12px] tabular-nums text-fg-3 sm:block">
        {bucket.sessions} {bucket.sessions === 1 ? "session" : "sessions"}
      </span>
      <span className="hidden w-20 shrink-0 text-right font-mono text-[11.5px] tabular-nums text-fg-3 sm:block">
        {bucket.avgWidth === null ? "—" : `~${bucket.avgWidth}px`}
      </span>
    </div>
  );
}

// ── Monitored components helpers ─────────────────────────────────────────────
function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** An empty measurement: drawn quiet so the numbers around it stand out. */
const none = <span className="text-fg-3">—</span>;

function MonitoredRow({ m }: { m: MonitoredComponent }) {
  const num = "py-3 px-4 text-right text-[13px] tabular-nums text-fg-2";
  return (
    <tr className={`${divider} align-top transition-colors first:border-t-0 hover:bg-raised/50`}>
      <td className="min-w-[280px] py-3 pl-5 pr-4">
        <div className="text-[13px] font-medium text-fg">{m.name}</div>
        <div className="mt-0.5 text-[12px] text-fg-3">
          {m.sessions} {m.sessions === 1 ? "session" : "sessions"} · {m.pages}{" "}
          {m.pages === 1 ? "page" : "pages"}
        </div>
      </td>
      <td className={num}>{m.mounts > 0 ? m.mounts : none}</td>
      <td className={`${num} font-semibold text-fg`}>
        {m.componentViews > 0 ? m.componentViews : none}
      </td>
      <td className={num}>{m.avgViewMs !== null ? fmtMs(m.avgViewMs) : none}</td>
      <td className={num}>{m.avgScrollDepth !== null ? `${m.avgScrollDepth}%` : none}</td>
      <td className={`${num} font-mono text-[12px] text-fg-3`}>
        {m.heightPx !== null ? `${m.heightPx}px` : none}
      </td>
      <td className={num}>{m.clicks > 0 ? m.clicks : none}</td>
      <td className={num}>{m.hovers > 0 ? m.hovers : none}</td>
      <td className="py-3 pl-4 pr-5 text-right text-[13px] font-medium tabular-nums">
        {m.rageClicks > 0 ? <span className="text-bad">{m.rageClicks}</span> : none}
      </td>
    </tr>
  );
}

// ── Data loading ─────────────────────────────────────────────────────────────
// `loadPolishdDashboardData` + `PolishdDashboardData` now live in server/queries so
// the AI summary layer can share them without importing React; re-export for
// any existing callers of this module.
export { loadPolishdDashboardData, type PolishdDashboardData } from "../server/queries";

// Named explicitly by hosts that want token auth alongside their own options;
// `createPolishdPage()` already applies it when POLISHD_DASHBOARD_TOKEN is set.
export {
  polishdTokenAuth,
  POLISHD_DASHBOARD_COOKIE,
  type PolishdTokenAuthOptions,
} from "./token-auth";

/** The AI summary card's server-loaded inputs. */
export interface PolishdAIBundle {
  summary: PolishdSummary | null;
  settings: PolishdAISettingsPublic;
  stale: boolean;
  profile: PolishdProjectProfile | null;
  /** Analytics component identifiers the profile doesn't cover. */
  gaps: string[];
  /** Whether the source tree is on disk here. A scan can also read the connected repo. */
  sourceAvailable: boolean;
}

// The tab rail (and the client-side navigation between tabs) lives in
// ./chrome; re-exported here because this is the module hosts import.
export type { PolishdDashboardTab } from "./chrome";

// ── Analytics: header + status (shared by batch and streamed renders) ────────
function AnalyticsHeader({ pill, range }: { pill: ReactNode; range: ReactNode }) {
  return (
    <PageHeader
      title="Analytics"
      description={
        <>
          Stage 1 — Capture. Hover{" "}
          <span className="inline-flex translate-y-[2px] text-fg-3">
            <InfoIcon size={13} />
          </span>{" "}
          for calculation details.
        </>
      }
      actions={
        <>
          {range}
          {pill}
        </>
      }
    />
  );
}

// ── Analytics: the range ─────────────────────────────────────────────────────
// Every section of the tab is scoped to one range, carried in the URL. The
// control is a row of pills (range-picker.tsx); the data behind "this build"
// — whether there is one, and what it's called — streams in behind it.

/** The pills every store has: the fixed windows and all time. */
const WINDOW_OPTIONS: RangeOption[] = [
  ...ANALYTICS_WINDOWS.map((w) => ({
    id: w.id,
    label: w.label,
    title: `Events received in the last ${w.label}`,
  })),
  { id: "all", label: "All time" },
];

/**
 * The pills for a given store: the windows, plus "This build" once a build is
 * known, plus the one build a Builds-table row named, so the selected range
 * is always among the pills. The static set is the picker's fallback while
 * the build loads.
 */
function rangeOptions(active: AnalyticsRange, current: BuildStat | null): RangeOption[] {
  const options = [...WINDOW_OPTIONS];
  if (current) {
    options.push({
      id: "build",
      label: "This build",
      title: `Build ${current.build}, shipping since ${new Date(current.firstSeen).toLocaleString()}`,
    });
  }
  const named = rangeBuild(active);
  if (named && named !== current?.build) {
    options.push({ id: active, label: `Build ${shortBuild(named)}`, title: `Build ${named}` });
  }
  return options;
}

async function RangePickerData({ range }: { range: AnalyticsRange }) {
  const current = await loadCurrentBuild();
  return <RangePicker active={range} options={rangeOptions(range, current)} />;
}

function RangeControl({ range }: { range: AnalyticsRange }) {
  return (
    <Suspense fallback={<RangePicker active={range} options={rangeOptions(range, null)} />}>
      <RangePickerData range={range} />
    </Suspense>
  );
}

/**
 * The range in prose for the tiles' footnote, with "this build" named once
 * the build is known: "all time", "the last 7 days", "build f804613".
 */
async function scopeLabel(range: AnalyticsRange): Promise<string> {
  const named = rangeBuild(range);
  if (named) return rangeLabel(range, shortBuild(named));
  if (range === "build") {
    const current = await loadCurrentBuild();
    return rangeLabel(range, current ? shortBuild(current.build) : null);
  }
  return rangeLabel(range);
}

/** "Totals for the last 7 days." — a range label as the start of a sentence. */
function sentence(text: string): string {
  return text[0].toUpperCase() + text.slice(1);
}

function CaptureStatusPill({ ready }: { ready: boolean }) {
  return ready ? (
    <StatusPill tone="ok" live>
      Collecting
    </StatusPill>
  ) : (
    <StatusPill tone="neutral">No store</StatusPill>
  );
}

function StatusBanners({
  overview,
  health,
}: {
  overview: OverviewStats;
  health: CaptureHealth;
}) {
  // Events arriving without a session cookie mean the proxy didn't run on
  // those requests — or that something posted straight at the public endpoint.
  // Telling those apart is the whole job of `captureStatus`, which lives in
  // shared/capture-status.ts with the record ingest writes, and is tested.
  const capture = captureStatus(health, overview.totalEvents);
  const windowLabel = `${Math.round(health.windowMs / 3_600_000)}h`;

  return (
    <>
      {!overview.ready && (
        <Callout tone="warn" className="mb-8">
          The analytics store isn&apos;t writable in this environment. Run locally or configure a
          database — see the <Code>@polishd/next</Code> DATABASE.md guide.
        </Callout>
      )}

      {capture.level === "broken" && (
        <Callout
          tone="bad"
          className="mb-8"
          title="Receiving events, but no session cookie — your proxy isn't running."
        >
          <p>
            {capture.droppedBatches.toLocaleString()}{" "}
            {capture.droppedBatches === 1 ? "batch has" : "batches have"} been dropped
            {capture.nothingStored ? "" : ` and nothing has been stored in the last ${windowLabel}`}
            . Polishd attributes every event to the anonymous cookie the proxy mints
            {capture.nothingStored ? ", so nothing is being stored" : ""}. Check that you have a{" "}
            <Code>proxy.ts</Code> (Next 16+) or <Code>middleware.ts</Code> (Next 15) at your project
            root — matching your installed Next major — exporting a function of the same name, with{" "}
            <Code>config.matcher</Code> written as an inline literal that covers the pages you&apos;re
            capturing.
          </p>
          <p className="mt-2 text-fg-3">
            Run <Code>npx @polishd/next doctor --url &lt;your deployed origin&gt;</Code> to check
            this against the running site. Plain <Code>doctor</Code> only reads your source tree, so
            it can pass every check while the deployed build still doesn&apos;t mint a cookie —{" "}
            <Code>--url</Code> is the part that proves it.
          </p>
        </Callout>
      )}

      {capture.level === "notice" && (
        <Callout tone="neutral" className="mb-8">
          {capture.droppedBatches.toLocaleString()}{" "}
          {capture.droppedBatches === 1 ? "batch" : "batches"} arrived without a session cookie in
          the last {windowLabel}
          {capture.sharePct !== null && ` — ${formatShare(capture.sharePct)} of traffic`} (bots, or
          visitors with cookies blocked). Those events aren&apos;t stored; capture itself is working
          {capture.storedSinceDrop ? " — a batch has been stored since the most recent drop" : ""}.
        </Callout>
      )}
    </>
  );
}

// ── Analytics: section shells ────────────────────────────────────────────────
// The titles render before their data arrives, so each shell takes the card
// as children — the batch render passes it resolved, the streamed render
// passes a Suspense boundary.
function OverviewSection({ range, children }: { range: AnalyticsRange; children: ReactNode }) {
  return (
    <Section
      title="Overview"
      tip={`Totals for ${rangeLabel(range)}, for everything captured. Click any tile to open that metric as a chart over time, bucketed by hour or by day.`}
    >
      {children}
    </Section>
  );
}

function DevicesSection({ children }: { children: ReactNode }) {
  return (
    <Section
      title="Device sizes"
      tip="One viewport sample per session, taken at session start, bucketed by CSS width: mobile (<640px), tablet (640–1023px), desktop (≥1024px). Shows what screen size visitors actually use."
    >
      {children}
    </Section>
  );
}

function PagesSection({ children }: { children: ReactNode }) {
  return (
    <Section
      title="Top pages"
      tip="The most-visited routes, ranked by distinct sessions. Click a page to open a chart of its sessions over time."
    >
      {children}
    </Section>
  );
}

function DevicesCard({ devices }: { devices: DeviceBucket[] }) {
  return (
    <div className={`${card} overflow-hidden`}>
      {devices.length === 0 ? (
        <EmptyState>No viewport data yet — browse the site then refresh.</EmptyState>
      ) : (
        devices.map((d) => <DeviceRow key={d.category} bucket={d} />)
      )}
    </div>
  );
}

function MonitoredSection({ children }: { children: ReactNode }) {
  return (
    <Section
      title="Monitored components"
      tip="Components explicitly wrapped in <PolishdMonitor>. Shows viewport engagement (views, avg time visible, scroll depth, dimensions) alongside click activity. A high view count with low clicks often signals interest without commitment."
    >
      {children}
    </Section>
  );
}

function MonitoredCard({ monitored }: { monitored: MonitoredComponent[] }) {
  return (
    <div className={`${card} overflow-hidden`}>
      {monitored.length === 0 ? (
        <EmptyState>
          No monitored components yet — wrap elements with{" "}
          <Code>{"<PolishdMonitor name=\"…\">"}</Code> to track them here.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px]">
            <thead>
              <tr>
                <Th align="left" tip="The name prop passed to <PolishdMonitor>. Sessions and pages shown beneath.">Component</Th>
                <Th tip="Times this region rendered (mount events). Only content-tracked monitors emit these.">Mounts</Th>
                <Th tip="Times this component entered the viewport for ≥500ms.">Views</Th>
                <Th tip="Average time visible per viewport visit — a proxy for reading/engagement time.">Avg time</Th>
                <Th tip="Average % of the component's height scrolled through per visit. 100% = user reached the bottom. Only measured for components taller than one screen — shorter ones show no value.">Scroll depth</Th>
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
  );
}

function JourneysSection({ children }: { children: ReactNode }) {
  return (
    <Section
      title="Sampled user journeys"
      tip="Full sessions sampled and ranked by a composite score (rage×3 + dead×2), preferring complete recordings and recent ones. Click a session to open its start-to-finish flow chart."
    >
      {children}
    </Section>
  );
}

function FeaturesSection({ children }: { children: ReactNode }) {
  return (
    <Section
      title="Most-used features"
      tip="Interactive elements ranked by raw click volume (successful clicks only — rage and dead clicks excluded). The buttons and features visitors actually use most."
    >
      {children}
    </Section>
  );
}

function FeaturesCard({ topUsed }: { topUsed: TopInteraction[] }) {
  return (
    <div className={`${card} overflow-hidden`}>
      {topUsed.length === 0 ? (
        <EmptyState>No clicks captured yet — browse the site then refresh.</EmptyState>
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
  );
}

function ElementsSection({ children }: { children: ReactNode }) {
  return (
    <Section
      title="Interactions by element"
      tip="Click-type events grouped by DOM selector. This is which UI element the issues are on — the primary input to Stage 2 synthesis. Components wrapped in <PolishdMonitor> are listed separately under Monitored components."
    >
      {children}
    </Section>
  );
}

function ElementsCard({ elements }: { elements: ElementStat[] }) {
  return (
    <div className={`${card} overflow-hidden`}>
      {elements.length === 0 ? (
        <EmptyState>No interactions captured yet — browse the site then refresh.</EmptyState>
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
  );
}

// ── Builds ───────────────────────────────────────────────────────────────────
// Every event names the build it was captured on, so the tab can say what
// each deploy did: how many sessions it served, and how much friction they
// hit. A row is a link that scopes the whole tab to that build.

function BuildsSection({ children }: { children: ReactNode }) {
  return (
    <Section
      title="Builds"
      tip="Every build events have been captured on, newest first — a build is new the first time it is seen, so a tab left open across a deploy can't revive the old one. Click a build to scope the tab to it. The build is stamped by the client bundle when it knows its own (NEXT_PUBLIC_POLISHD_BUILD, or Vercel's commit variable), else by the server."
    >
      {children}
    </Section>
  );
}

function BuildRow({
  b,
  current,
  active,
}: {
  b: BuildStat;
  /** The build currently shipping. */
  current: boolean;
  /** Whether the tab is already scoped to this build. */
  active: boolean;
}) {
  const num = "py-3 px-4 text-right text-[13px] tabular-nums text-fg-2";
  const none = <span className="text-fg-3">—</span>;
  return (
    <tr
      className={`${divider} transition-colors first:border-t-0 ${
        active ? "bg-raised/60" : "hover:bg-raised/50"
      }`}
    >
      <td className="min-w-[220px] py-3 pl-5 pr-4">
        <Link
          href={`?tab=analytics&range=${encodeURIComponent(`build:${b.build}`)}`}
          prefetch={false}
          title={active ? b.build : `Scope the tab to build ${b.build}`}
          aria-current={active ? "page" : undefined}
          className="inline-flex flex-wrap items-center gap-2 font-mono text-[12.5px] text-fg hover:text-accent"
        >
          {shortBuild(b.build)}
          {current && <Badge tone="accent">current</Badge>}
        </Link>
        <div className="mt-0.5 text-[12px] text-fg-3">
          first seen {relTime(b.firstSeen)}
          {b.lastSeen - b.firstSeen > 60_000 && <> · last {relTime(b.lastSeen)}</>}
        </div>
      </td>
      <td className={`${num} font-semibold text-fg`}>{b.sessions.toLocaleString()}</td>
      <td className={num}>{b.pageViews.toLocaleString()}</td>
      <td className={num}>
        {b.rageClicks > 0 ? <span className="text-bad">{b.rageClicks.toLocaleString()}</span> : none}
      </td>
      <td className="py-3 pl-4 pr-5 text-right text-[13px] tabular-nums text-fg-2">
        {b.deadClicks > 0 ? <span className="text-warn">{b.deadClicks.toLocaleString()}</span> : none}
      </td>
    </tr>
  );
}

/** Builds shown before the rest collapse behind "Show more". */
const BUILDS_VISIBLE = 5;

function BuildsCard({
  builds,
  current,
  range,
}: {
  builds: BuildStat[];
  current: BuildStat | null;
  range: AnalyticsRange;
}) {
  const activeBuild = rangeBuild(range) ?? (range === "build" ? current?.build ?? null : null);
  const visible = builds.slice(0, BUILDS_VISIBLE);
  const overflow = builds.slice(BUILDS_VISIBLE);
  const row = (b: BuildStat) => (
    <BuildRow
      key={b.build}
      b={b}
      current={b.build === current?.build}
      active={b.build === activeBuild}
    />
  );
  return (
    <div className={`${card} overflow-hidden`}>
      {builds.length === 0 ? (
        <EmptyState>
          No build has been recorded yet. Events are stamped with the build they were captured on
          once the bundle knows its own — set <Code>NEXT_PUBLIC_POLISHD_BUILD</Code> at build time
          (Vercel&apos;s <Code>NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA</Code> is read too) or pass{" "}
          <Code>build</Code> to <Code>initPolishd()</Code>; the server stamps its own commit when
          the bundle has none.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr>
                <Th align="left" tip="The commit sha or deployment label events were stamped with. Click to scope the tab to it.">
                  Build
                </Th>
                <Th tip="Distinct sessions that sent events from this build.">Sessions</Th>
                <Th tip="page_view events captured on this build.">Views</Th>
                <Th tip="Rage clicks captured on this build.">Rage</Th>
                <Th tip="Dead clicks captured on this build.">Dead</Th>
              </tr>
            </thead>
            <tbody>
              {visible.map(row)}
            </tbody>
          </table>
          {overflow.length > 0 && (
            <ShowMore count={overflow.length} label="builds">
              <table className="w-full min-w-[640px]">
                <tbody>{overflow.map(row)}</tbody>
              </table>
            </ShowMore>
          )}
        </div>
      )}
    </div>
  );
}

// ── Dashboard (presentational) ───────────────────────────────────────────────
// Renders from a fully resolved dataset in one pass. `createPolishdPage()` no
// longer uses this — it streams each section independently — but the component
// remains for hosts that already load the data themselves.
export function PolishdDashboard({
  data,
  ai,
  showInstalls = false,
}: {
  data: PolishdDashboardData;
  ai: PolishdAIBundle;
  /** Forwarded to the chrome: whether this install collects telemetry. */
  showInstalls?: boolean;
  /**
   * @deprecated The Actionables tab (formerly Issues) is always shown; it lists
   * both reviews' findings whether or not a GitHub repo is connected.
   */
  showIssues?: boolean;
}) {
  return (
    <DashboardChrome active="analytics" showInstalls={showInstalls}>
    <main className="text-fg">
      <AnalyticsHeader pill={<CaptureStatusPill ready={data.overview.ready} />} range={null} />
      <StatusBanners overview={data.overview} health={data.health} />

      {/* AI summary — the model's story of how people use the site */}
      <SummaryCard
        initialSummary={ai.summary}
        initialSettings={ai.settings}
        initialStale={ai.stale}
        initialProfile={ai.profile}
        initialGaps={ai.gaps}
        sourceAvailable={ai.sourceAvailable}
      />

      <OverviewSection range="all">
        <OverviewStatTiles overview={data.overview} trends={data.trends} />
      </OverviewSection>
      <DevicesSection>
        <DevicesCard devices={data.devices} />
      </DevicesSection>
      <PagesSection>
        <TopPagesTable pages={data.pages} />
      </PagesSection>
      <MonitoredSection>
        <MonitoredCard monitored={data.monitored} />
      </MonitoredSection>
      <JourneysSection>
        <JourneyList journeys={data.journeys} />
      </JourneysSection>
      <FeaturesSection>
        <FeaturesCard topUsed={data.topUsed} />
      </FeaturesSection>
      <ElementsSection>
        <ElementsCard elements={data.elements} />
      </ElementsSection>
    </main>
    </DashboardChrome>
  );
}

// ── Streaming render ─────────────────────────────────────────────────────────
// The page used to await every query before sending a byte, so the whole tab
// arrived at the speed of its slowest aggregate. Instead, each section below
// is its own async server component behind its own Suspense boundary: the
// chrome, header, and section titles stream out immediately, and each card
// replaces its skeleton the moment its own data resolves. The per-request
// cache in ./data keeps sections that share inputs from re-running queries.

const skel = "rounded-md bg-raised";

function CardSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className={`${card} overflow-hidden motion-safe:animate-pulse`} aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="flex items-center justify-between gap-4 border-t border-line px-5 py-4 first:border-t-0"
        >
          <div className={`h-3 flex-1 ${skel} opacity-60`} style={{ maxWidth: `${70 - i * 12}%` }} />
          <div className={`h-3 w-12 shrink-0 ${skel} opacity-60`} />
        </div>
      ))}
    </div>
  );
}

function TileGridSkeleton() {
  return (
    <div
      className="grid grid-cols-2 gap-3 motion-safe:animate-pulse sm:grid-cols-3 lg:grid-cols-5"
      aria-hidden="true"
    >
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className={`${card} px-4 py-4`}>
          <div className={`h-3 w-16 ${skel} opacity-60`} />
          <div className={`mt-3 h-6 w-14 ${skel}`} />
          <div className={`mt-4 h-5 w-full ${skel} opacity-40`} />
        </div>
      ))}
    </div>
  );
}

function SummarySkeleton() {
  return (
    <section
      className={`mb-10 ${card} overflow-hidden px-4 py-5 motion-safe:animate-pulse sm:px-5`}
      aria-hidden="true"
    >
      <div className={`h-3.5 w-36 ${skel}`} />
      <div className="mt-5 space-y-2.5">
        <div className={`h-3 w-full ${skel} opacity-60`} />
        <div className={`h-3 w-[92%] ${skel} opacity-60`} />
        <div className={`h-3 w-[68%] ${skel} opacity-60`} />
      </div>
    </section>
  );
}

function PillSkeleton() {
  return (
    <div
      className="h-7 w-28 shrink-0 rounded-full bg-raised motion-safe:animate-pulse"
      aria-hidden="true"
    />
  );
}

// The pill and the banners describe capture itself, so they read the whole
// store whatever range the tab is on: a quiet week must not read as a broken
// proxy. On the default range this is the same cached query the tiles use.
async function StatusPillData() {
  const overview = await loadOverview("all");
  return <CaptureStatusPill ready={overview.ready} />;
}

async function StatusBannersData() {
  const [overview, health] = await Promise.all([loadOverview("all"), loadHealth()]);
  return <StatusBanners overview={overview} health={health} />;
}

/**
 * Cadence-based auto-refresh: when the owner opted into daily/weekly and the
 * summary is both past its cadence AND built from different data, regenerate
 * in the background after this response is sent. Unchanged data never
 * triggers a model call, so the cadence only spends tokens when there's
 * genuinely new behavior to narrate. Run by every render that shows the
 * summary — the Analytics tab and the Overview.
 */
function scheduleSummaryRefresh(
  data: PolishdDashboardData,
  settings: PolishdAISettingsPublic,
  state: { summary: PolishdSummary | null; stale: boolean },
): void {
  const cadence = settings.refreshCadence ?? "manual";
  if (
    cadence === "manual" ||
    !settings.hasApiKey ||
    !data.overview.ready ||
    data.overview.totalEvents === 0
  ) {
    return;
  }
  const cadenceMs = cadence === "daily" ? 86_400_000 : 604_800_000;
  const due =
    state.summary === null ||
    (state.stale && Date.now() - state.summary.generatedAt > cadenceMs);
  if (!due) return;
  after(async () => {
    try {
      await generateSummary();
    } catch (err) {
      console.warn("[polishd] scheduled summary refresh failed:", err);
    }
  });
}

async function SummaryData() {
  // The summary genuinely needs the whole dataset (its staleness fingerprint
  // hashes it), so this is the one section that waits for everything — behind
  // its own boundary, where it can't hold up the sections around it. It is
  // written from the site's whole history, not the tab's range: a narrower
  // range would make it read stale every time the range changed.
  const data = await loadDashboardData("all");
  const [summaryState, settings, profileState] = await Promise.all([
    loadSummaryState(data),
    getAISettingsPublic(),
    loadProfileState(data),
  ]);
  scheduleSummaryRefresh(data, settings, summaryState);

  return (
    <SummaryCard
      initialSummary={summaryState.summary}
      initialSettings={settings}
      initialStale={summaryState.stale}
      initialProfile={profileState.profile}
      initialGaps={profileState.gaps}
      sourceAvailable={profileState.sourceAvailable}
    />
  );
}

/** Each section's data, under the tab's range. */
interface Ranged {
  range: AnalyticsRange;
}

async function OverviewData({ range }: Ranged) {
  const [overview, trends, scope] = await Promise.all([
    loadOverview(range),
    loadTrends(range),
    scopeLabel(range),
  ]);
  return <OverviewStatTiles overview={overview} trends={trends} scope={scope} />;
}

async function DevicesData({ range }: Ranged) {
  return <DevicesCard devices={await loadDevices(range)} />;
}

async function PagesData({ range }: Ranged) {
  return <TopPagesTable pages={await loadPages(range)} />;
}

async function MonitoredData({ range }: Ranged) {
  return <MonitoredCard monitored={await loadMonitored(range)} />;
}

async function JourneysData({ range }: Ranged) {
  return <JourneyList journeys={await loadJourneys(range)} />;
}

async function FeaturesData({ range }: Ranged) {
  return <FeaturesCard topUsed={await loadTopUsed(range)} />;
}

async function ElementsData({ range }: Ranged) {
  return <ElementsCard elements={await loadElements(range)} />;
}

async function BuildsData({ range }: Ranged) {
  const [builds, current] = await Promise.all([loadBuilds(range), loadCurrentBuild()]);
  return <BuildsCard builds={builds} current={current} range={range} />;
}

/** The analytics tab, streamed section by section, every section on `range`. */
function AnalyticsStream({ range }: Ranged) {
  return (
    <main className="text-fg">
      <AnalyticsHeader
        range={<RangeControl range={range} />}
        pill={
          <Suspense fallback={<PillSkeleton />}>
            <StatusPillData />
          </Suspense>
        }
      />
      {/* Banners have no skeleton: most renders show none, and a placeholder
          would promise a warning that usually isn't coming. */}
      <Suspense fallback={null}>
        <StatusBannersData />
      </Suspense>

      <Suspense fallback={<SummarySkeleton />}>
        <SummaryData />
      </Suspense>

      <OverviewSection range={range}>
        <Suspense fallback={<TileGridSkeleton />}>
          <OverviewData range={range} />
        </Suspense>
      </OverviewSection>
      <DevicesSection>
        <Suspense fallback={<CardSkeleton rows={3} />}>
          <DevicesData range={range} />
        </Suspense>
      </DevicesSection>
      <PagesSection>
        <Suspense fallback={<CardSkeleton />}>
          <PagesData range={range} />
        </Suspense>
      </PagesSection>
      <MonitoredSection>
        <Suspense fallback={<CardSkeleton rows={3} />}>
          <MonitoredData range={range} />
        </Suspense>
      </MonitoredSection>
      <JourneysSection>
        <Suspense fallback={<CardSkeleton />}>
          <JourneysData range={range} />
        </Suspense>
      </JourneysSection>
      <FeaturesSection>
        <Suspense fallback={<CardSkeleton />}>
          <FeaturesData range={range} />
        </Suspense>
      </FeaturesSection>
      <ElementsSection>
        <Suspense fallback={<CardSkeleton />}>
          <ElementsData range={range} />
        </Suspense>
      </ElementsSection>
      <BuildsSection>
        <Suspense fallback={<CardSkeleton rows={2} />}>
          <BuildsData range={range} />
        </Suspense>
      </BuildsSection>
    </main>
  );
}

// ── The other tabs, each loading behind the chrome ───────────────────────────

async function OverviewTabData() {
  // Both reviews, so both datasets: the summary's staleness hashes the whole
  // analytics set, the design review's hashes the design metrics. Each comes
  // from the same loaders the other tabs use; the brand board is the Design
  // tab's kit, curated from the same scans.
  const [data, settings, design, snapshots] = await Promise.all([
    loadDashboardData("all"),
    getAISettingsPublic(),
    getDesignData(),
    listSnapshots(),
  ]);
  const [summaryState, reviewState] = await Promise.all([
    loadSummaryState(data),
    loadDesignReviewState(design),
  ]);
  // The paragraph is written from the two reviews, so its staleness follows theirs.
  const overviewState = await loadOverviewState(summaryState.summary, reviewState.review);
  scheduleSummaryRefresh(data, settings, summaryState);
  return (
    <OverviewPanel
      overview={data.overview}
      story={overviewState.overview}
      storyStale={overviewState.stale}
      trends={data.trends}
      devices={data.devices}
      settings={settings}
      summary={summaryState.summary}
      summaryStale={summaryState.stale}
      review={reviewState.review}
      reviewStale={reviewState.stale}
      reviewMetricsChanged={reviewState.metricsChanged}
      scannedPages={design.pages.length}
      // Only the newest snapshot that has pictures — the gallery shows no history.
      snapshot={snapshots.find((s) => s.shots.some((shot) => shot.file.length > 0)) ?? null}
      kit={design.pages.length > 0 ? buildBrandKit(design) : null}
      // Most visited first, so the gallery leads with the pages people see.
      topPages={data.pages.map((p) => p.path)}
    />
  );
}

async function DesignTabData() {
  const [design, settings, snapshots, snapshotMode] = await Promise.all([
    getDesignData(),
    getAISettingsPublic(),
    listSnapshots(),
    resolveSiteOrigin().then(snapshotAvailability),
  ]);
  const reviewState = await loadDesignReviewState(design);
  return (
    <DesignPanel
      data={design}
      review={reviewState.review}
      reviewStale={reviewState.stale}
      settings={settings}
      snapshots={snapshots}
      snapshotMode={snapshotMode}
    />
  );
}

async function ActionablesTabData() {
  // Both reviews as cached (dismissals already filtered, GitHub links and
  // where-it-renders attached), joined to every issue polishd has filed.
  // Neither review's staleness matters here, so the heavy analytics dataset
  // isn't loaded; the design data is, since the review's dismissal check and
  // its usages read it. `listFiledIssues` is [] without a GitHub connection.
  // The dispatch state decides whether and how a fix can start: Create fix,
  // File and fix, or a pointer to the Fix dispatch card.
  const [summary, design, settings, filed, suggestions, stored, runs] = await Promise.all([
    loadSummary(),
    getDesignData(),
    getAISettingsPublic(),
    listFiledIssues(),
    listFixSuggestions(),
    loadDispatchState(),
    listFixRuns(),
  ]);
  // A plan judged before fixes could be dispatched doesn't say when a fix
  // can start; judge it again, once, so the buttons match the workflow.
  const dispatch =
    stored.readiness && !stored.readiness.plan.fixTrigger && settings.hasGithubToken
      ? (await checkDispatchReadiness()).state
      : stored;
  const ready = isDispatchReady(dispatch.readiness?.status);
  const plan = dispatch.readiness?.plan;
  const fix = {
    trigger: ready ? fixTriggerOf(plan) : ("none" as const),
    ...(ready && plan && plan.agent !== "none" ? { agentName: plan.agent === "copilot" ? "Copilot" : "Claude" } : {}),
    paused: settings.dispatchPaused,
  };
  // What GitHub says about every filed issue — pull requests and activity,
  // whoever's they are — in one GraphQL query per forty.
  const [review, issueThreads] = await Promise.all([
    loadDesignReview(design),
    loadIssueThreads(filed.map((f) => f.number)),
  ]);
  return (
    <ActionablesView
      summary={summary}
      review={review}
      filed={filed}
      settings={settings}
      suggestions={suggestions}
      dispatchReady={ready}
      fix={fix}
      runs={runs}
      threads={issueThreads.threads}
      threadError={issueThreads.error}
    />
  );
}

async function InstallsTabData() {
  const [installs, topPaths] = await Promise.all([
    getTelemetryInstalls(),
    getTelemetryTopPaths(),
  ]);
  return <InstallsView installs={installs} topPaths={topPaths} />;
}

async function SettingsTabData() {
  // `loadProfileState` only reads component identifiers out of the dashboard
  // data, so this tab loads those two queries rather than the whole analytics
  // set it would otherwise never look at.
  const [settings, monitored, topUsed, dispatch] = await Promise.all([
    getAISettingsPublic(),
    loadMonitored("all"),
    loadTopUsed("all"),
    loadDispatchState(),
  ]);
  const profileState = await loadProfileState({ monitored, topUsed });
  return (
    <SettingsView
      initialSettings={settings}
      initialProfile={profileState.profile}
      initialGaps={profileState.gaps}
      sourceAvailable={profileState.sourceAvailable}
      initialDispatch={dispatch}
    />
  );
}

// ── Built-in fallback for a failed auth check ────────────────────────────────
/** The frame the access screens share: the mark, a title, then the body. */
function AccessScreen({
  title,
  width = "max-w-sm",
  children,
}: {
  title: string;
  width?: string;
  children: ReactNode;
}) {
  return (
    <main className={`mx-auto flex min-h-[80vh] ${width} flex-col justify-center px-6 py-16 text-fg`}>
      <BrandWordmark height={44} />
      <div className={`mt-8 ${card} p-6`}>
        <div className="flex items-center gap-2 text-fg-3">
          <LockIcon size={15} />
          <h1 className="text-[17px] font-semibold text-fg">{title}</h1>
        </div>
        {children}
      </div>
    </main>
  );
}

function Unauthorized() {
  return (
    <AccessScreen title="Unauthorized" width="max-w-md">
      <p className="mt-2 text-[13px] leading-relaxed text-fg-3">
        This dashboard is protected. Pass an <Code>unauthorized</Code> element to{" "}
        <Code>createPolishdPage()</Code> to render your own sign-in UI here.
      </p>
    </AccessScreen>
  );
}

/**
 * A self-contained surface for the dashboard to render into.
 *
 * The dashboard is a route in someone else's app, so it inherits that app's
 * `<body>`. That is fine until the host's body doesn't scroll — which is the
 * default shape of every dashboard shell, chat UI, editor, and map app, all of
 * which set `overflow: hidden` on body and scroll their own inner regions. In
 * such a host the dashboard renders, looks correct above the fold, and silently
 * strands everything below it: no error, no warning, HTTP 200.
 *
 * `fixed` is what fixes it. It escapes the host's `overflow: hidden` and any
 * ancestor height constraint, and unlike a `min-h-dvh` wrapper it does not
 * depend on the host having given `<body>` a usable height. It also supplies
 * the background the dashboard's own cards assume, so the host's wallpaper
 * stops showing through behind them.
 *
 * Caveat: `position: fixed` is defeated by an ancestor that establishes a
 * containing block (`transform`, `filter`, `contain`, `will-change`). That is
 * rare this close to the root, and `shell: false` is the escape hatch when it
 * happens — see docs/SETUP.md for the fully isolated route-group layout.
 */
function PolishdShell({ children }: { children: ReactNode }) {
  return (
    // `text-fg` is set here as a utility as well as on `.polishd-root` in
    // the stylesheet, so the shell's colour holds even where a host rule
    // targets the wrapper's descendants more specifically than the root.
    <div className="fixed inset-0 z-[2147483000] overflow-y-auto overscroll-contain bg-canvas text-fg">
      {children}
    </div>
  );
}

/**
 * The scope root for the shipped stylesheet.
 *
 * `dist/dashboard.css` scopes every rule to `.polishd-root`, so nothing in it
 * can reach the host app's markup. The compiled entry imports that stylesheet
 * itself (scripts/build-css.mjs adds the import), so the dashboard never
 * renders on the host's palette for want of a page-level import. This element deliberately carries no utility
 * classes of its own: keeping it a bare wrapper is what makes plain descendant
 * scoping complete, and halves the size of the generated selectors.
 *
 * Rendered whether or not the shell is used, since the stylesheet is scoped
 * either way.
 */
function PolishdRoot({ theme, children }: { theme: PolishdTheme; children: ReactNode }) {
  return (
    <div className="polishd-root" data-theme={theme}>
      {children}
    </div>
  );
}

/** The owner's light/dark choice, from the cookie the sidebar toggle sets. */
async function readPolishdTheme(): Promise<PolishdTheme> {
  try {
    return themeFrom((await cookies()).get(POLISHD_THEME_COOKIE)?.value);
  } catch {
    return "dark"; // Outside a request (a static render): the default.
  }
}

/**
 * Props Next passes to a page. Only `searchParams` is used — the unlock form
 * reports failures through the URL so the whole flow stays server-rendered,
 * with no client component and no token in the query string.
 */
export interface PolishdPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export interface CreatePolishdPageOptions {
  /**
   * Gate access to the dashboard. Return `true` to allow.
   *
   * Receives the request's cookies and headers, so the callback is an ordinary
   * function of its inputs rather than something that only works inside a
   * request. A zero-argument callback is still valid and unchanged.
   *
   * If omitted, POLISHD_DASHBOARD_TOKEN guards the dashboard when set;
   * otherwise it renders unguarded in development and refuses in production.
   */
  authenticate?: PolishdAuthenticate;
  /**
   * Rendered when `authenticate` resolves false. Defaults to a minimal screen,
   * or to the token unlock form when `POLISHD_DASHBOARD_TOKEN` is in use.
   */
  unauthorized?: ReactNode;
  /** Tune the built-in token auth (mount path, grant lifetime). */
  tokenAuth?: PolishdTokenAuthOptions;
  /**
   * The app's Polishd config — the same object threaded into `initPolishd()`
   * and `createPolishdRoute()`. The page reads `dashboardRoute` from it and
   * registers it server-side, so the dashboard's queries exclude the route it
   * is actually mounted at instead of the default `/polishd`. Without it (or
   * `POLISHD_DASHBOARD_ROUTE`), a dashboard mounted elsewhere reads its own
   * traffic back as part of the site.
   */
  config?: Partial<PolishdConfig>;
  /**
   * Render the dashboard in a self-contained shell that supplies its own
   * background and scroll container, so host `body` styles can't strand
   * content below the fold. Set false to inherit the host page instead.
   * @default true
   */
  shell?: boolean;
}

/**
 * The unlock prompt shown when `POLISHD_DASHBOARD_TOKEN` guards the dashboard.
 *
 * A form rather than a link with the token in the query string: a URL-borne
 * secret leaks through browser history, server logs, and the `Referer` header
 * of every outbound request the page makes. This posts to a server action,
 * which is the only place in a React Server Components app that can set a
 * cookie, and the address bar never holds the token at all.
 */
function TokenUnlock({ error }: { error?: "invalid" | "rate" }) {
  return (
    <AccessScreen title="Dashboard locked">
      <p className="mt-2 text-[13px] leading-relaxed text-fg-3">
        Enter the dashboard token to continue.
      </p>
      <form action={unlockPolishdDashboard} className="mt-5">
        <label className="block">
          <span className="sr-only">Dashboard token</span>
          <input
            type="password"
            name="token"
            autoComplete="off"
            autoFocus
            placeholder="Dashboard token"
            aria-invalid={error ? true : undefined}
            className={`${inputCls} h-10 ${error ? "border-bad/60" : ""}`}
          />
        </label>
        {error && (
          <p role="alert" className="mt-2 text-[12px] text-bad">
            {error === "rate"
              ? "Too many attempts. Wait a minute and try again."
              : "That token isn't right."}
          </p>
        )}
        <button type="submit" className={`${primaryBtn} mt-3 h-10 w-full`}>
          Unlock
        </button>
      </form>
      <p className="mt-5 border-t border-line pt-4 text-[12px] leading-relaxed text-fg-3">
        The token is the value of <Code>POLISHD_DASHBOARD_TOKEN</Code> in your deployment
        environment.
      </p>
    </AccessScreen>
  );
}

/** Shown in production when the host never made an access decision. */
function SetupRequired() {
  const option = "rounded-lg border border-line bg-sunken px-3.5 py-3";
  return (
    <AccessScreen title="Dashboard locked" width="max-w-xl">
      <p className="mt-2 text-[13px] leading-relaxed text-fg-3">
        This dashboard is unprotected and running in production, so Polishd is refusing to serve
        it. It exposes your analytics, and its settings can change the model and API base URL —
        which means anyone who finds this URL can point your requests at their own endpoint and
        spend your API key.
      </p>
      <p className="mt-5 text-[13px] font-medium text-fg">Choose one:</p>
      <ul className="mt-2.5 space-y-2 text-[13px] text-fg-2">
        <li className={option}>
          Set a token — no code needed: <Code>POLISHD_DASHBOARD_TOKEN</Code>
          <span className="mt-1 block text-[12px] text-fg-3">
            Generate one with <Code>openssl rand -hex 32</Code>.
          </span>
        </li>
        <li className={option}>
          Or pass your app&apos;s own check: <Code>createPolishdPage(&#123; authenticate &#125;)</Code>
        </li>
        <li className={option}>
          Or make it public on purpose: <Code>POLISHD_DASHBOARD_PUBLIC=true</Code>
        </li>
      </ul>
      <p className="mt-5 text-[12px] text-fg-3">
        Local development is unaffected — this only applies when <Code>NODE_ENV=production</Code>.
      </p>
    </AccessScreen>
  );
}

/**
 * Decide the access policy from the host's configuration and environment.
 *
 * The default used to be `open` everywhere, which meant the dashboard shipped
 * unguarded to production unless the host thought to stop it. Nothing is
 * silently locked in development, where an open dashboard is harmless; the
 * change is that production now requires the host to have said something,
 * either by wiring a check or by opting out in so many words.
 */
function resolvePolicy(opts: CreatePolishdPageOptions): PolishdAuthPolicy {
  if (opts.authenticate) return { mode: "guarded", authenticate: opts.authenticate };
  // A configured token is a decision, so honour it without being asked to.
  // Setting the env var is the entire integration for a host with no auth of
  // its own — there is nothing to import and no page to edit.
  if (polishdDashboardToken()) {
    return { mode: "guarded", authenticate: polishdTokenAuth(opts.tokenAuth) };
  }
  if (process.env.NODE_ENV === "production" && process.env.POLISHD_DASHBOARD_PUBLIC !== "true") {
    return { mode: "setup-required" };
  }
  return { mode: "open" };
}

let announcedPolicy = false;

/** Say what was decided, once, at module evaluation. */
function announcePolicy(policy: PolishdAuthPolicy): void {
  if (announcedPolicy) return;
  announcedPolicy = true;
  const production = process.env.NODE_ENV === "production";
  if (policy.mode === "setup-required") {
    console.warn(
      "[polishd] dashboard is locked: running in production with no access decided. " +
        "Set POLISHD_DASHBOARD_TOKEN (e.g. `openssl rand -hex 32`) for a built-in password " +
        "gate, pass `authenticate` to createPolishdPage() to use your app's own auth, or set " +
        "POLISHD_DASHBOARD_PUBLIC=true to serve it publicly on purpose.",
    );
  } else if (policy.mode === "open") {
    // Deliberately not suppressed in production. Production is the *only*
    // environment where an unguarded dashboard is actionable news; warning
    // solely on the developer's laptop, where it is harmless, was backwards.
    console.warn(
      `[polishd] dashboard is unguarded${production ? " IN PRODUCTION" : ""} — anyone who ` +
        "finds the URL can read your analytics, change the configured model and API base " +
        "URL, and spend your model tokens. Set POLISHD_DASHBOARD_TOKEN, or pass " +
        "`authenticate` to createPolishdPage().",
    );
  }
}

/**
 * Build the dashboard page component. Use as the default export of your
 * `app/polishd/page.tsx`.
 */
export function createPolishdPage(opts: CreatePolishdPageOptions = {}) {
  // Register the policy at module evaluation, not per render: the AI server
  // actions are reachable without this page ever rendering, and they re-run
  // `authenticate` themselves before doing any work. See ai/guard.ts.
  const policy = resolvePolicy(opts);
  registerPolishdAuth(policy);
  announcePolicy(policy);

  // Tell the read side where the dashboard actually lives, so its queries
  // exclude this route rather than the default. Registered here for the same
  // reason as the auth policy: page-module evaluation runs before anything in
  // this runtime can query.
  if (opts.config?.dashboardRoute) {
    registerPolishdDashboardRoute(opts.config.dashboardRoute);
  }

  // Applied to the unauthorized screen as well: a sign-in prompt stranded
  // below a non-scrolling fold is the same bug with higher stakes.
  const wrap = (theme: PolishdTheme, node: ReactNode) => (
    <PolishdRoot theme={theme}>
      {opts.shell === false ? node : <PolishdShell>{node}</PolishdShell>}
    </PolishdRoot>
  );

  // Whether the *package* is supplying the gate, which is what decides between
  // the unlock form and the "wire up your own UI" placeholder.
  const usingTokenAuth = !opts.authenticate && polishdDashboardToken() !== null;

  return async function PolishdPage(props: PolishdPageProps = {}) {
    const sp = props.searchParams ? await props.searchParams : {};
    const theme = await readPolishdTheme();

    if (policy.mode === "setup-required") return wrap(theme, <SetupRequired />);
    if (policy.mode === "guarded") {
      const ok = await policy.authenticate(await polishdAuthContext());
      if (!ok) {
        if (opts.unauthorized) return wrap(theme, opts.unauthorized);
        if (usingTokenAuth) {
          const raw = sp.polishd_unlock;
          const code = Array.isArray(raw) ? raw[0] : raw;
          return wrap(
            theme,
            <TokenUnlock error={code === "rate" || code === "invalid" ? code : undefined} />,
          );
        }
        return wrap(theme, <Unauthorized />);
      }
    }

    // Dogfood telemetry — decided per render, after auth, so the consent
    // prompt and the emitter are only ever served to the dashboard's owner.
    // `showInstalls` is the collector-side counterpart: whether any tagged
    // telemetry has landed here, which is what earns the Installs tab.
    const [telemetry, showInstalls] = await Promise.all([
      loadPolishdTelemetryState(),
      hasTelemetryInstalls(),
    ]);
    const telemetryUi = (
      <>
        {telemetry.status === "granted" && (
          <PolishdTelemetryEmitter
            endpoint={telemetry.endpoint}
            installState={telemetry.installState}
          />
        )}
        {telemetry.status === "unset" && <PolishdTelemetryConsent />}
      </>
    );

    // Which tab to render, from the `?tab=` query the sidebar links carry.
    // No (or an unknown) tab lands on the Overview. `issues` is the
    // Actionables tab's old name, kept so a bookmark still lands.
    const rawTab = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
    const tab: PolishdDashboardTab =
      rawTab === "analytics" ||
      rawTab === "design" ||
      rawTab === "actionables" ||
      rawTab === "installs" ||
      rawTab === "settings"
        ? rawTab
        : rawTab === "issues"
          ? "actionables"
          : "overview";

    // How far back the Analytics tab reaches, from `?range=`; anything that
    // isn't a known range is all time. Only that tab reads it.
    const range = parseAnalyticsRange(Array.isArray(sp.range) ? sp.range[0] : sp.range);

    // Every tab streams: the chrome and rail go out immediately, and the
    // tab's data loads behind a Suspense boundary showing the same skeleton
    // the client paints while navigating — so a slow query never blanks the
    // frame, it just holds the skeleton a beat longer.
    const body =
      tab === "overview" ? (
        <Suspense fallback={<TabSkeleton name="Overview" />}>
          <OverviewTabData />
        </Suspense>
      ) : tab === "design" ? (
        <Suspense fallback={<TabSkeleton name="Design" />}>
          <DesignTabData />
        </Suspense>
      ) : tab === "actionables" ? (
        <Suspense fallback={<TabSkeleton name="Actionables" />}>
          <ActionablesTabData />
        </Suspense>
      ) : tab === "installs" ? (
        <Suspense fallback={<TabSkeleton name="Installs" />}>
          <InstallsTabData />
        </Suspense>
      ) : tab === "settings" ? (
        <Suspense fallback={<TabSkeleton name="Settings" />}>
          <SettingsTabData />
        </Suspense>
      ) : (
        // Analytics carries per-section boundaries instead of one big one, so
        // its header and section titles paint before any query has finished
        // and each card fills in on its own schedule.
        <AnalyticsStream range={range} />
      );

    return wrap(
      theme,
      <>
        <DashboardChrome active={tab} showInstalls={showInstalls} theme={theme}>
          {body}
        </DashboardChrome>
        {telemetryUi}
      </>,
    );
  };
}
