"use client";

/**
 * Buffd — "Top pages" table + sessions-over-time drawer (client).
 *
 * Lists the most-visited pages; clicking a row opens a bottom drawer with a
 * bar chart of distinct sessions per day for that page. A bottom drawer (rather
 * than a side panel) suits a wide time-series chart and keeps the table in view
 * above it.
 */
import { useEffect, useState } from "react";

import type { PageTrendPoint, TopPage } from "../server/queries";

const border = "border-[#2e2e2e]";
const card = `border ${border} rounded-lg bg-[#0a0a0a]`;
const divider = `border-t ${border}`;
const labelCls = "text-[11px] font-medium uppercase tracking-[0.08em] text-[#666]";

// ── Tooltip + header cell (compact copies of the dashboard's, for the client) ──
function InfoTip({
  text,
  anchor = "right",
  below = false,
}: {
  text: string;
  anchor?: "left" | "right";
  below?: boolean;
}) {
  const vClass = below ? "top-full mt-2" : "bottom-full mb-2";
  return (
    <span className="group/tip relative ml-1 inline-flex translate-y-px cursor-help align-middle">
      <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full border border-[#444] text-[9px] font-bold leading-none text-[#666]">
        i
      </span>
      <span
        role="tooltip"
        className={`pointer-events-none absolute ${vClass} ${
          anchor === "left" ? "left-0" : "right-0"
        } z-20 w-64 max-w-[calc(100vw-2rem)] rounded-lg border border-[#2e2e2e] bg-[#111] px-3 py-2 text-left text-[12px] font-normal normal-case leading-snug tracking-normal text-[#aaa] opacity-0 shadow-2xl transition-opacity duration-150 group-hover/tip:opacity-100`}
      >
        {text}
      </span>
    </span>
  );
}

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
      className={`whitespace-nowrap py-2.5 ${
        align === "left" ? "pl-5 pr-6 text-left" : "px-4 text-right"
      } ${labelCls}`}
    >
      <span className="inline-flex items-center gap-0.5">
        {children}
        <InfoTip text={tip} anchor={align === "left" ? "left" : "right"} below />
      </span>
    </th>
  );
}

// ── Page-level metadata grid ──────────────────────────────────────────────────
function MetaCell({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="bg-[#0a0a0a] px-4 py-3">
      <div className={labelCls}>{label}</div>
      <div className={`mt-1 text-[16px] font-semibold tabular-nums ${tone ?? "text-white"}`}>
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
      className={`grid grid-cols-2 gap-px overflow-hidden rounded-lg border ${border} bg-[#2e2e2e] sm:grid-cols-4`}
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
        tone={page.rageClicks > 0 ? "text-red-400" : "text-[#555]"}
      />
      <MetaCell
        label="Dead clicks"
        value={String(page.deadClicks)}
        tone={page.deadClicks > 0 ? "text-[#f5a623]" : "text-[#555]"}
      />
      <MetaCell
        label="JS errors"
        value={String(page.jsErrors)}
        tone={page.jsErrors > 0 ? "text-red-400" : "text-[#555]"}
      />
    </div>
  );
}

// ── Sessions-over-time line chart ─────────────────────────────────────────────

/** A nice 0-based integer tick scale for the y-axis. */
function yScale(peak: number): { top: number; ticks: number[] } {
  const target = 4; // aim for ~4 gridlines
  if (peak <= target) {
    const top = Math.max(peak, 1);
    return { top, ticks: Array.from({ length: top + 1 }, (_, i) => i) };
  }
  const step = Math.ceil(peak / target);
  const top = step * Math.ceil(peak / step);
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  return { top, ticks };
}

function SessionsChart({ trend }: { trend: PageTrendPoint[] }) {
  if (trend.length === 0) {
    return <p className="py-8 text-center text-[13px] text-[#555]">No session data yet.</p>;
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
        <defs>
          <linearGradient id="buffd-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* y gridlines + numbered ticks */}
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={padL}
              y1={yFor(t)}
              x2={W - padR}
              y2={yFor(t)}
              stroke="#1c1c1c"
              strokeWidth={1}
            />
            <text
              x={padL - 8}
              y={yFor(t) + 3.5}
              textAnchor="end"
              fontSize={10}
              fill="#666"
              className="tabular-nums"
            >
              {t}
            </text>
          </g>
        ))}

        {/* area + line */}
        <path d={areaPath} fill="url(#buffd-area)" />
        <path d={linePath} fill="none" stroke="#3b82f6" strokeWidth={2} strokeLinejoin="round" />

        {/* points (native tooltip on hover) + x-axis date labels */}
        {pts.map((p, i) => (
          <g key={p.ts}>
            <circle cx={p.x} cy={p.y} r={3} fill="#0a0a0a" stroke="#3b82f6" strokeWidth={2}>
              <title>
                {p.label}: {p.sessions} {p.sessions === 1 ? "session" : "sessions"}
              </title>
            </circle>
            {showLabel(i) && (
              <text x={p.x} y={H - 9} textAnchor="middle" fontSize={10} fill="#666">
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
  useEffect(() => {
    if (!page) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [page, onClose]);

  const open = page !== null;

  return (
    <div className={`fixed inset-0 z-50 ${open ? "" : "pointer-events-none"}`} aria-hidden={!open}>
      {/* backdrop */}
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-black/60 transition-opacity duration-200 ${
          open ? "opacity-100" : "opacity-0"
        }`}
      />
      {/* panel */}
      <div
        className={`absolute inset-x-0 bottom-0 transition-transform duration-200 ease-out ${
          open ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Page sessions over time"
          className={`mx-auto max-h-[80vh] max-w-5xl overflow-y-auto rounded-t-xl border ${border} bg-[#0a0a0a] px-4 pb-6 pt-4 shadow-2xl sm:px-6 sm:pb-8 sm:pt-5`}
        >
          {page && (
            <>
              {/* drag affordance */}
              <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[#2e2e2e]" />
              {/* header */}
              <div className="mb-6 flex items-start justify-between gap-4">
                <div>
                  <div className={labelCls}>Page</div>
                  <h3 className="mt-1 font-mono text-[16px] text-white">{page.path}</h3>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[#2e2e2e] text-[#888] transition-colors hover:bg-[#111] hover:text-white"
                >
                  ✕
                </button>
              </div>
              <PageMeta page={page} />
              <div className={`mb-3 mt-6 ${labelCls}`}>Sessions over time</div>
              <SessionsChart trend={page.trend} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Table ─────────────────────────────────────────────────────────────────────
function PageRow({ page, onOpen }: { page: TopPage; onOpen: () => void }) {
  return (
    <tr
      onClick={onOpen}
      className={`group cursor-pointer ${divider} transition-colors hover:bg-[#111]`}
    >
      <td className="py-2.5 pl-5 pr-6">
        <span className="font-mono text-[13px] text-[#ccc] group-hover:text-white">{page.path}</span>
      </td>
      <td className="py-2.5 px-4 text-right text-[13px] font-semibold tabular-nums text-white">
        {page.sessions}
      </td>
      <td className="py-2.5 px-4 text-right text-[13px] tabular-nums text-[#888]">{page.pageViews}</td>
      <td className="py-2.5 px-4 text-right text-[13px] tabular-nums text-[#888]">{page.rageClicks}</td>
      <td className="py-2.5 px-4 text-right text-[13px] tabular-nums text-[#888]">{page.deadClicks}</td>
      <td className="py-2.5 px-4 text-right text-[13px] tabular-nums text-[#888]">{page.jsErrors}</td>
      <td className="py-2.5 pl-4 pr-5 text-right text-[13px] tabular-nums text-[#555]">
        <span className="group-hover:text-[#999]">›</span>
      </td>
    </tr>
  );
}

export default function TopPagesTable({ pages }: { pages: TopPage[] }) {
  const [selected, setSelected] = useState<TopPage | null>(null);

  return (
    <>
      <div className={card}>
        {pages.length === 0 ? (
          <p className="px-5 py-8 text-center text-[13px] text-[#555]">
            No data yet — browse the site then refresh.
          </p>
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
                <Th tip="Dead clicks (on non-interactive elements) on this page.">Dead</Th>
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
