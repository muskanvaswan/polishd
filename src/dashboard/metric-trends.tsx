"use client";

/**
 * Polishd — the Overview tiles and the metric charts they open (client).
 *
 * The five numbers at the top of the Analytics tab are all-time totals, which
 * answer "how much" and never "when". Every tile is now a button: clicking one
 * opens a bottom drawer with that metric bucketed over time, so "142 sessions"
 * becomes "40 of them on Tuesday, none since".
 *
 * All five series ride down from the server together (see `getMetricTrends`),
 * at both granularities, so switching metric or switching hourly/daily is
 * instant and costs no round trip. Buckets are UTC — the labels are rendered
 * server-side, and a local-timezone label would follow wherever the server
 * runs rather than wherever the reader is.
 */
import { useState } from "react";

import type {
  MetricKey,
  MetricPoint,
  MetricTrends,
  OverviewStats,
  TrendGranularity,
} from "../server/queries";
import BottomDrawer, { DrawerHeader } from "./drawer";
import { InfoTip, card, labelCls, toneDot, yScale, type Tone } from "./ui";

/** One tile: what it counts, how it's drawn, and how it reads over time. */
interface MetricMeta {
  key: MetricKey;
  label: string;
  tip: string;
  /** Which status colour the metric reads in — its dot, sparkline and bars. */
  tone: Tone;
  /** The same colour as a CSS value, for SVG paints and inline swatches. */
  accent: string;
  /**
   * Whether buckets can be summed. Event counts can; sessions cannot — a
   * visitor active across three hours is in all three buckets, so adding them
   * up counts one person three times.
   */
  additive: boolean;
  /** How one bucket reads in prose, for the tooltip: "3 sessions". */
  unit: [singular: string, plural: string];
}

const METRICS: MetricMeta[] = [
  {
    key: "sessions",
    label: "Sessions",
    tip: "Distinct anonymous visitors, counted by the polishd_session cookie. One cookie = one session; no fingerprinting. Click for sessions over time.",
    tone: "accent",
    accent: "var(--pd-accent)",
    additive: false,
    unit: ["session", "sessions"],
  },
  {
    key: "pageViews",
    label: "Page views",
    tip: "page_view events — initial page loads plus client-side (soft) navigations between routes. Click for page views over time.",
    tone: "accent",
    accent: "var(--pd-accent)",
    additive: true,
    unit: ["page view", "page views"],
  },
  {
    key: "rageClicks",
    label: "Rage clicks",
    tip: "3+ clicks on the same element within 500ms. A strong signal of frustration — something looks clickable or is broken. Double/triple-clicks that select text don't count. Click for rage clicks over time.",
    tone: "bad",
    accent: "var(--pd-bad)",
    additive: true,
    unit: ["rage click", "rage clicks"],
  },
  {
    key: "deadClicks",
    label: "Dead clicks",
    tip: "Clicks on non-interactive elements (no link, button, or role within 4 ancestors). Users expected something to happen but nothing did. Clicks on text are excluded — that's reading, not confusion. Click for dead clicks over time.",
    tone: "warn",
    accent: "var(--pd-warn)",
    additive: true,
    unit: ["dead click", "dead clicks"],
  },
  {
    key: "totalEvents",
    label: "Events",
    tip: "Total raw signals captured across all event types. Click for events over time.",
    tone: "accent",
    accent: "var(--pd-accent)",
    additive: true,
    unit: ["event", "events"],
  },
];

const GRAN_LABEL: Record<TrendGranularity, string> = { hour: "Hourly", day: "Daily" };
const GRAN_UNIT: Record<TrendGranularity, [string, string]> = {
  hour: ["hour", "hours"],
  day: ["day", "days"],
};

const plural = (n: number, [one, many]: [string, string]) => `${n} ${n === 1 ? one : many}`;

// ── The tile grid ────────────────────────────────────────────────────────────

export default function OverviewTiles({
  overview,
  trends,
  metrics,
  gridClassName = "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5",
  dot = true,
  scope = "all time",
}: {
  overview: OverviewStats;
  trends: MetricTrends;
  /**
   * What the tiles count, in prose: "all time", "the last 7 days", "build
   * f804613". The chart's footnote names it where its window is narrower.
   */
  scope?: string;
  /**
   * The tiles to show, in their usual order — all five when omitted. The
   * chart drawer still switches between every metric, since all are loaded.
   */
  metrics?: MetricKey[];
  /** The tiles' grid. `contents` lets them join a grid the caller owns. */
  gridClassName?: string;
  /**
   * The tone dot before each label. It tells the friction tiles from the
   * audience ones on the Analytics tab; a page showing only audience tiles
   * has nothing for it to tell apart.
   */
  dot?: boolean;
}) {
  // Daily is the better default once there's more than a day of history;
  // before that it's a single bar, and hourly is the only shape worth drawing.
  const [gran, setGran] = useState<TrendGranularity>(
    trends.day.length >= 2 || trends.hour.length === 0 ? "day" : "hour",
  );
  const [open, setOpen] = useState<MetricKey | null>(null);

  const series = trends[gran];
  const metric = METRICS.find((m) => m.key === open) ?? null;
  const hasTrend = trends.day.length > 0 || trends.hour.length > 0;

  return (
    <>
      <div className={gridClassName}>
        {METRICS.filter((m) => !metrics || metrics.includes(m.key)).map((m) => (
          <StatTile
            key={m.key}
            meta={m}
            value={overview[m.key]}
            spark={hasTrend ? series.map((p) => p[m.key]) : []}
            onOpen={hasTrend ? () => setOpen(m.key) : null}
            dot={dot}
          />
        ))}
      </div>

      <BottomDrawer
        open={metric !== null}
        onClose={() => setOpen(null)}
        label={metric ? `${metric.label} over time` : "Metric over time"}
      >
        {metric && (
          <>
            <DrawerHeader
              eyebrow="Over time"
              title={<h3 className="text-[18px] font-semibold tracking-[-0.01em] text-fg">{metric.label}</h3>}
              onClose={() => setOpen(null)}
            >
              <GranularityToggle value={gran} trends={trends} onChange={setGran} />
            </DrawerHeader>

            <MetricPicker value={metric.key} onChange={setOpen} />

            {/* Remounted per metric/granularity so the hovered bucket resets. */}
            <MetricChart
              key={`${metric.key}-${gran}`}
              meta={metric}
              gran={gran}
              points={series}
            />

            <ChartMeta
              meta={metric}
              gran={gran}
              points={series}
              total={overview[metric.key]}
              scope={scope}
            />
          </>
        )}
      </BottomDrawer>
    </>
  );
}

/**
 * One stat tile. A button rather than a div, because it opens something — the
 * sparkline is the hint that there's a shape behind the number.
 *
 * When there's no series at all (empty store, or nothing captured yet) it
 * renders as the plain card it has always been: an empty drawer would be a
 * worse answer than no drawer.
 */
function StatTile({
  meta,
  value,
  spark,
  onOpen,
  dot,
}: {
  meta: MetricMeta;
  value: number;
  spark: number[];
  onOpen: (() => void) | null;
  dot: boolean;
}) {
  const body = (
    <>
      <div className={`flex items-center gap-1.5 ${labelCls}`}>
        {dot && <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${toneDot[meta.tone]}`} />}
        <span className="min-w-0 leading-tight">{meta.label}</span>
        <InfoTip text={meta.tip} focusable={false} />
      </div>
      <div className="mt-2 text-[26px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-fg">
        {/* A pinned locale: the tile is server-rendered, and the server's
            default locale needn't group digits the way the viewer's does
            (1,234 vs 1.234) — a hydration mismatch once a count passes 999. */}
        {value.toLocaleString("en-US")}
      </div>
      <Sparkline values={spark} accent={meta.accent} />
    </>
  );

  if (!onOpen) return <div className={`${card} px-4 pb-3 pt-4`}>{body}</div>;

  return (
    <button
      type="button"
      data-component="metric-tile"
      onClick={onOpen}
      aria-label={`${meta.label}: ${value.toLocaleString("en-US")} — open the chart over time`}
      className={`${card} group px-4 pb-3 pt-4 text-left transition-[border-color,background-color] hover:border-line-strong hover:bg-raised/40`}
    >
      {body}
    </button>
  );
}

/** The shape of the number, at tile size. Flat or empty series draw nothing. */
function Sparkline({ values, accent }: { values: number[]; accent: string }) {
  const peak = Math.max(...values, 0);
  if (values.length < 2 || peak === 0) return <div className="mt-3 h-7" />;

  const W = 60;
  const H = 28;
  const step = W / (values.length - 1);
  // A hair of headroom so the peak's stroke isn't clipped by the box.
  const y = (v: number) => (H - 1.5 - (v / peak) * (H - 3)).toFixed(2);
  const d = values.map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(2)},${y(v)}`).join(" ");

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="mt-3 h-7 w-full opacity-75 transition-opacity group-hover:opacity-100"
      aria-hidden
    >
      <path d={`${d} L${W},${H} L0,${H} Z`} style={{ fill: accent }} fillOpacity={0.1} />
      <path
        d={d}
        fill="none"
        style={{ stroke: accent }}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

// ── Drawer controls ──────────────────────────────────────────────────────────

const chip =
  "inline-flex h-7 items-center rounded-md px-2.5 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-30";

function GranularityToggle({
  value,
  trends,
  onChange,
}: {
  value: TrendGranularity;
  trends: MetricTrends;
  onChange: (g: TrendGranularity) => void;
}) {
  return (
    <div
      className="flex items-center gap-0.5 rounded-lg border border-line bg-sunken p-0.5"
      role="group"
      aria-label="Bucket size"
    >
      {(["hour", "day"] as const).map((g) => (
        <button
          key={g}
          type="button"
          data-component="metric-granularity"
          onClick={() => onChange(g)}
          disabled={trends[g].length === 0}
          aria-pressed={value === g}
          title={
            trends[g].length === 0
              ? `No ${GRAN_UNIT[g][1]} of data yet`
              : `Bucket by ${GRAN_UNIT[g][0]}`
          }
          className={`${chip} ${
            value === g
              ? "bg-raised text-fg shadow-[inset_0_0_0_1px_var(--pd-line-strong)]"
              : "text-fg-3 hover:text-fg"
          }`}
        >
          {GRAN_LABEL[g]}
        </button>
      ))}
    </div>
  );
}

/** Switch series without closing the drawer — all five are already loaded. */
function MetricPicker({
  value,
  onChange,
}: {
  value: MetricKey;
  onChange: (k: MetricKey) => void;
}) {
  return (
    <div className="mb-5 flex flex-wrap gap-1.5">
      {METRICS.map((m) => (
        <button
          key={m.key}
          type="button"
          data-component="metric-switch"
          onClick={() => onChange(m.key)}
          aria-pressed={value === m.key}
          className={`${chip} gap-1.5 border ${
            value === m.key
              ? "border-line-strong bg-raised text-fg"
              : "border-line text-fg-3 hover:border-line-strong hover:text-fg"
          }`}
        >
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: value === m.key ? m.accent : "var(--pd-fg-4)" }}
          />
          {m.label}
        </button>
      ))}
    </div>
  );
}

// ── The chart ────────────────────────────────────────────────────────────────

const W = 720;
const H = 240;
const PAD_L = 44;
const PAD_R = 14;
const PAD_T = 16;
const PAD_B = 34;
const PLOT_W = W - PAD_L - PAD_R;
const PLOT_H = H - PAD_T - PAD_B;

/**
 * Bars, not a line: each bucket is a count of things that happened inside a
 * window, and a line between two counts implies values in between that were
 * never measured. Zero-height bars are left as gridline-level ticks so a quiet
 * hour reads as measured-and-empty rather than missing.
 *
 * Interaction is one transparent overlay rather than per-bar handlers: pointer
 * position maps straight to a bucket index, so the reader gets a value
 * anywhere along the plot instead of only when they land on a thin bar. Arrow
 * keys walk the same index for anyone not using a pointer.
 */
function MetricChart({
  meta,
  gran,
  points,
}: {
  meta: MetricMeta;
  gran: TrendGranularity;
  points: MetricPoint[];
}) {
  const [active, setActive] = useState<number | null>(null);

  if (points.length === 0) {
    return (
      <p className={`${card} px-5 py-10 text-center text-[13px] text-fg-3`}>
        No {GRAN_UNIT[gran][0]}-level data yet.
      </p>
    );
  }

  const values = points.map((p) => p[meta.key]);
  const peak = Math.max(...values, 1);
  const { top, ticks } = yScale(peak);
  const n = points.length;
  const slot = PLOT_W / n;
  const barW = Math.min(slot * 0.62, 28);

  const xFor = (i: number) => PAD_L + slot * (i + 0.5);
  const yFor = (v: number) => PAD_T + PLOT_H - (v / top) * PLOT_H;

  // At most ~8 axis labels, so 48 hourly buckets don't collide into a smear.
  const labelStep = Math.max(1, Math.ceil(n / 8));
  const showLabel = (i: number) => i === n - 1 || (n - 1 - i) % labelStep === 0;

  const pointerIndex = (e: { clientX: number; currentTarget: Element }) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return null;
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.floor((x - PAD_L) / slot);
    return i < 0 || i >= n ? null : i;
  };

  const move = (delta: number) =>
    setActive((cur) => {
      const next = (cur === null ? n - 1 : cur) + delta;
      return Math.min(Math.max(next, 0), n - 1);
    });

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") move(-1);
    else if (e.key === "ArrowRight") move(1);
    else if (e.key === "Home") setActive(0);
    else if (e.key === "End") setActive(n - 1);
    else return;
    e.preventDefault();
  };

  const hovered = active === null ? null : points[active];
  // Keep the tooltip inside the card at both ends of the axis.
  const tipPct = active === null ? 50 : Math.min(Math.max((xFor(active) / W) * 100, 12), 88);

  return (
    // `pt-9` reserves a band above the plot for the readout. Floating it over
    // the bars instead would put it on top of whichever bar is tallest — which
    // is the one most worth looking at.
    <div className="relative pt-9">
      <div
        role="status"
        aria-live="polite"
        className={`pointer-events-none absolute inset-x-0 top-0 h-7 transition-opacity duration-100 ${
          hovered ? "opacity-100" : "opacity-0"
        }`}
      >
        <span
          className="absolute -translate-x-1/2 whitespace-nowrap rounded-lg border border-line-strong bg-overlay px-2.5 py-1.5 text-[12px] shadow-pop"
          style={{ left: `${tipPct}%` }}
        >
          {hovered && (
            <>
              <span className="text-fg-3">{hovered.title}</span>
              <span className="mx-1.5 text-fg-3">·</span>
              <span className="font-semibold tabular-nums text-fg">
                {plural(hovered[meta.key], meta.unit)}
              </span>
            </>
          )}
        </span>
      </div>

      {/* The focus ring sits on the card rather than the <svg>, so keyboard
          readers get a visible target without an outline tracing the plot. */}
      <div
        className={`${card} px-2 pb-2 pt-3 transition-[border-color,box-shadow] focus-within:border-accent/60 focus-within:ring-[3px] focus-within:ring-accent/15`}
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full outline-none"
          tabIndex={0}
          role="img"
          aria-label={`${meta.label} per ${GRAN_UNIT[gran][0]}, ${plural(n, GRAN_UNIT[gran])} ending ${points[n - 1].title}. Use the arrow keys to read individual buckets.`}
          onPointerMove={(e) => setActive(pointerIndex(e))}
          onPointerDown={(e) => setActive(pointerIndex(e))}
          onPointerLeave={() => setActive(null)}
          // A touch drag that turns into a page scroll cancels the pointer
          // without ever leaving the element, which would strand the readout.
          onPointerCancel={() => setActive(null)}
          onKeyDown={onKeyDown}
          onBlur={() => setActive(null)}
        >
          {/* y gridlines + ticks */}
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD_L}
                y1={yFor(t)}
                x2={W - PAD_R}
                y2={yFor(t)}
                strokeWidth={1}
                strokeDasharray={t === 0 ? undefined : "2 4"}
                style={{ stroke: t === 0 ? "var(--pd-line-strong)" : "var(--pd-line)" }}
              />
              <text
                x={PAD_L - 8}
                y={yFor(t) + 3.5}
                textAnchor="end"
                fontSize={10.5}
                className="fill-fg-3 tabular-nums"
              >
                {t.toLocaleString()}
              </text>
            </g>
          ))}

          {/* bars */}
          {points.map((p, i) => {
            const v = p[meta.key];
            const y = yFor(v);
            // A measured zero still gets a hairline, so it reads as "none here"
            // rather than as a bucket that was never recorded.
            const h = Math.max(PAD_T + PLOT_H - y, v === 0 ? 1 : 2);
            return (
              <rect
                key={p.ts}
                x={xFor(i) - barW / 2}
                y={PAD_T + PLOT_H - h}
                width={barW}
                height={h}
                rx={Math.min(3, barW / 3)}
                style={{ fill: v === 0 ? "var(--pd-line-strong)" : meta.accent }}
                fillOpacity={active === null || active === i ? 0.9 : 0.35}
                className="transition-[fill-opacity] duration-100"
              />
            );
          })}

          {/* x-axis labels */}
          {points.map((p, i) =>
            showLabel(i) ? (
              <text
                key={p.ts}
                x={xFor(i)}
                y={H - 12}
                textAnchor="middle"
                fontSize={10.5}
                className={active === i ? "fill-fg" : "fill-fg-3"}
              >
                {p.label}
              </text>
            ) : null,
          )}

          {/* hover guide */}
          {active !== null && (
            <line
              x1={xFor(active)}
              y1={PAD_T}
              x2={xFor(active)}
              y2={PAD_T + PLOT_H}
              strokeWidth={1}
              strokeDasharray="3 3"
              style={{ stroke: "var(--pd-fg-4)" }}
            />
          )}
        </svg>
      </div>
    </div>
  );
}

/**
 * What the chart adds up to. The tile's total and a capped window disagree by
 * design, so the difference is stated rather than left for the reader to spot.
 */
function ChartMeta({
  meta,
  gran,
  points,
  total: tileTotal,
  scope,
}: {
  meta: MetricMeta;
  gran: TrendGranularity;
  points: MetricPoint[];
  /** The tile's figure, over the tab's whole range. */
  total: number;
  /** That range in prose — "all time", "the last 7 days". */
  scope: string;
}) {
  if (points.length === 0) return null;

  const values = points.map((p) => p[meta.key]);
  const total = values.reduce((a, b) => a + b, 0);
  const peak = Math.max(...values);
  const peakAt = points[values.indexOf(peak)];
  const avg = total / values.length;
  const latest = values[values.length - 1];
  const unit = GRAN_UNIT[gran][0];

  return (
    <>
      <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4">
        {meta.additive ? (
          <Cell label={`Total (${plural(points.length, GRAN_UNIT[gran])})`} value={total.toLocaleString()} />
        ) : (
          <Cell label={`Busiest ${unit}`} value={peakAt.title} small />
        )}
        <Cell label={`Peak / ${unit}`} value={peak.toLocaleString()} />
        <Cell label={`Average / ${unit}`} value={avg >= 10 ? Math.round(avg).toLocaleString() : avg.toFixed(1)} />
        <Cell label={`Latest ${unit}`} value={latest.toLocaleString()} />
      </div>

      <p className="mt-3 text-[12px] leading-relaxed text-fg-3">
        {meta.additive && total < tileTotal
          ? `The tile counts ${scope} (${tileTotal.toLocaleString()}); this chart covers the last ${plural(points.length, GRAN_UNIT[gran])} of activity. `
          : ""}
        {!meta.additive
          ? "Buckets aren't summed here — a visitor active across several buckets is counted in each, so a total would count them more than once. "
          : ""}
        Buckets start at the UTC {unit}.
      </p>
    </>
  );
}

function Cell({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="bg-surface px-4 py-3">
      <div className={labelCls}>{label}</div>
      <div
        className={`mt-1 font-semibold tabular-nums text-fg ${small ? "text-[13px]" : "text-[18px] tracking-[-0.01em]"}`}
      >
        {value}
      </div>
    </div>
  );
}
