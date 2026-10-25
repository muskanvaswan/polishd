import type { ReactNode } from "react";

import type { StageStatus } from "@/lib/loop";

/**
 * Stage status, in one place — the ring, the stage cards and the frontier
 * section all read from here so the two labels can never drift apart.
 */
export function StatusChip({
  status,
  dot = false,
  className = "",
}: {
  status: StageStatus;
  dot?: boolean;
  className?: string;
}) {
  const coming = status === "coming";
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-[3px] text-[9.5px] font-semibold uppercase tracking-[0.09em] ${
        coming ? "bg-warn/10 text-warn ring-1 ring-inset ring-warn/20" : "bg-ok/10 text-ok ring-1 ring-inset ring-ok/20"
      } ${className}`}
    >
      {dot && <span className="h-[5px] w-[5px] rounded-full bg-current" />}
      {coming ? "Coming soon" : "Live now"}
    </span>
  );
}

/** Page gutter — everything sits on this 1080px measure. */
export function Wrap({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`relative z-2 mx-auto w-full max-w-[1080px] px-6 ${className}`}>
      {children}
    </div>
  );
}

/**
 * The dashboard's eyebrow: 11px, uppercase, 0.08em, fg-3. `atLoad` reveals it
 * on first paint rather than on scroll — for the hero, already in view.
 */
export function Eyebrow({ children, atLoad = false }: { children: ReactNode; atLoad?: boolean }) {
  return (
    <p className={`label ${atLoad ? "r-load" : "r"} flex items-center gap-2`}>
      <span className="inline-block h-[5px] w-[5px] rounded-full bg-fg-4" />
      {children}
    </p>
  );
}

export function Pill({
  children,
  tone = "emerald",
  className = "",
}: {
  children: ReactNode;
  tone?: "emerald" | "amber";
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-[3px] text-[10px] font-semibold uppercase tracking-[0.09em] ${
        tone === "amber" ? "bg-warn/10 text-warn ring-1 ring-inset ring-warn/20" : "bg-ok/10 text-ok ring-1 ring-inset ring-ok/20"
      } ${className}`}
    >
      <span className="blip h-[5px] w-[5px] rounded-full bg-current" />
      {children}
    </span>
  );
}

export function GhostLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      rel="noopener"
      className="group inline-flex items-center gap-2 rounded-[10px] border border-line px-4 py-3 text-[13px] text-fg-3 transition-[color,border-color,scale] duration-150 ease-out hover:border-fg-4 hover:text-fg active:scale-[0.97]"
    >
      {children}
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-[13px] w-[13px] transition-transform duration-200 ease-out group-hover:translate-x-px group-hover:-translate-y-px"
        aria-hidden
      >
        <path d="M4 12 12 4M6 4h6v6" />
      </svg>
    </a>
  );
}

/** Section heading — 2nd line dimmed to fg-4, the way the dashboard dims secondary text. */
export function Heading({
  children,
  delay = 60,
}: {
  children: ReactNode;
  delay?: number;
}) {
  return (
    <h2
      className="r font-heading mt-[18px] max-w-[19ch] text-[clamp(28px,4.6vw,50px)] font-semibold leading-[1.04] tracking-[0.005em]"
      style={{ "--d": `${delay}ms` } as React.CSSProperties}
    >
      {children}
    </h2>
  );
}

export function Sub({ children, delay = 120 }: { children: ReactNode; delay?: number }) {
  return (
    <p
      className="r mt-[18px] max-w-[56ch] font-mono text-[13px] leading-[1.7] text-fg-3"
      style={{ "--d": `${delay}ms` } as React.CSSProperties}
    >
      {children}
    </p>
  );
}
