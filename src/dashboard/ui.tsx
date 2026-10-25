/**
 * Polishd — the dashboard's shared visual vocabulary.
 *
 * Class strings, small building blocks, icons and chart maths used by more
 * than one panel. They lived as copies in every file until the settings form
 * moved into its own tab and the copies started to drift; one definition is
 * what keeps the Analytics, Design and Settings tabs looking like the same
 * product.
 *
 * Every colour here is a token (`bg-surface`, `text-fg-3`, `border-line` …)
 * defined once in dashboard.css — nothing in a component names a hex.
 *
 * No `"use client"` here on purpose — plain constants, stateless SVG and
 * CSS-only hover/focus markup work in either environment, and the
 * server-rendered panels import them too.
 */
import type { ReactNode } from "react";

import { BOTTLE_DOTS, BOTTLE_VIEWBOX, WORDMARK } from "./brand-wordmark";

// ── Surfaces ─────────────────────────────────────────────────────────────────

export const border = "border-line";
export const card = "rounded-xl border border-line bg-surface shadow-card";
export const divider = "border-t border-line";
/** The strip across the top of a card: its title on the left, controls on the right. */
export const cardHeader =
  "flex min-h-12 items-center justify-between gap-3 border-b border-line px-4 py-2.5 sm:px-5";

// ── Type ─────────────────────────────────────────────────────────────────────

/** Quiet label: table headers, stat captions, metadata keys. */
export const labelCls = "text-[12px] font-medium text-fg-3";
/** Small caps over a title — drawer eyebrows and other one-word captions. */
export const eyebrowCls = "text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-3";
/** A card's own title, in its header strip. */
export const cardTitleCls = "text-[13px] font-semibold text-fg";
/** A form field's label. Brighter than `labelCls`: it's what you read first. */
export const fieldLabelCls = "text-[12px] font-medium text-fg-2";
/** A quiet aside after a field label. */
export const fieldHintCls = "text-[12px] text-fg-3";

// ── Controls ─────────────────────────────────────────────────────────────────

/** 16px on phones: iOS zooms the page into any field set smaller than that. */
export const inputCls =
  "w-full rounded-lg border border-line-strong bg-canvas px-3 py-2 text-[16px] sm:text-[13px] text-fg placeholder:text-fg-3 transition-[border-color,box-shadow] hover:border-fg-4 focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-50";
export const primaryBtn =
  "inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-accent px-3 text-[13px] font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-accent";
export const ghostBtn =
  "inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-line-strong bg-raised px-3 text-[13px] font-medium text-fg-2 transition-colors hover:border-fg-4 hover:bg-overlay hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line-strong disabled:hover:bg-raised disabled:hover:text-fg-2";
export const iconBtn =
  "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line-strong bg-raised text-fg-2 transition-colors hover:border-fg-4 hover:bg-overlay hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line-strong disabled:hover:bg-raised disabled:hover:text-fg-2";
export const microBtn =
  "inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-md border border-line-strong bg-raised px-2 text-[11px] font-medium text-fg-2 transition-colors hover:border-fg-4 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40";
/** An inline text link that reads as one without shouting. */
export const textLink =
  "font-medium text-fg-2 underline decoration-fg-4 underline-offset-[3px] transition-colors hover:text-fg hover:decoration-fg-3";

// ── Tones ────────────────────────────────────────────────────────────────────

export type Tone = "neutral" | "accent" | "ok" | "warn" | "bad" | "info" | "violet";

/** Tinted fill + matching text + a hairline ring, per tone. */
export const toneSoft: Record<Tone, string> = {
  neutral: "bg-raised text-fg-2 ring-line-strong",
  accent: "bg-accent/12 text-accent ring-accent/25",
  ok: "bg-ok/10 text-ok ring-ok/20",
  warn: "bg-warn/10 text-warn ring-warn/20",
  bad: "bg-bad/10 text-bad ring-bad/20",
  info: "bg-info/10 text-info ring-info/20",
  violet: "bg-violet/10 text-violet ring-violet/20",
};

export const toneText: Record<Tone, string> = {
  neutral: "text-fg-2",
  accent: "text-accent",
  ok: "text-ok",
  warn: "text-warn",
  bad: "text-bad",
  info: "text-info",
  violet: "text-violet",
};

export const toneDot: Record<Tone, string> = {
  neutral: "bg-fg-3",
  accent: "bg-accent",
  ok: "bg-ok",
  warn: "bg-warn",
  bad: "bg-bad",
  info: "bg-info",
  violet: "bg-violet",
};

/** A small label chip: a status, a kind, a count. */
export function Badge({
  tone = "neutral",
  mono = false,
  className = "",
  title,
  children,
}: {
  tone?: Tone;
  mono?: boolean;
  className?: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <span
      title={title}
      className={`inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-4 ring-1 ring-inset ${toneSoft[tone]} ${mono ? "font-mono" : ""} ${className}`}
    >
      {children}
    </span>
  );
}

/**
 * A status in a page header: a dot and a few words. `live` adds a slow pulse
 * for things that are actively happening, like capture.
 */
export function StatusPill({
  tone,
  live = false,
  children,
}: {
  tone: Tone;
  live?: boolean;
  children: ReactNode;
}) {
  return (
    <span className="inline-flex h-7 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-line bg-surface px-3 text-[12px] font-medium text-fg-2">
      <span className="relative flex h-1.5 w-1.5">
        {live && (
          <span
            className={`absolute inset-0 rounded-full opacity-60 motion-safe:animate-ping ${toneDot[tone]}`}
          />
        )}
        <span className={`relative h-1.5 w-1.5 rounded-full ${toneDot[tone]}`} />
      </span>
      {children}
    </span>
  );
}

/** A note in the flow of a page — a warning, a failure, a heads-up. */
export function Callout({
  tone,
  title,
  className = "",
  children,
}: {
  tone: "warn" | "bad" | "info" | "ok" | "neutral";
  title?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  const shell: Record<typeof tone, string> = {
    warn: "border-warn/25 bg-warn/[0.06]",
    bad: "border-bad/25 bg-bad/[0.06]",
    info: "border-info/25 bg-info/[0.06]",
    ok: "border-ok/25 bg-ok/[0.06]",
    neutral: "border-line bg-sunken",
  };
  const icon =
    tone === "ok" ? <CheckCircleIcon /> : tone === "neutral" || tone === "info" ? <InfoIcon /> : <AlertIcon />;
  return (
    <div
      className={`flex gap-3 rounded-xl border px-4 py-3 text-[13px] leading-relaxed text-fg-2 ${shell[tone]} ${className}`}
    >
      <span className={`mt-[3px] shrink-0 ${tone === "neutral" ? "text-fg-3" : toneText[tone]}`}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium text-fg">{title}</p>}
        {children && <div className={title ? "mt-1" : ""}>{children}</div>}
      </div>
    </div>
  );
}

/** Inline code inside prose and callouts. */
export function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-[5px] border border-line bg-raised px-1 py-px font-mono text-[0.9em] text-fg">
      {children}
    </code>
  );
}

// ── Page structure ───────────────────────────────────────────────────────────

/** Every tab opens the same way: what this is, then what you can do here. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-col gap-4 border-b border-line pb-6 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-[24px] font-semibold leading-tight text-fg">
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 max-w-2xl text-[14px] leading-relaxed text-fg-3">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">{actions}</div>
      )}
    </header>
  );
}

/**
 * A section's heading row. `description` sits under the title; `tip` is the
 * longer "how is this calculated" note behind an info icon.
 */
export function SectionHeader({
  title,
  tip,
  description,
  actions,
}: {
  title: ReactNode;
  tip?: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-3 flex min-h-8 flex-wrap items-end justify-between gap-x-3 gap-y-2">
      <div className="min-w-0">
        {/* The tip sits beside the heading, not inside it, so the heading's
            accessible name stays the title alone. */}
        <div className="flex items-center gap-1">
          <h2 className="text-[14px] font-semibold text-fg">{title}</h2>
          {tip && <InfoTip text={tip} anchor="left" />}
        </div>
        {description && (
          <p className="mt-0.5 max-w-3xl text-[12.5px] leading-relaxed text-fg-3">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </div>
  );
}

/** A labelled block of the page: heading row, then its card(s). */
export function Section({
  title,
  tip,
  description,
  actions,
  children,
}: {
  title: ReactNode;
  tip?: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mb-10">
      <SectionHeader title={title} tip={tip} description={description} actions={actions} />
      {children}
    </section>
  );
}

/** What a card says when it has nothing to show yet. */
export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="px-6 py-10 text-center text-[13px] leading-relaxed text-fg-3">
      <p className="mx-auto max-w-md">{children}</p>
    </div>
  );
}

/** "3m ago" — coarse on purpose; these timestamps are context, not data. */
export function relTime(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/**
 * A 0-based integer tick scale for a count axis.
 *
 * Counts are whole things — sessions, clicks, errors — so a "2.5 rage clicks"
 * gridline is a lie the reader has to decode. This picks a whole-number step
 * that lands on about four gridlines and returns the top of the axis with it.
 */
export function yScale(peak: number): { top: number; ticks: number[] } {
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

/**
 * The little "i" that explains how a number is calculated.
 *
 * Pure CSS — no state, no event handlers — so the server-rendered panels and
 * the client ones can share this one definition. It opens on hover and on
 * keyboard focus alike; the text doubles as the trigger's accessible name, so
 * a screen reader hears it without the visual card. Pass `focusable={false}`
 * where it sits inside another control (a stat tile is a button), which can't
 * legally contain a second tab stop.
 */
export function InfoTip({
  text,
  anchor = "center",
  below = false,
  focusable = true,
}: {
  text: string;
  anchor?: "left" | "center" | "right";
  below?: boolean;
  focusable?: boolean;
}) {
  const anchorClass =
    anchor === "left" ? "-left-2" : anchor === "right" ? "-right-2" : "left-1/2 -translate-x-1/2";
  const vClass = below ? "top-full mt-2" : "bottom-full mb-2";
  return (
    <span
      tabIndex={focusable ? 0 : undefined}
      aria-label={focusable ? text : undefined}
      className="group/tip relative inline-flex shrink-0 cursor-help items-center rounded-full align-middle text-fg-3 transition-colors hover:text-fg-2 focus-visible:text-fg-2"
    >
      <InfoIcon size={13} />
      <span
        role="tooltip"
        aria-hidden
        className={`pointer-events-none invisible absolute ${vClass} ${anchorClass} z-30 w-64 max-w-[calc(100vw-2rem)] translate-y-0.5 rounded-lg border border-line-strong bg-overlay px-3 py-2 text-left text-[12px] font-normal normal-case leading-snug tracking-normal text-fg-2 opacity-0 shadow-pop transition-[opacity,transform,visibility] duration-150 group-hover/tip:visible group-hover/tip:translate-y-0 group-hover/tip:opacity-100 group-focus-visible/tip:visible group-focus-visible/tip:translate-y-0 group-focus-visible/tip:opacity-100`}
      >
        {text}
      </span>
    </span>
  );
}

// ── Icons (Lucide/Feather geometry, inlined) ─────────────────────────────────

function Svg({
  size = 14,
  strokeWidth = 2,
  className,
  children,
}: {
  size?: number;
  strokeWidth?: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {children}
    </svg>
  );
}

type IconProps = { size?: number };

export function RefreshIcon({ spinning = false, size }: { spinning?: boolean } & IconProps) {
  return (
    <Svg size={size} className={spinning ? "animate-spin" : undefined}>
      <path d="M21 12a9 9 0 0 1-15.2 6.5L3 16" />
      <path d="M3 21v-5h5" />
      <path d="M3 12a9 9 0 0 1 15.2-6.5L21 8" />
      <path d="M21 3v5h-5" />
    </Svg>
  );
}

export function GearIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  );
}

/** Switch to light. */
export function SunIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </Svg>
  );
}

/** Switch to dark. */
export function MoonIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </Svg>
  );
}

/** The Overview: four panes, one page. */
export function GridIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </Svg>
  );
}

export function CopyIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <rect x="8" y="8" width="14" height="14" rx="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </Svg>
  );
}

export function CheckIcon({ size }: IconProps) {
  return (
    <Svg size={size} strokeWidth={2.5}>
      <polyline points="20 6 9 17 4 12" />
    </Svg>
  );
}

export function ChartIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M3 3v16a2 2 0 0 0 2 2h16" />
      <path d="M7 16v-3" />
      <path d="M12 16V8" />
      <path d="M17 16v-6" />
    </Svg>
  );
}

export function DropletIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z" />
    </Svg>
  );
}

export function GlobeIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </Svg>
  );
}

/** GitHub's issue glyph: a ring with a dot in it. */
export function IssueIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/** The tab rail's in-flight marker: same box as the icon it replaces. */
export function SpinnerIcon({ size }: IconProps) {
  return (
    <Svg size={size} strokeWidth={2.5} className="animate-spin">
      <circle cx="12" cy="12" r="9" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" />
    </Svg>
  );
}

export function InfoIcon({ size = 14 }: IconProps) {
  return (
    <Svg size={size}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </Svg>
  );
}

export function AlertIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </Svg>
  );
}

export function CheckCircleIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </Svg>
  );
}

export function XIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </Svg>
  );
}

export function XCircleIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <circle cx="12" cy="12" r="10" />
      <path d="m15 9-6 6" />
      <path d="m9 9 6 6" />
    </Svg>
  );
}

export function ChevronRightIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="m9 18 6-6-6-6" />
    </Svg>
  );
}

export function ChevronLeftIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="m15 18-6-6 6-6" />
    </Svg>
  );
}

export function ChevronDownIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="m6 9 6 6 6-6" />
    </Svg>
  );
}

export function ArrowRightIcon({ size = 12 }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </Svg>
  );
}

export function ArrowUpRightIcon({ size = 12 }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M7 7h10v10" />
      <path d="M7 17 17 7" />
    </Svg>
  );
}

export function ClockIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </Svg>
  );
}

export function DownloadIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" x2="12" y1="15" y2="3" />
    </Svg>
  );
}

export function LockIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </Svg>
  );
}

export function SparkIcon({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M9.94 14.06 2 12l7.94-2.06L12 2l2.06 7.94L22 12l-7.94 2.06L12 22z" />
    </Svg>
  );
}

/**
 * Polishd's logo: the landing site's hero wordmark. "polis" and "d" in the
 * site's highway face, and for the h, the halftone shoe-polish bottle whose
 * dots shimmer in a slow wave (the animation lives in dashboard.css, scoped to
 * `.pd-bottle`, and stops under reduced motion). Outlines, not a font, so it
 * needs nothing loaded and reads the same in every host. Ink is currentColor.
 */
export function BrandWordmark({ height = 28, className = "" }: { height?: number; className?: string }) {
  const { width: w, height: h, letters, bottle } = WORDMARK;
  const [vx, vy, , vh] = BOTTLE_VIEWBOX;
  const scale = bottle.height / vh;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width={(height * w) / h}
      height={height}
      role="img"
      aria-label="Polishd"
      className={`block shrink-0 text-fg ${className}`}
    >
      <path d={letters} fill="currentColor" fillRule="evenodd" />
      <g
        className="pd-bottle"
        fill="currentColor"
        transform={`translate(${bottle.x - vx * scale} ${bottle.y - vy * scale}) scale(${scale})`}
      >
        {BOTTLE_DOTS.map(([cx, cy, r, delay]) => (
          <circle key={`${cx},${cy}`} cx={cx} cy={cy} r={r} style={{ animationDelay: `${delay}s` }} />
        ))}
      </g>
    </svg>
  );
}
