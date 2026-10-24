"use client";

/**
 * Polishd — "Top pages" table + sessions-over-time drawer (client).
 *
 * Lists the most-visited pages; clicking a row opens a bottom drawer with a
 * chart of distinct sessions per day for that page. The drawer shell itself
 * lives in ./drawer — the Overview tiles open into the same one.
 */
import { useState } from "react";

import type { PageTrendPoint, TopPage } from "../server/queries";
import BottomDrawer, { DrawerHeader } from "./drawer";
import {
  ChevronRightIcon,
  EmptyState,
  InfoTip,
  card,
  divider,
  eyebrowCls,
  labelCls,
  yScale,
} from "./ui";

function Th({
  children,
  tip,
  align = "right",
}: {
  children: React.ReactNode;
  tip: string;
  align?: "left" | "right";
}) {
  return (
    <th
      className={`whitespace-nowrap border-b border-line bg-sunken py-2.5 ${
        align === "left" ? "pl-5 pr-6 text-left" : "px-4 text-right"
      } ${labelCls}`}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        <InfoTip text={tip} anchor={align === "left" ? "left" : "right"} below />
      </span>
    </th>
  );
}

// ── Page-level metadata grid ──────────────────────────────────────────────────
function MetaCell({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="bg-surface px-4 py-3">
      <div className={labelCls}>{label}</div>
      <div className={`mt-1 text-[18px] font-semibold tracking-[-0.01em] tabular-nums ${tone ?? "text-fg"}`}>
        {value}
      </div>
    </div>
  );
}

function PageMeta({ page }: { page: TopPage }) {
  const peakDay = page.trend.length ? Math.max(...page.trend.map((p) => p.sessions)) : 0;
  const viewsPerSession = page.sessions > 0 ? page.pageViews / page.sessions : 0;
  return (
    <div
      className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4"
    >
      <MetaCell label="Sessions" value={String(page.sessions)} />
      <MetaCell label="Page views" value={String(page.pageViews)} />
      <MetaCell label="Views / session" value={viewsPerSession.toFixed(1)} />
      <MetaCell label="Peak / day" value={String(peakDay)} />
      <MetaCell
        label="Avg scroll"
        value={page.avgScrollDepth === null ? "—" : `${page.avgScrollDepth}%`}
      />
      <MetaCell
        label="Rage clicks"
        value={String(page.rageClicks)}
        tone={page.rageClicks > 0 ? "text-bad" : "text-fg-3"}
      />
      <MetaCell
        label="Dead clicks"
        value={String(page.deadClicks)}
        tone={page.deadClicks > 0 ? "text-warn" : "text-fg-3"}
      />
      <MetaCell
        label="JS errors"
        value={String(page.jsErrors)}
        tone={page.jsErrors > 0 ? "text-bad" : "text-fg-3"}
      />
    </div>
  );
}

// ── Sessions-over-time line chart ─────────────────────────────────────────────

function SessionsChart({ trend }: { trend: PageTrendPoint[] }) {
  if (trend.length === 0) {
    return <p className="py-8 text-center text-[13px] text-fg-3">No session data yet.</p>;
  }
  const peak = Math.max(...trend.map((p) => p.sessions), 1);
  const { top, ticks } = yScale(peak);

  // SVG geometry (a viewBox; the element scales to its container width).
  const W = 640;
  const H = 220;
  const padL = 32;
  const padR = 14;
  const padT = 12;
  const padB = 28;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const n = trend.length;

  const xFor = (i: number) => (n === 1 ? padL + plotW / 2 : padL + (i / (n - 1)) * plotW);
  const yFor = (v: number) => padT + plotH - (v / top) * plotH;

  const pts = trend.map((p, i) => ({ ...p, x: xFor(i), y: yFor(p.sessions) }));
  const linePath = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  // Area fill closes the line down to the baseline.
  const areaPath = `${linePath} L${pts[pts.length - 1].x},${yFor(0)} L${pts[0].x},${yFor(0)} Z`;

  // Show at most ~6 date labels so they don't collide.
  const maxLabels = 6;
  const labelStep = Math.max(1, Math.ceil(n / maxLabels));
  const showLabel = (i: number) => i === 0 || i === n - 1 || i % labelStep === 0;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Sessions over time">
        {/* y gridlines + numbered ticks */}
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={padL}
              y1={yFor(t)}
              x2={W - padR}
              y2={yFor(t)}
              strokeWidth={1}
              strokeDasharray={t === 0 ? undefined : "2 4"}
              style={{ stroke: t === 0 ? "var(--pd-line-strong)" : "var(--pd-line)" }}
            />
            <text
              x={padL - 8}
              y={yFor(t) + 3.5}
              textAnchor="end"
              fontSize={10.5}
              className="fill-fg-3 tabular-nums"
            >
              {t}
            </text>
          </g>
        ))}

        {/* area + line */}
        <path d={areaPath} style={{ fill: "var(--pd-accent)" }} fillOpacity={0.1} />
        <path
          d={linePath}
          fill="none"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          style={{ stroke: "var(--pd-accent)" }}
        />

        {/* points (native tooltip on hover) + x-axis date labels */}
        {pts.map((p, i) => (
          <g key={p.ts}>
            <circle
              cx={p.x}
              cy={p.y}
              r={3.5}
              strokeWidth={2}
              style={{ fill: "var(--pd-surface)", stroke: "var(--pd-accent)" }}
            >
              <title>
                {p.label}: {p.sessions} {p.sessions === 1 ? "session" : "sessions"}
              </title>
            </circle>
            {showLabel(i) && (
              <text x={p.x} y={H - 9} textAnchor="middle" fontSize={10.5} className="fill-fg-3">
                {p.label}
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}

// ── Bottom drawer ─────────────────────────────────────────────────────────────
function PageDrawer({ page, onClose }: { page: TopPage | null; onClose: () => void }) {
  return (
    <BottomDrawer open={page !== null} onClose={onClose} label="Page sessions over time">
      {page && (
        <>
          <DrawerHeader
            eyebrow="Page"
            title={<h3 className="font-mono text-[17px] font-medium text-fg">{page.path}</h3>}
            onClose={onClose}
          />
          <PageMeta page={page} />
          <div className={`mb-3 mt-7 ${eyebrowCls}`}>Sessions over time</div>
          <SessionsChart trend={page.trend} />
        </>
      )}
    </BottomDrawer>
  );
}

// ── Table ─────────────────────────────────────────────────────────────────────
function PageRow({ page, onOpen }: { page: TopPage; onOpen: () => void }) {
  return (
    <tr
      data-component="page-open"
      onClick={onOpen}
      className={`group cursor-pointer ${divider} transition-colors first:border-t-0 hover:bg-raised/50`}
    >
      <td className="py-3 pl-5 pr-6">
        <span className="font-mono text-[13px] text-fg-2 transition-colors group-hover:text-fg">
          {page.path}
        </span>
      </td>
      <td className="py-3 px-4 text-right text-[13px] font-semibold tabular-nums text-fg">
        {page.sessions}
      </td>
      <td className="py-3 px-4 text-right text-[13px] tabular-nums text-fg-2">{page.pageViews}</td>
      <td className={`py-3 px-4 text-right text-[13px] tabular-nums ${page.rageClicks > 0 ? "text-bad" : "text-fg-3"}`}>
        {page.rageClicks}
      </td>
      <td className={`py-3 px-4 text-right text-[13px] tabular-nums ${page.deadClicks > 0 ? "text-warn" : "text-fg-3"}`}>
        {page.deadClicks}
      </td>
      <td className={`py-3 px-4 text-right text-[13px] tabular-nums ${page.jsErrors > 0 ? "text-bad" : "text-fg-3"}`}>
        {page.jsErrors}
      </td>
      <td className="py-3 pl-4 pr-5 text-right text-fg-3">
        <span className="inline-flex transition-[color,transform] group-hover:translate-x-0.5 group-hover:text-fg-2">
          <ChevronRightIcon size={15} />
        </span>
      </td>
    </tr>
  );
}

export default function TopPagesTable({ pages }: { pages: TopPage[] }) {
  const [selected, setSelected] = useState<TopPage | null>(null);

  return (
    <>
      <div className={`${card} overflow-hidden`}>
        {pages.length === 0 ? (
          <EmptyState>No data yet — browse the site then refresh.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full min-w-[520px]">
            <thead>
              <tr>
                <Th align="left" tip="The route. Click a row to see its sessions over time.">
                  Path
                </Th>
                <Th tip="Distinct sessions that viewed this page. Pages are ranked by this.">
                  Sessions
                </Th>
                <Th tip="page_view events — loads plus soft navigations to this route.">Views</Th>
                <Th tip="Rage clicks (3+ in 500ms on one element) on this page.">Rage</Th>
                <Th tip="Dead clicks (on non-interactive, non-text elements) on this page.">Dead</Th>
                <Th tip="JS errors thrown on this page.">Errors</Th>
                <Th tip="Open the sessions-over-time chart.">{""}</Th>
              </tr>
            </thead>
            <tbody>
              {pages.map((p) => (
                <PageRow key={p.path} page={p} onOpen={() => setSelected(p)} />
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
      <PageDrawer page={selected} onClose={() => setSelected(null)} />
    </>
  );
}
