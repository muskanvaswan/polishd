"use client";

/**
 * Polishd — a wrapping row that fills the line before it collapses.
 *
 * The Design tab's chip strips (radii, palette) used to hide everything past a
 * fixed count, which meant the sixth chip dropped behind "Show more" while half
 * the row sat empty. The server can't know how many chips fit — that depends on
 * the viewport — so this measures the laid-out row in the browser: everything on
 * the first line stays, the rest is clipped away and counted into the toggle.
 *
 * The overflow items stay in the DOM and keep their layout (the row is clipped
 * with `height`, not `display: none`), so re-measuring after a resize needs no
 * flash of expanded content.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** Measure before paint in the browser; `useLayoutEffect` warns during SSR. */
const useBeforePaint = typeof window === "undefined" ? useEffect : useLayoutEffect;

interface Fit {
  /** Height of the first line, in px — what the row is clipped to. */
  height: number;
  /** How many items wrapped past it. */
  hidden: number;
}

/**
 * Row membership by x-position, not by y: with `items-end` (the radius chips)
 * items on one line share a bottom but not a top, so a top comparison would
 * read a tall chip as its own row. In a wrapping flex row every line restarts
 * at the container's left edge, and that holds whatever the alignment is.
 */
function measureFirstLine(row: HTMLElement): Fit | null {
  const items = Array.from(row.children) as HTMLElement[];
  // A zero-width row means it isn't laid out (hidden ancestor); every item
  // would read as a wrap onto line two. Nothing measured beats a wrong answer.
  if (items.length === 0 || row.getBoundingClientRect().width === 0) return null;
  const rowTop = row.getBoundingClientRect().top;
  const firstLeft = items[0].getBoundingClientRect().left;
  let height = 0;
  for (let i = 0; i < items.length; i++) {
    const box = items[i].getBoundingClientRect();
    if (i > 0 && box.left <= firstLeft + 0.5) return { height: Math.ceil(height), hidden: items.length - i };
    height = Math.max(height, box.bottom - rowTop);
  }
  return { height: Math.ceil(height), hidden: 0 };
}

export default function OverflowRow({
  label,
  className,
  rowClassName,
  children,
}: {
  /** What the items are, plural — "radii", "colors". */
  label: string;
  /** Classes for the padded wrapper; the clipped row sits inside it. */
  className?: string;
  /** Classes for the wrapping flex row itself. */
  rowClassName: string;
  children: ReactNode;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [fit, setFit] = useState<Fit | null>(null);

  const measure = useCallback(() => {
    if (!rowRef.current) return;
    const next = measureFirstLine(rowRef.current);
    if (next === null) return;
    // Collapsing shrinks the wrapper, which wakes the observer again — bail on
    // an unchanged result so that echo stops at one render instead of looping.
    setFit((prev) =>
      prev && prev.height === next.height && prev.hidden === next.hidden ? prev : next,
    );
  }, []);

  useBeforePaint(() => {
    measure();
    const row = rowRef.current;
    if (!row || typeof ResizeObserver === "undefined") return;
    // The row's own height is pinned while collapsed, so watch the wrapper —
    // it still tracks the viewport.
    const observer = new ResizeObserver(measure);
    if (row.parentElement) observer.observe(row.parentElement);
    return () => observer.disconnect();
  }, [measure]);

  // Web fonts land after first paint and change chip widths under us.
  useEffect(() => {
    const fonts = document.fonts;
    if (!fonts) return;
    let live = true;
    fonts.ready.then(() => {
      if (live) measure();
    });
    return () => {
      live = false;
    };
  }, [measure]);

  const collapsed = fit !== null && fit.hidden > 0 && !open;
  return (
    <>
      <div className={className}>
        <div
          ref={rowRef}
          className={rowClassName}
          style={collapsed ? { height: fit.height, overflow: "hidden" } : undefined}
        >
          {children}
        </div>
      </div>
      {fit !== null && fit.hidden > 0 && (
        <div className="mt-4 border-t border-[#2e2e2e] px-4 py-2.5 sm:px-5">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="text-[11px] font-medium text-[#888] transition-colors hover:text-white"
          >
            {open ? "Show less ↑" : `Show ${fit.hidden} more ${label} ↓`}
          </button>
        </div>
      )}
    </>
  );
}
