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
import { border, card, divider, labelCls as label } from "./ui";

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
      className={`whitespace-nowrap py-2.5 ${
        align === "left" ? "pl-5 pr-6 text-left" : "px-4 text-right"
      } ${label}`}
    >
      {children}
    </th>
  );
}

function Stat({ label: labelText, value }: { label: string; value: number }) {
  return (
    <div className={`${card} px-4 py-4`}>
      <div className="text-[28px] font-semibold tabular-nums leading-none text-white">
        {value.toLocaleString()}
      </div>
      <div className={`mt-2 ${label}`}>{labelText}</div>
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

  return (
    <main className="text-white">
      <div className={`mb-8 border-b ${border} pb-6`}>
        <h1 className="text-[22px] font-semibold tracking-tight text-white">Installs</h1>
        <p className="mt-1 text-[13px] text-[#666]">
          Polishd dashboards out in the wild — anonymous usage reported by installations whose
          owners opted in, named by the domain they run on. This install&apos;s own analytics are
          never mixed in here, and these rows never appear in its analytics.
        </p>
      </div>

      <section className="mb-8">
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Installs" value={installs.length} />
          <Stat label="Active this week" value={activeWeek} />
          <Stat label="Dashboard sessions" value={sessions} />
        </div>
      </section>

      <section className="mb-8">
        <div className={`mb-3 ${label}`}>Installations</div>
        <div className={card}>
          {installs.length === 0 ? (
            <p className="px-5 py-8 text-center text-[13px] text-[#555]">
              No telemetry received yet. This tab fills in once a dashboard whose owner opted in
              reports to this installation&apos;s <code className="font-mono">/telemetry</code>{" "}
              endpoint.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px]">
                <thead>
                  <tr>
                    <Th align="left">Install</Th>
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
                    <tr key={i.install} className={`${divider} first:border-t-0`}>
                      <td className="py-2.5 pl-5 pr-4 text-[13px] font-medium text-white">
                        {i.install}
                      </td>
                      <td className="py-2.5 px-4 text-right text-[13px] tabular-nums text-[#888]">
                        {i.sessions}
                      </td>
                      <td className="py-2.5 px-4 text-right text-[13px] font-semibold tabular-nums text-white">
                        {i.pageViews}
                      </td>
                      <td className="py-2.5 px-4 text-right text-[13px] tabular-nums text-[#888]">
                        {i.clicks}
                      </td>
                      <td className="py-2.5 px-4 text-right text-[13px] tabular-nums">
                        {i.rageClicks > 0 ? (
                          <span className="text-red-400">{i.rageClicks}</span>
                        ) : (
                          <span className="text-[#444]">—</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-right text-[13px] tabular-nums">
                        {i.deadClicks > 0 ? (
                          <span className="text-[#f5a623]">{i.deadClicks}</span>
                        ) : (
                          <span className="text-[#444]">—</span>
                        )}
                      </td>
                      <td className="py-2.5 pl-4 pr-5 text-right text-[12px] tabular-nums text-[#666]">
                        {timeAgo(i.lastSeen)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {topPaths.length > 0 && (
        <section className="mb-8">
          <div className={`mb-3 ${label}`}>Most-used dashboard tabs</div>
          <div className={card}>
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
                  <tr key={p.path} className={`${divider} first:border-t-0`}>
                    <td className="py-2.5 pl-5 pr-4 text-[13px] font-medium capitalize text-white">
                      {tabName(p.path)}
                    </td>
                    <td className="py-2.5 px-4 text-right text-[13px] font-semibold tabular-nums text-white">
                      {p.views}
                    </td>
                    <td className="py-2.5 px-4 text-right text-[13px] tabular-nums text-[#888]">
                      {p.sessions}
                    </td>
                    <td className="py-2.5 pl-4 pr-5 text-right text-[13px] tabular-nums text-[#888]">
                      {p.installs}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
