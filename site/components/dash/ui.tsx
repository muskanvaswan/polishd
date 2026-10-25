import type { ReactNode } from "react";

import { AlertIcon, CheckIcon, InfoIcon } from "@/components/dash/icons";

/**
 * The dashboard's visual vocabulary, replicated for the page's infographics.
 *
 * Class strings and small blocks lifted from src/dashboard/ui.tsx: the same
 * card, header strip, badges, buttons and tone system, on the same tokens
 * (`bg-surface`, `text-fg-3`, `border-line` … defined in globals.css). The
 * controls here are pictures of controls — spans, not buttons — so they never
 * read as interactive to a keyboard or a screen reader.
 */

// ── Surfaces ─────────────────────────────────────────────────────────────────

export const card = "rounded-xl border border-line bg-surface shadow-card";
export const divider = "border-t border-line";
/** The strip across the top of a card: its title on the left, controls on the right. */
export const cardHeader =
  "flex min-h-12 items-center justify-between gap-3 border-b border-line px-4 py-2.5 sm:px-5";

// ── Type ─────────────────────────────────────────────────────────────────────

export const labelCls = "text-[12px] font-medium text-fg-3";
export const eyebrowCls = "text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-3";
export const cardTitleCls = "text-[13px] font-semibold text-fg";

// ── Controls (illustrative) ──────────────────────────────────────────────────

const primaryBtn =
  "inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-accent px-3 text-[13px] font-medium text-accent-fg";
const ghostBtn =
  "inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-line-strong bg-raised px-3 text-[13px] font-medium text-fg-2";
const iconBtn =
  "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line-strong bg-raised text-fg-2";
const microBtn =
  "inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-md border border-line-strong bg-raised px-2 text-[11px] font-medium text-fg-2";

type BtnProps = { children: ReactNode; className?: string };

export function PrimaryBtn({ children, className = "" }: BtnProps) {
  return <span className={`${primaryBtn} ${className}`}>{children}</span>;
}
export function GhostBtn({ children, className = "" }: BtnProps) {
  return <span className={`${ghostBtn} ${className}`}>{children}</span>;
}
export function IconBtn({ children, className = "" }: BtnProps) {
  return (
    <span aria-hidden className={`${iconBtn} ${className}`}>
      {children}
    </span>
  );
}
export function MicroBtn({ children, className = "" }: BtnProps) {
  return <span className={`${microBtn} ${className}`}>{children}</span>;
}

// ── Tones ────────────────────────────────────────────────────────────────────

export type Tone = "neutral" | "accent" | "ok" | "warn" | "bad" | "info" | "violet";

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

const SHOW_FROM = { sm: "sm:flex", lg: "lg:flex", xl: "xl:flex" } as const;

/** A small label chip: a status, a kind, a count. */
export function Badge({
  tone = "neutral",
  mono = false,
  showFrom,
  className = "",
  children,
}: {
  tone?: Tone;
  mono?: boolean;
  /** Hidden below this breakpoint — a card header's second chip on a phone. */
  showFrom?: keyof typeof SHOW_FROM;
  className?: string;
  children: ReactNode;
}) {
  const badge = (
    <span
      className={`inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-4 ring-1 ring-inset ${toneSoft[tone]} ${mono ? "font-mono" : ""} ${className}`}
    >
      {children}
    </span>
  );
  // The badge's own `inline-flex` would win a tie with `hidden`, so the
  // breakpoint lives on a wrapper.
  if (!showFrom) return badge;
  return <span className={`hidden min-w-0 ${SHOW_FROM[showFrom]}`}>{badge}</span>;
}

/** A status in a page header: a dot and a few words. */
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
          <span className={`absolute inset-0 rounded-full opacity-60 motion-safe:animate-ping ${toneDot[tone]}`} />
        )}
        <span className={`relative h-1.5 w-1.5 rounded-full ${toneDot[tone]}`} />
      </span>
      {children}
    </span>
  );
}

/** A note in the flow of a card — a warning, a heads-up. */
export function Callout({
  tone,
  className = "",
  children,
}: {
  tone: "warn" | "bad" | "info" | "ok" | "neutral";
  className?: string;
  children: ReactNode;
}) {
  const shell: Record<typeof tone, string> = {
    warn: "border-warn/25 bg-warn/[0.06]",
    bad: "border-bad/25 bg-bad/[0.06]",
    info: "border-info/25 bg-info/[0.06]",
    ok: "border-ok/25 bg-ok/[0.06]",
    neutral: "border-line bg-sunken",
  };
  const icon =
    tone === "ok" ? <CheckIcon /> : tone === "neutral" || tone === "info" ? <InfoIcon size={14} /> : <AlertIcon />;
  return (
    <div
      className={`flex gap-3 rounded-xl border px-4 py-3 text-[12.5px] leading-relaxed text-fg-2 ${shell[tone]} ${className}`}
    >
      <span className={`mt-[3px] shrink-0 ${tone === "neutral" ? "text-fg-3" : toneText[tone]}`}>{icon}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** A hex the way the dashboard cites one: a swatch beside the code. */
export function ColorToken({ hex }: { hex: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-[5px] border border-line-strong bg-raised px-1 py-px align-middle font-mono text-[11.5px] text-fg-2">
      <span
        aria-hidden
        className="h-2.5 w-2.5 shrink-0 rounded-[3px] ring-1 ring-inset ring-fg/20"
        style={{ backgroundColor: hex }}
      />
      {hex}
    </span>
  );
}

/** White on black — the top of the WCAG 2.x scale. */
const MAX_RATIO = 21;

/** A WCAG ratio as the dashboard's 0–100% contrast score: 4.5:1 is 49%. */
export function contrastPercent(ratio: number): number {
  const clamped = Math.min(Math.max(ratio, 1), MAX_RATIO);
  return Math.round((Math.log(clamped) / Math.log(MAX_RATIO)) * 100);
}

/** A ratio as a contrast score, tinted only when it's a problem. */
export function ContrastToken({ ratio }: { ratio: number }) {
  const tone =
    ratio >= 4.5
      ? "bg-raised text-fg-2 ring-line-strong"
      : ratio >= 3
        ? "bg-warn/10 text-warn ring-warn/20"
        : "bg-bad/10 text-bad ring-bad/20";
  return (
    <span
      className={`inline-flex items-center rounded-[5px] px-1 py-px align-middle text-[11.5px] font-medium tabular-nums ring-1 ring-inset ${tone}`}
    >
      {contrastPercent(ratio)}% contrast
    </span>
  );
}

/** The measured pairing as a scale, with a tick at the level the text needs. */
export function ContrastMeter({ ratio, required }: { ratio: number; required: number }) {
  const pct = contrastPercent(ratio);
  const need = contrastPercent(required);
  const passes = ratio >= required;
  return (
    <span className="flex items-center gap-2">
      <span className="relative h-1.5 w-24 rounded-full bg-raised">
        <span
          className={`absolute inset-y-0 left-0 rounded-full ${passes ? "bg-ok" : "bg-bad"}`}
          style={{ width: `${pct}%` }}
        />
        <span className="absolute -inset-y-0.5 w-0.5 rounded-full bg-fg-2" style={{ left: `${need}%` }} />
      </span>
      <span className={`w-9 text-[12.5px] font-semibold tabular-nums ${passes ? "text-ok" : "text-bad"}`}>
        {pct}%
      </span>
    </span>
  );
}
