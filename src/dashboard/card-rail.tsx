"use client";

/**
 * Polishd — a horizontally scrolling row of finding cards.
 *
 * The AI cards' actionable findings — the summary's losses, the design review's
 * issues — used to sit in a column beside the wins, and every one carries
 * evidence, a source location and its own buttons. Six of them made a list
 * longer than the rest of the card put together, so the things you're meant to
 * act on were the things you had to scroll past. A row keeps the card one
 * height however many findings there are, and gives each finding room to be a
 * unit: its evidence above, its actions pinned to the bottom.
 *
 * The row bleeds to the card's edges (the cards scroll under the padding rather
 * than stopping short of it), so the next card is visibly cut off at the edge,
 * and grows arrow buttons only once it actually overflows.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { ChevronLeftIcon, ChevronRightIcon } from "./ui";

/** Measure before paint in the browser; `useLayoutEffect` warns during SSR. */
const useBeforePaint = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * One finding's box. Fixed width so the row reads as a set; `min` keeps a
 * sliver of the next card in view on a phone, which is the cue that it scrolls.
 */
export const railCard =
  "flex w-[min(19rem,85%)] shrink-0 snap-start flex-col rounded-xl border border-line bg-sunken p-3.5 text-[13px] leading-snug";

interface Edges {
  /** Content hidden off the left edge. */
  before: boolean;
  /** Content hidden off the right edge. */
  after: boolean;
}

export default function CardRail({
  label,
  tone,
  count,
  children,
}: {
  /** The row's heading — "Losses", "Breaking the system". */
  label: string;
  /** Colour of the heading's marker dot, matching the finding's marker. */
  tone: string;
  count: number;
  /** The cards, each an `<li>` styled with `railCard`. */
  children: ReactNode;
}) {
  const scroller = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState<Edges>({ before: false, after: false });

  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    // A pixel of slack: fractional widths leave scrollLeft a hair short of the end.
    const next = {
      before: el.scrollLeft > 1,
      after: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
    };
    setEdges((prev) => (prev.before === next.before && prev.after === next.after ? prev : next));
  }, []);

  useBeforePaint(() => {
    measure();
    const el = scroller.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    // Cards change height (and the row its width) when one is ignored or files
    // a bug, so watch the list's children as well as the list.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [measure, count]);

  const page = (direction: 1 | -1) => {
    const el = scroller.current;
    if (!el) return;
    // Most of a viewport, so the card at the far edge stays in view as context.
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: "smooth" });
  };

  const overflowing = edges.before || edges.after;

  return (
    <div className="mt-5">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-fg">
          <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${tone}`} />
          {label}
          <span className="rounded-md bg-raised px-1.5 py-px text-[11px] font-medium tabular-nums text-fg-3 ring-1 ring-inset ring-line-strong">
            {count}
          </span>
        </div>
        {overflowing && (
          <div className="flex items-center gap-1">
            <RailButton direction={-1} disabled={!edges.before} onClick={() => page(-1)} />
            <RailButton direction={1} disabled={!edges.after} onClick={() => page(1)} />
          </div>
        )}
      </div>
      <div className="relative -mx-4 sm:-mx-5">
        {/* Focusable once it overflows, so the arrow keys can scroll it. The
            ring is inset: the row spans the card edge to edge, and the card's
            `overflow-hidden` would clip an outer one. */}
        <ul
          ref={scroller}
          onScroll={measure}
          tabIndex={overflowing ? 0 : undefined}
          aria-label={label}
          className="flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:thin] focus-visible:-outline-offset-2 sm:scroll-px-5 sm:px-5"
        >
          {children}
        </ul>
      </div>
    </div>
  );
}

function RailButton({
  direction,
  disabled,
  onClick,
}: {
  direction: 1 | -1;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={direction === 1 ? "Scroll to later findings" : "Scroll to earlier findings"}
      className="flex h-7 w-7 items-center justify-center rounded-lg border border-line-strong bg-raised text-fg-2 transition-colors hover:border-fg-4 hover:text-fg disabled:cursor-not-allowed disabled:opacity-30"
    >
      {direction === 1 ? <ChevronRightIcon size={14} /> : <ChevronLeftIcon size={14} />}
    </button>
  );
}
