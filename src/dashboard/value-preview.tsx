"use client";

/**
 * Polishd — "where does this render?" for a flagged design value.
 *
 * Wraps a one-off type style, color, radius or off-grid padding on the Design
 * tab. Hovering (or focusing, or tapping) it opens a card with a picture of
 * the element that carries the value — ringed, with the component around it —
 * and the page it's on. The pictures are shot during a snapshot capture (see
 * server/value-previews.ts); this only fetches one, lazily, the first time
 * its card opens, through the same auth-gated action as the gallery tiles.
 *
 * The card is `position: fixed` and rendered in place rather than portaled:
 * the dashboard's styles are scoped to `.polishd-root`, so a portal to
 * `document.body` would render unstyled, and fixed positioning already escapes
 * the `overflow: hidden` cards and collapsed rows the values sit in.
 */
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";

import { getSnapshotImageAction } from "./snapshot-actions";
import { labelCls, relTime } from "./ui";

/** A stored picture of the value, from the newest snapshot that has one. */
export interface ValuePreviewRef {
  snapshotId: string;
  file: string;
  route: string;
  device: string;
  theme: string;
  capturedAt: number;
}

export type ValuePreviewState =
  | { kind: "pictured"; preview: ValuePreviewRef }
  /** The newest snapshot looked for the value on its page and never saw it on screen. */
  | { kind: "missed"; capturedAt: number }
  | { kind: "none"; hasSnapshots: boolean };

/** Fetched pictures, shared by every card — a value hovered twice loads once. */
const imageCache = new Map<string, Promise<string | null>>();

function loadImage(ref: ValuePreviewRef): Promise<string | null> {
  const key = `${ref.snapshotId}|${ref.file}`;
  let pending = imageCache.get(key);
  if (!pending) {
    pending = getSnapshotImageAction(ref.snapshotId, ref.file)
      .then((res) => (res.ok ? res.dataUrl : null))
      .catch(() => null);
    imageCache.set(key, pending);
  }
  return pending;
}

const CARD_WIDTH = 340;
const MARGIN = 12;
/** Pointer dwell before the card opens, so sweeping across a list stays quiet. */
const OPEN_DELAY_MS = 120;

interface Placement {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
}

function place(trigger: Element): Placement {
  const r = trigger.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(CARD_WIDTH, vw - MARGIN * 2);
  const left = Math.min(Math.max(r.left, MARGIN), vw - width - MARGIN);
  // Below by default; above when the bottom of the screen is the tighter fit.
  const roomBelow = vh - r.bottom;
  return roomBelow >= 320 || roomBelow >= r.top
    ? { left, width, top: r.bottom + 8 }
    : { left, width, bottom: vh - r.top + 8 };
}

function Picture({ preview }: { preview: ValuePreviewRef }) {
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    loadImage(preview).then((url) => alive && setSrc(url));
    return () => {
      alive = false;
    };
  }, [preview]);

  return (
    <div className="flex aspect-[16/10] w-full items-center justify-center overflow-hidden rounded-md border border-[#2e2e2e] bg-[#111]">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={`Where it renders on ${preview.route}`}
          className="h-full w-full object-contain"
        />
      ) : (
        <span className="text-[11px] text-[#555]">
          {src === null ? "picture missing" : "loading picture…"}
        </span>
      )}
    </div>
  );
}

function PageList({ pages, lead }: { pages: string[]; lead: string }) {
  if (pages.length === 0) return null;
  return (
    <p className="text-[11px] leading-relaxed text-[#777]">
      {lead}{" "}
      {pages.slice(0, 3).map((p, i) => (
        <span key={p}>
          {i > 0 && ", "}
          <span className="font-mono text-[#aaa]">{p}</span>
        </span>
      ))}
      {pages.length > 3 && ` +${pages.length - 3} more`}
    </p>
  );
}

function CardBody({
  label,
  pages,
  state,
}: {
  label: string;
  pages: string[];
  state: ValuePreviewState;
}) {
  if (state.kind === "pictured") {
    const { preview } = state;
    const others = pages.filter((p) => p !== preview.route);
    return (
      <>
        <Picture preview={preview} />
        <p className="flex flex-wrap items-baseline gap-x-1.5 text-[11px] text-[#666]">
          <span className="font-mono text-[12px] text-white">{preview.route}</span>
          <span>
            · {preview.device}, {preview.theme} · {relTime(preview.capturedAt)}
          </span>
        </p>
        <PageList pages={others} lead="Also measured on" />
      </>
    );
  }
  return (
    <>
      <PageList pages={pages} lead="Measured on" />
      <p className="text-[12px] leading-relaxed text-[#888]">
        {state.kind === "missed"
          ? `The latest snapshot (${relTime(state.capturedAt)}) didn't find ${label} on screen — it may only render after an interaction, or at a screen size snapshots don't shoot.`
          : state.hasSnapshots
            ? "Capture a new snapshot to picture it in place."
            : "Capture a snapshot to picture it in place."}
      </p>
    </>
  );
}

export default function ValuePreview({
  label,
  pages,
  state,
  className = "",
  children,
}: {
  /** The value as the row names it, e.g. "17px / 500" or "#fafafa". */
  label: string;
  /** Pages the value was measured on. */
  pages: string[];
  state: ValuePreviewState;
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  const triggerRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const open = useCallback(() => {
    cancel();
    if (triggerRef.current) setPlacement(place(triggerRef.current));
  }, []);
  const close = useCallback(() => {
    cancel();
    setPlacement(null);
  }, []);

  // A fixed card would drift off its row on scroll, so it follows the row
  // instead. Closing on scroll would be simpler and wrong: focusing a row
  // scrolls it into view, which would shut the card a keyboard user just opened.
  const isOpen = placement !== null;
  useEffect(() => {
    if (!isOpen) return;
    let frame = 0;
    const follow = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (triggerRef.current) setPlacement(place(triggerRef.current));
      });
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("scroll", follow, { capture: true, passive: true });
    window.addEventListener("resize", follow);
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", follow, { capture: true });
      window.removeEventListener("resize", follow);
      window.removeEventListener("keydown", onKey);
    };
  }, [isOpen, close]);

  useEffect(() => cancel, []);

  return (
    <div
      ref={triggerRef}
      tabIndex={0}
      data-component="design-value-preview"
      aria-describedby={placement ? id : undefined}
      onPointerEnter={(e) => {
        if (e.pointerType === "touch") return; // taps open via click
        cancel();
        timer.current = setTimeout(open, OPEN_DELAY_MS);
      }}
      onPointerLeave={close}
      onFocus={open}
      onBlur={close}
      onClick={open}
      className={`cursor-help outline-none ${className}`}
    >
      {children}
      {placement && (
        <div
          id={id}
          role="tooltip"
          className="pointer-events-none fixed z-50 flex flex-col gap-2.5 rounded-lg border border-[#2e2e2e] bg-[#0a0a0a] p-3 text-left font-sans normal-case tracking-normal shadow-2xl"
          style={{
            left: placement.left,
            width: placement.width,
            top: placement.top,
            bottom: placement.bottom,
          }}
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className={labelCls}>Where it renders</span>
            <span className="truncate font-mono text-[11px] text-amber-400">{label}</span>
          </div>
          <CardBody label={label} pages={pages} state={state} />
        </div>
      )}
    </div>
  );
}
