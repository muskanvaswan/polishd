import type { ReactNode } from "react";

import { InfoIcon } from "@/components/dash/icons";
import { card, labelCls, toneDot, type Tone } from "@/components/dash/ui";

/**
 * The dashboard's stat tiles: a label with its tone dot, the all-time count,
 * and the shape of that count over time as a sparkline. Counts carry
 * `data-count`, so the page's scroll observer counts them up on reveal, and
 * the sparklines draw in with them (globals.css, `.spark`).
 */

const ACCENT: Partial<Record<Tone, string>> = {
  accent: "var(--color-accent)",
  bad: "var(--color-bad)",
  warn: "var(--color-warn)",
  ok: "var(--color-ok)",
};

export function Sparkline({ values, tone = "accent" }: { values: number[]; tone?: Tone }) {
  const W = 60;
  const H = 28;
  const peak = Math.max(...values, 1);
  const step = W / (values.length - 1);
  const y = (v: number) => (H - 1.5 - (v / peak) * (H - 3)).toFixed(2);
  const d = values.map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(2)},${y(v)}`).join(" ");
  const stroke = ACCENT[tone] ?? ACCENT.accent;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="spark mt-3 h-7 w-full opacity-75"
      aria-hidden
    >
      <path className="area" d={`${d} L${W},${H} L0,${H} Z`} style={{ fill: stroke }} fillOpacity={0.1} />
      <path
        className="line"
        d={d}
        pathLength={1}
        fill="none"
        style={{ stroke }}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function StatTile({
  label,
  value,
  tone = "accent",
  spark,
  note,
  dot = true,
  className = "",
}: {
  label: string;
  /** A number counts up on reveal; a string is shown as written. */
  value: number | string;
  tone?: Tone;
  spark?: number[];
  /** One quiet line where a tile without a series would draw its sparkline. */
  note?: ReactNode;
  dot?: boolean;
  className?: string;
}) {
  return (
    <div className={`${card} px-4 pb-3 pt-4 ${className}`}>
      <div className={`flex items-center gap-1.5 ${labelCls}`}>
        {dot && <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${toneDot[tone]}`} />}
        <span className="min-w-0 leading-tight">{label}</span>
        {/* Three tiles share a phone's width: the label keeps its room, the tip goes. */}
        <span className="hidden text-fg-3 sm:inline-flex">
          <InfoIcon />
        </span>
      </div>
      <div
        className="mt-2 text-[26px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-fg"
        data-count={typeof value === "number" ? value : undefined}
      >
        {typeof value === "number" ? value.toLocaleString("en-US") : value}
      </div>
      {spark ? (
        <Sparkline values={spark} tone={tone} />
      ) : (
        <div className="mt-3 flex min-h-7 items-end pb-0.5 text-[12px] leading-snug text-fg-3">{note}</div>
      )}
    </div>
  );
}
