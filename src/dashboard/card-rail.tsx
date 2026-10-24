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
 * than stopping short of it), fades whichever side has more to show, and grows
 * arrow buttons only once it actually overflows.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { labelCls } from "./ui";

/** Measure before paint in the browser; `useLayoutEffect` warns during SSR. */
const useBeforePaint = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * One finding's box. Fixed width so the row reads as a set; `min` keeps a
 * sliver of the next card in view on a phone, which is the cue that it scrolls.
 */
export const railCard =
  "flex w-[min(18.5rem,85%)] shrink-0 snap-start flex-col rounded-md border border-[#2e2e2e] bg-[#0d0d0d] p-3 text-[13px] leading-snug";

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
  /** Text color class for the heading, matching the finding's marker. */
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
        <div className={`${labelCls} ${tone} flex items-center gap-2`}>
          {label}
          <span className="rounded-full bg-[#1a1a1a] px-1.5 py-px text-[10px] tabular-nums tracking-normal text-[#888]">
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
          className="flex snap-x snap-mandatory scroll-px-4 gap-2.5 overflow-x-auto px-4 pb-2 [scrollbar-color:#2e2e2e_transparent] [scrollbar-width:thin] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#555] sm:scroll-px-5 sm:px-5"
        >
          {children}
        </ul>
        <Fade side="left" visible={edges.before} />
        <Fade side="right" visible={edges.after} />
      </div>
    </div>
  );
}

function Fade({ side, visible }: { side: "left" | "right"; visible: boolean }) {
  // Matches `card`'s background so the cards dissolve into it at the edge.
  const gradient =
    side === "left"
      ? "left-0 bg-linear-to-r from-[#0a0a0a] to-transparent"
      : "right-0 bg-linear-to-l from-[#0a0a0a] to-transparent";
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute top-0 bottom-2 w-8 transition-opacity duration-150 ${gradient} ${
        visible ? "opacity-100" : "opacity-0"
      }`}
    />
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
      className="flex h-6 w-6 items-center justify-center rounded-md border border-[#2e2e2e] text-[#aaa] transition-colors hover:border-[#555] hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <polyline points={direction === 1 ? "9 18 15 12 9 6" : "15 18 9 12 15 6"} />
      </svg>
    </button>
  );
}
