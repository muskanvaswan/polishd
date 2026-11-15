import type { CSSProperties, ReactNode } from "react";

/** The page's small vocabulary: width, section heads, the one slide, links that look like buttons. */

export const d = (ms: number) => ({ "--d": `${ms}ms` }) as CSSProperties;

export function Wrap({ children, className = "", wide = false }: { children: ReactNode; className?: string; wide?: boolean }) {
  return (
    <div className={`relative mx-auto w-full px-5 sm:px-6 ${wide ? "max-w-[1240px]" : "max-w-[1080px]"} ${className}`}>
      {children}
    </div>
  );
}

/**
 * A section's heading. No label sits above it. Where it has two lines, the
 * first sets up and the second is the point, so the second is the bright one.
 */
export function SectionHead({
  lead,
  title,
  sub,
  center = false,
  className = "",
}: {
  lead?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  center?: boolean;
  className?: string;
}) {
  return (
    <div className={`${center ? "mx-auto flex flex-col items-center text-center" : ""} ${className}`}>
      <h2 className="r max-w-[22ch] text-balance font-heading text-[clamp(32px,4.6vw,56px)] font-semibold leading-[1.02] tracking-[0.005em] text-fg-2">
        {lead ? <span className="block">{lead}</span> : null}
        <span className="sheen block">{title}</span>
      </h2>
      {sub ? (
        <p className={`r prose-sub mt-5 max-w-[60ch] text-pretty ${center ? "mx-auto" : ""}`} style={d(80)}>
          {sub}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The one section that is a slide: on a screen big enough it is exactly the
 * viewport, a bento with the headline as one of its cells. Used by
 * "Building got fast. Finishing didn't." and nowhere else.
 */
export function Slide({
  id,
  label,
  children,
  className = "",
  innerClassName = "",
}: {
  id?: string;
  label: string;
  children: ReactNode;
  className?: string;
  innerClassName?: string;
}) {
  return (
    <section id={id} aria-label={label} className={`slide ${className}`}>
      <div className={`slide-in ${innerClassName}`}>{children}</div>
    </section>
  );
}

/** The slide's headline: the same two lines as SectionHead, sized to the slide. */
export function Headline({
  lead,
  children,
  as: Tag = "h2",
  className = "",
}: {
  lead?: ReactNode;
  children: ReactNode;
  as?: "h1" | "h2" | "p";
  className?: string;
}) {
  return (
    <Tag className={`h-slide ${className}`}>
      {lead ? <span className="block">{lead}</span> : null}
      <span className="key sheen">{children}</span>
    </Tag>
  );
}

/** The white primary button, as a link. */
export function PrimaryLink({ href, children, className = "", external = false }: { href: string; children: ReactNode; className?: string; external?: boolean }) {
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noopener" } : {})}
      className={`group inline-flex h-[46px] items-center gap-2 rounded-[10px] bg-fg px-5 font-chart text-[14px] font-semibold text-black transition-[background-color,scale,box-shadow] duration-150 ease-out hover:bg-white hover:shadow-[0_0_0_4px_rgba(255,255,255,.08),0_0_40px_rgba(245,230,200,.25)] active:scale-[0.97] ${className}`}
    >
      {children}
    </a>
  );
}

export function GhostLink({ href, children, className = "", external = false }: { href: string; children: ReactNode; className?: string; external?: boolean }) {
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noopener" } : {})}
      className={`group inline-flex h-[46px] items-center gap-2 rounded-[10px] border border-line-strong bg-surface/60 px-5 font-chart text-[14px] font-medium text-fg-2 transition-[color,border-color,background-color,scale] duration-150 ease-out hover:border-fg-4 hover:bg-raised hover:text-fg active:scale-[0.97] ${className}`}
    >
      {children}
    </a>
  );
}

export function Arrow({ up = false }: { up?: boolean }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`transition-transform duration-200 ease-[var(--ease-out)] ${up ? "group-hover:-translate-y-0.5 group-hover:translate-x-0.5" : "group-hover:translate-x-0.5"}`}
    >
      {up ? <path d="M5 11L11 5M6 5h5v5" /> : <path d="M3 8h10M9 4l4 4-4 4" />}
    </svg>
  );
}

/** Live / Coming, as the dashboard draws a status. */
export function Status({ live }: { live: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] ring-1 ring-inset ${
        live ? "bg-ok/10 text-ok ring-ok/20" : "bg-warn/10 text-warn ring-warn/20"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-ok blip" : "border border-warn"}`} />
      {live ? "Live" : "Coming"}
    </span>
  );
}
