/**
 * Polishd — the Installs tab: cross-install dashboard telemetry.
 *
 * Rendered only on installations that *collect* telemetry (for polishd
 * itself, the landing site) — the tab is gated on tagged rows actually
 * existing. Shows the dashboards out in the wild, named by the domain their
 * requests came from, and how they're used: the same frustration signals the
 * package captures for its hosts, pointed at its own product surface.
 */
import type { ReactNode } from "react";

import type { TelemetryInstall, TelemetryPathStat } from "../server/queries";
import {
  EmptyState,
  PageHeader,
  Section,
  card,
  divider,
  labelCls as label,
  toneDot,
  type Tone,
} from "./ui";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function timeAgo(ms: number): string {
  const delta = Date.now() - ms;
  if (delta < 60_000) return "just now";
  const mins = Math.floor(delta / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ms).toISOString().slice(0, 10);
}

/** "/~polishd/analytics" → "analytics"; anything unrecognized stays whole. */
function tabName(path: string): string {
  const m = /^\/~polishd\/(.+)$/.exec(path);
  return m ? m[1] : path;
}

function Th({ children, align = "right" }: { children: ReactNode; align?: "left" | "right" }) {
  return (
    <th
      className={`whitespace-nowrap border-b border-line bg-sunken py-2.5 ${
        align === "left" ? "pl-5 pr-6 text-left" : "px-4 text-right"
      } ${label}`}
    >
      {children}
    </th>
  );
}

function Stat({
  label: labelText,
  value,
  tone,
}: {
  label: string;
  value: number;
  /** Status colour of the caption's dot; neutral when omitted. */
  tone?: Tone;
}) {
  return (
    <div className={`${card} px-4 py-4`}>
      <div className={`flex items-center gap-1.5 ${label}`}>
        <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone ? toneDot[tone] : "bg-fg-4"}`} />
        {labelText}
      </div>
      <div className="mt-2 text-[26px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-fg">
        {value.toLocaleString()}
      </div>
    </div>
  );
}

export default function InstallsView({
  installs,
  topPaths,
}: {
  installs: TelemetryInstall[];
  topPaths: TelemetryPathStat[];
}) {
  const now = Date.now();
  const activeWeek = installs.filter((i) => now - i.lastSeen < WEEK_MS).length;
  const sessions = installs.reduce((sum, i) => sum + i.sessions, 0);
  const withModel = installs.filter((i) => i.hasModel === true).length;

  return (
    <main className="text-fg">
      <PageHeader
        title="Installs"
        description={
          <>
            Polishd dashboards out in the wild — anonymous usage reported by installations whose
            owners opted in, named by the domain they run on. This install&apos;s own analytics are
            never mixed in here, and these rows never appear in its analytics.
          </>
        }
      />

      <section className="mb-10">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Installs" value={installs.length} />
          <Stat label="Active this week" value={activeWeek} tone="ok" />
          <Stat label="Dashboard sessions" value={sessions} tone="accent" />
          <Stat label="With a model" value={withModel} tone="violet" />
        </div>
      </section>

      <Section title="Installations">
        <div className={`${card} overflow-hidden`}>
          {installs.length === 0 ? (
            <EmptyState>
              No telemetry received yet. This tab fills in once a dashboard whose owner opted in
              reports to this installation&apos;s <code className="font-mono">/telemetry</code>{" "}
              endpoint.
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px]">
                <thead>
                  <tr>
                    <Th align="left">Install</Th>
                    <Th align="left">Model</Th>
                    <Th>Sessions</Th>
                    <Th>Tab views</Th>
                    <Th>Clicks</Th>
                    <Th>Rage</Th>
                    <Th>Dead</Th>
                    <Th>Last seen</Th>
                  </tr>
                </thead>
                <tbody>
                  {installs.map((i) => (
                    <tr
                      key={i.install}
                      className={`${divider} transition-colors first:border-t-0 hover:bg-raised/50`}
                    >
                      <td className="py-3 pl-5 pr-4 text-[13px] font-medium text-fg">
                        {i.install}
                      </td>
                      <td className="py-3 pl-5 pr-6 text-[12px]">
                        {i.hasModel ? (
                          <span className="font-mono text-[12px] text-fg-2">
                            {[i.provider, i.model].filter(Boolean).join(" · ") || "connected"}
                          </span>
                        ) : i.hasModel === false ? (
                          <span className="text-fg-3">none</span>
                        ) : (
                          <span className="text-fg-4">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right text-[13px] tabular-nums text-fg-2">
                        {i.sessions}
                      </td>
                      <td className="py-3 px-4 text-right text-[13px] font-semibold tabular-nums text-fg">
                        {i.pageViews}
                      </td>
                      <td className="py-3 px-4 text-right text-[13px] tabular-nums text-fg-2">
                        {i.clicks}
                      </td>
                      <td className="py-3 px-4 text-right text-[13px] tabular-nums">
                        {i.rageClicks > 0 ? (
                          <span className="text-bad">{i.rageClicks}</span>
                        ) : (
                          <span className="text-fg-4">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right text-[13px] tabular-nums">
                        {i.deadClicks > 0 ? (
                          <span className="text-warn">{i.deadClicks}</span>
                        ) : (
                          <span className="text-fg-4">—</span>
                        )}
                      </td>
                      <td className="py-3 pl-4 pr-5 text-right text-[12px] tabular-nums text-fg-3">
                        {timeAgo(i.lastSeen)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Section>

      {topPaths.length > 0 && (
        <Section title="Most-used dashboard tabs">
          <div className={`${card} overflow-hidden`}>
            <table className="w-full">
              <thead>
                <tr>
                  <Th align="left">Tab</Th>
                  <Th>Views</Th>
                  <Th>Sessions</Th>
                  <Th>Installs</Th>
                </tr>
              </thead>
              <tbody>
                {topPaths.map((p) => (
                  <tr
                    key={p.path}
                    className={`${divider} transition-colors first:border-t-0 hover:bg-raised/50`}
                  >
                    <td className="py-3 pl-5 pr-4 text-[13px] font-medium capitalize text-fg">
                      {tabName(p.path)}
                    </td>
                    <td className="py-3 px-4 text-right text-[13px] font-semibold tabular-nums text-fg">
                      {p.views}
                    </td>
                    <td className="py-3 px-4 text-right text-[13px] tabular-nums text-fg-2">
                      {p.sessions}
                    </td>
                    <td className="py-3 pl-4 pr-5 text-right text-[13px] tabular-nums text-fg-2">
                      {p.installs}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </main>
  );
}
