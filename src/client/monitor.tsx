"use client";

/**
 * BuffdMonitor — explicit component-level tracking for Buffd.
 *
 * Drop this around any element you want to monitor. Two tiers of tracking:
 *
 * Always on (cheap, suits interactive controls like buttons):
 *  • hover   — pointer dwell time (≥200ms), value = ms
 *  • child clicks/rage/dead — attributed automatically via data-component and
 *    the existing global Buffd click capture, no extra wiring needed.
 *
 * Opt-in with `content` (for content regions like an article body):
 *  • mount   — fired once when the region renders, so you can count how often
 *    it was opened/shown.
 *  • component_view — time in the viewport per visit, value = ms, meta includes:
 *      width, height (px), scrollDepth (% of component scrolled through),
 *      views (how many times it entered the viewport)
 *
 * Leave `content` off for clickable elements so we don't measure meaningless
 * height/scroll/viewport data on them.
 *
 * Usage:
 *   <BuffdMonitor name="listen-button">          // hover + click only
 *     <ListenButton src={src} />
 *   </BuffdMonitor>
 *
 *   <BuffdMonitor name={slug} content>            // + mount, view, scroll, height
 *     <Article />
 *   </BuffdMonitor>
 */

import { useEffect, useRef } from "react";
import type { BuffdEvent } from "../shared/types";

type TrackFn = (e: Omit<BuffdEvent, "ts" | "path"> & Partial<Pick<BuffdEvent, "ts" | "path">>) => void;

declare global {
  interface Window {
    __buffdTrack?: TrackFn;
  }
}

type Props = {
  /** Name shown in the Buffd dashboard — keep it kebab-case and stable. */
  name: string;
  children: React.ReactNode;
  className?: string;
  /**
   * Treat this as a content region: emit a `mount` event and track viewport
   * time, scroll depth, and rendered height (component_view). Leave off
   * (default) for interactive controls like buttons, where only hover + click
   * attribution is wanted.
   */
  content?: boolean;
};

/** Find the nearest ancestor that scrolls on the y-axis. */
function findScrollParent(el: HTMLElement): HTMLElement | Window {
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    const { overflowY } = window.getComputedStyle(node);
    if (/auto|scroll/.test(overflowY) && node.scrollHeight > node.clientHeight) return node;
    node = node.parentElement;
  }
  return window;
}

export function BuffdMonitor({ name, children, className, content = false }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const hoverStart = useRef<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Auto-detect what's trackable and annotate for devtools.
    const hasButtons = el.querySelectorAll("button").length > 0;
    const hasLinks = el.querySelectorAll("a").length > 0;
    const kinds: string[] = ["hover"];
    if (content) kinds.push("mount", "view");
    if (hasButtons) kinds.push("click");
    if (hasLinks) kinds.push("link");
    el.dataset.buffdTracks = kinds.join(",");

    // ── Hover tracking (always on) ──────────────────────────────────────────
    const onEnter = () => { hoverStart.current = Date.now(); };
    const onLeave = () => {
      if (hoverStart.current === null) return;
      const ms = Date.now() - hoverStart.current;
      hoverStart.current = null;
      if (ms < 200) return;
      window.__buffdTrack?.({ type: "hover", component: name, value: ms });
    };
    el.addEventListener("pointerenter", onEnter);
    el.addEventListener("pointerleave", onLeave);

    // Interactive controls (the default) stop here — no viewport/scroll/mount.
    if (!content) {
      return () => {
        el.removeEventListener("pointerenter", onEnter);
        el.removeEventListener("pointerleave", onLeave);
      };
    }

    // ── Content-region tracking (content=true only) ─────────────────────────
    // Record that the region rendered, so we can count how often it was shown.
    window.__buffdTrack?.({ type: "mount", component: name });

    // ── Viewport / focus tracking ───────────────────────────────────────────
    // visibleSince: when this viewport visit started (null = not visible)
    // totalMs: accumulated visible time across all viewport visits
    // maxScrollDepth: highest scroll-through % seen (0–100)
    // maxHeightPx/maxWidthPx: largest rendered box seen while laid out
    // viewCount: how many times the component entered the viewport
    let visibleSince: number | null = null;
    let totalMs = 0;
    let maxScrollDepth = 0;
    let maxHeightPx = 0;
    let maxWidthPx = 0;
    let viewCount = 0;

    // Track scroll-through % and the element's rendered size *while it's laid
    // out*. getBoundingClientRect returns the full box (not clipped to the
    // viewport), so it captures the element's true height even when only part
    // is on screen — and reading it here, rather than el.offsetHeight at emit
    // time, avoids the 0px we'd otherwise get when emitView fires during React
    // teardown (unmount / name change).
    // Scroll-depth formula: (viewportHeight - componentTop) / componentHeight,
    // clamped 0–100. Reaches 100% when the component's bottom is at the
    // viewport bottom.
    const refreshScrollDepth = () => {
      const rect = el.getBoundingClientRect();
      if (rect.height === 0) return;
      if (rect.height > maxHeightPx) maxHeightPx = rect.height;
      if (rect.width > maxWidthPx) maxWidthPx = rect.width;
      const pct = Math.max(0, Math.min(100, Math.round(
        ((window.innerHeight - rect.top) / rect.height) * 100,
      )));
      if (pct > maxScrollDepth) maxScrollDepth = pct;
    };

    // Flush accumulated viewport time as a component_view event.
    // Called when the component leaves the viewport or the effect cleans up.
    const emitView = () => {
      if (visibleSince !== null) {
        totalMs += Date.now() - visibleSince;
        visibleSince = null;
      }
      if (totalMs < 500) return; // ignore flashes shorter than half a second
      window.__buffdTrack?.({
        type: "component_view",
        component: name,
        value: totalMs,
        meta: {
          width: Math.round(maxWidthPx),
          height: Math.round(maxHeightPx),
          scrollDepth: maxScrollDepth,
          views: viewCount,
        },
      });
      totalMs = 0;
      maxScrollDepth = 0;
      maxHeightPx = 0;
      maxWidthPx = 0;
      viewCount = 0;
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            if (visibleSince === null) {
              visibleSince = Date.now();
              viewCount++;
            }
            refreshScrollDepth();
          } else {
            if (visibleSince !== null) {
              totalMs += Date.now() - visibleSince;
              visibleSince = null;
            }
            if (totalMs >= 500) emitView();
          }
        }
      },
      { threshold: [0, 0.1, 0.5, 1.0] },
    );
    observer.observe(el);

    const scrollParent = findScrollParent(el);
    scrollParent.addEventListener("scroll", refreshScrollDepth, { passive: true } as EventListenerOptions);

    return () => {
      emitView(); // flush remaining time on unmount / name change
      observer.disconnect();
      scrollParent.removeEventListener("scroll", refreshScrollDepth);
      el.removeEventListener("pointerenter", onEnter);
      el.removeEventListener("pointerleave", onLeave);
    };
  }, [name, content]);

  return (
    <span ref={ref} data-component={name} className={className}>
      {children}
    </span>
  );
}
