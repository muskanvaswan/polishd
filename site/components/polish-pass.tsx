"use client";

import { useEffect, useRef } from "react";

import {
  CHROME_H,
  CONTRAST,
  DEAD,
  PADS,
  PAGE_H,
  PAGE_W,
  QB_POLISHED,
  QB_ROUGH,
  RADII,
  RAGE,
  SWATCHES,
  TYPES,
} from "@/lib/queuebird";
import { FINDINGS_PREVIEW } from "@/lib/findings";

/**
 * The hero: the promo film's opening, live, on the demo site. Queuebird — a
 * launch page generated in one go — sits in a browser window. Polishd scans
 * it: a sweep leaves a dot on every fingerprint, then each one is called out
 * where it lives (the colours, the radii, the hand-typed paddings, the type
 * sizes, a logo row that fails contrast, the copy icon people hammer, a dead
 * "Changelog"). The findings stack up in a Polishd card beside the window,
 * the brush passes, and the same page comes out polished. Then it loops.
 *
 * Drag across the window (or use the arrow keys) to scrub between the two
 * versions yourself; the loop picks up again once you let go.
 *
 * One rAF loop sets every style from a single clock, `render(t)`, the way the
 * film does — so the timeline is one table of times, not a pile of CSS delays.
 */

const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const P = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
const eo = (p: number) => 1 - Math.pow(1 - clamp(p), 3);
const eio = (p: number) => {
  p = clamp(p);
  return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
};
const backOut = (p: number, s = 1.9) => {
  p = clamp(p);
  return 1 + (s + 1) * Math.pow(p - 1, 3) + s * Math.pow(p - 1, 2);
};

// ── The timeline (seconds) ───────────────────────────────────────────────────
const SCAN: [number, number] = [0.5, 1.6];
const T_SW = (i: number) => 1.7 + i * 0.07;
const T_RA = (i: number) => 2.6 + i * 0.16;
const T_PA = (i: number) => 3.5 + i * 0.2;
const T_TY = (i: number) => 4.0 + i * 0.12;
const T_CON = 4.9;
const T_RAGE = 5.5;
const T_DEAD = 6.2;
const BRUSH: [number, number] = [7.4, 8.6];
const T_RESET: [number, number] = [11.4, 12.0];
const LOOP = 12.2;

const STROKE_W = 230;
const brushX = (t: number) => lerp(-STROKE_W, PAGE_W + STROKE_W * 0.4, eio(P(t, BRUSH[0], BRUSH[1])));

/** When each Polishd card row lands. */
const ROW_T = [
  T_SW(SWATCHES.length - 1) + 0.3,
  T_RA(RADII.length - 1) + 0.25,
  T_TY(TYPES.length - 1) + 0.25,
  T_CON + 0.25,
  T_RAGE + 0.35,
  T_DEAD + 0.3,
];

/** Points the scan marks as it passes. */
const FP: [number, number][] = [
  ...SWATCHES.map(([, x, y]) => [x, y] as [number, number]),
  ...RADII.map(([x, y, , , r]) => [x + r, y + Math.min(r, 16)] as [number, number]),
  ...PADS.map(([x, y]) => [x + 30, y + 14] as [number, number]),
  ...TYPES.map(([x, y]) => [x + 20, y + 14] as [number, number]),
  [CONTRAST.x + CONTRAST.w / 2, CONTRAST.y + CONTRAST.h / 2],
  [RAGE.x, RAGE.y],
  [DEAD.x + DEAD.w / 2, DEAD.y + DEAD.h / 2],
];

function rrPath(x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, h / 2, w / 2);
  return `M${x + r},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${y + h - r}A${r},${r} 0 0 1 ${x + w - r},${y + h}H${x + r}A${r},${r} 0 0 1 ${x},${y + h - r}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}Z`;
}

function issueCount(t: number) {
  let n = 0;
  SWATCHES.forEach((_, i) => t >= T_SW(i) + 0.2 && n++);
  RADII.forEach((_, i) => t >= T_RA(i) + 0.1 && n++);
  PADS.forEach((_, i) => t >= T_PA(i) + 0.1 && n++);
  TYPES.forEach((_, i) => t >= T_TY(i) + 0.05 && n++);
  [T_CON, T_RAGE, T_DEAD].forEach((x) => t >= x && n++);
  return n;
}

const TAG =
  "absolute whitespace-nowrap rounded-[5px] px-[9px] py-[3px] font-mono text-[17px] font-bold text-white shadow-[0_4px_14px_rgba(239,68,68,.35)]";

export default function PolishPass() {
  const rootRef = useRef<HTMLDivElement>(null);
  const tiltRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current!;
    const tilt = tiltRef.current!;
    const frame = frameRef.current!;
    const q = <T extends Element = HTMLElement>(sel: string) => [...root.querySelectorAll<T & HTMLElement>(sel)];
    const one = (sel: string) => root.querySelector<HTMLElement>(sel)!;

    // ── Fit the 1400-wide stage to the window's width.
    const stage = one("[data-stage]");
    const fit = () => stage.style.setProperty("--s", String(frame.clientWidth / PAGE_W));
    const ro = new ResizeObserver(fit);
    ro.observe(frame);
    fit();

    const clean = one("[data-clean]");
    const ann = one("[data-ann]");
    const stroke = one("[data-stroke]");
    const handle = one("[data-handle]");
    const scan = one("[data-scan]");
    const badge = one("[data-badge]");
    const badgeN = one("[data-badge-n]");
    const fps = q("[data-fp]");
    const rings = q("[data-ring]");
    const radii = q<SVGPathElement>("[data-rad]") as unknown as SVGPathElement[];
    const radTags = q("[data-radtag]");
    const pads = q("[data-pad]");
    const types = q("[data-type]");
    const con = one("[data-con]");
    const ripples = q("[data-ripple]");
    const rageTag = one("[data-ragetag]");
    const dead = one("[data-dead]");
    const rows = q("[data-row]");
    const checks = q("[data-check]");
    const openN = one("[data-open]");
    const merged = one("[data-merged]");
    const card = one("[data-card]");
    const lens = radii.map((p) => p.getTotalLength());
    radii.forEach((p, i) => {
      p.style.strokeDasharray = String(lens[i]);
    });

    const popIn = (e: HTMLElement, t: number, t0: number, dur = 0.22) => {
      const k = backOut(P(t, t0, t0 + dur), 2.4);
      e.style.opacity = t >= t0 ? "1" : "0";
      e.style.transform = `scale(${Math.max(0, k)})`;
    };

    /** Everything on screen, from the clock and where the polish line is. */
    const render = (t: number, manualX: number | null) => {
      const polishing = manualX === null ? t >= BRUSH[0] : true;
      const bx = manualX ?? brushX(t);
      // Where the clean page shows: left of the stroke's bright edge.
      const edge = manualX ?? (t < BRUSH[0] ? -1 : t >= BRUSH[1] ? PAGE_W + 1 : bx + STROKE_W * 0.9);
      const reset = manualX === null ? P(t, T_RESET[0], T_RESET[1]) : 0;
      const at = manualX === null ? t : BRUSH[0]; // findings all shown while scrubbing

      const cleanPct = clamp(edge / PAGE_W) * 100;
      clean.style.clipPath = `inset(0 ${100 - cleanPct}% 0 0)`;
      clean.style.opacity = String(1 - reset);
      ann.style.clipPath = `inset(0 0 0 ${cleanPct}%)`;
      ann.style.opacity = String(1 - reset);

      stroke.style.display = manualX === null && t >= BRUSH[0] && t < BRUSH[1] + 0.05 ? "" : "none";
      stroke.style.transform = `translateX(${bx}px)`;
      handle.style.display = manualX !== null ? "" : "none";
      handle.style.transform = `translateX(${bx}px)`;

      // Scan.
      const sy = lerp(-160, PAGE_H + 20, eio(P(t, SCAN[0], SCAN[1])));
      const scanning = manualX === null && t >= SCAN[0] && t < SCAN[1] + 0.1;
      scan.style.display = scanning ? "" : "none";
      scan.style.transform = `translateY(${sy}px)`;
      fps.forEach((d, i) => {
        const y = FP[i][1];
        const t0 = SCAN[0] + (SCAN[1] - SCAN[0]) * clamp((y + 160) / (PAGE_H + 180));
        const hit = manualX === null && t >= t0;
        const out = P(t, 2.3, 2.7);
        const k = backOut(P(t, t0, t0 + 0.25), 2.6);
        d.style.opacity = hit ? String((1 - out) * 0.9) : "0";
        d.style.transform = `scale(${Math.max(0, k) * (1 + out * 0.8)})`;
      });

      // Colours: a ring pulses out of each, leaving a marker.
      rings.forEach((r, i) => {
        const p = P(at, T_SW(i) - 0.05, T_SW(i) + 0.3);
        r.style.opacity = p > 0 ? String(p < 1 ? 1 - p * 0.55 : 0.45) : "0";
        r.style.transform = `scale(${lerp(1.5, 0.55, eo(p))})`;
      });
      radii.forEach((p, i) => {
        const k = eo(P(at, T_RA(i), T_RA(i) + 0.3));
        p.style.strokeDashoffset = String(lens[i] * (1 - k));
        p.style.opacity = k > 0 ? "1" : "0";
        popIn(radTags[i], at, T_RA(i) + 0.08);
      });
      pads.forEach((e, i) => popIn(e, at, T_PA(i)));
      types.forEach((e, i) => popIn(e, at, T_TY(i)));
      con.style.opacity = at >= T_CON ? "1" : "0";
      popIn(one("[data-contag]"), at, T_CON);
      ripples.forEach((r, k) => {
        // Rage: rings off the copy icon, one per click.
        const t0 = T_RAGE + k * 0.075;
        const rp = manualX === null ? P(t, t0, t0 + 0.5) : 0;
        const R = lerp(6, 52, eo(rp));
        r.style.width = r.style.height = `${2 * R}px`;
        r.style.transform = `translate(${-R}px, ${-R}px)`;
        r.style.opacity = rp > 0 && rp < 1 ? String(1 - rp) : "0";
      });
      popIn(rageTag, at, T_RAGE + 0.1);
      dead.style.opacity = at >= T_DEAD ? "1" : "0";
      popIn(one("[data-deadtag]"), at, T_DEAD + 0.1);

      // The window's badge.
      const n = issueCount(at);
      const done = edge > PAGE_W;
      badge.dataset.ok = done ? "1" : "";
      badgeN.textContent = done ? "polished" : `${n} flagged`;
      badge.style.opacity = done || n > 0 ? String(1 - reset) : "0";

      // The Polishd card: findings land, then the brush ticks them off.
      let open = 0;
      rows.forEach((r, i) => {
        const p = eo(P(at, ROW_T[i], ROW_T[i] + 0.35));
        r.style.opacity = String(p * (1 - reset));
        r.style.transform = `translateY(${(1 - p) * 10}px)`;
        // A row is fixed once the stroke's edge has crossed the middle of the
        // page's thing it cites — in order, left to right, close enough.
        const fixedAt = (i + 1) / (rows.length + 1);
        const fixed = polishing && edge / PAGE_W > fixedAt;
        checks[i].dataset.on = fixed ? "1" : "";
        r.dataset.fixed = fixed ? "1" : "";
        if (p > 0.5 && !fixed) open++;
      });
      openN.textContent = String(open);
      const allFixed = rows.every((r) => r.dataset.fixed === "1");
      merged.style.opacity = allFixed ? String(1 - reset) : "0";
      card.style.opacity = String(clamp(P(at, ROW_T[0] - 0.4, ROW_T[0])) * (1 - reset) || (manualX !== null ? 1 : 0));
    };

    // ── Clock, scrubbing, visibility ─────────────────────────────────────────
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let t0 = performance.now();
    let pausedAt: number | null = t0;
    let manualX: number | null = null;
    let idle = 0;

    const frameLoop = (now: number) => {
      const t = ((now - t0) / 1000) % LOOP;
      render(t, manualX);
      raf = requestAnimationFrame(frameLoop);
    };

    if (reduced) {
      // Still: the page half polished, every finding called out.
      manualX = PAGE_W * 0.5;
      render(BRUSH[0], manualX);
    }

    const setFromPointer = (clientX: number) => {
      const r = frame.getBoundingClientRect();
      manualX = clamp((clientX - r.left) / r.width) * PAGE_W;
      if (reduced) render(BRUSH[0], manualX);
    };
    const release = () => {
      window.clearTimeout(idle);
      idle = window.setTimeout(() => {
        if (reduced) return;
        manualX = null;
        // Pick the loop up just after the brush, so it lands polished.
        t0 = performance.now() - BRUSH[1] * 1000;
      }, 2600);
    };
    const onDown = (e: PointerEvent) => {
      frame.setPointerCapture(e.pointerId);
      window.clearTimeout(idle);
      setFromPointer(e.clientX);
    };
    const onMove = (e: PointerEvent) => {
      if (frame.hasPointerCapture(e.pointerId)) setFromPointer(e.clientX);
    };
    const onUp = (e: PointerEvent) => {
      if (frame.hasPointerCapture(e.pointerId)) frame.releasePointerCapture(e.pointerId);
      release();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      window.clearTimeout(idle);
      const cur = manualX ?? PAGE_W * 0.5;
      manualX = clamp(cur + (e.key === "ArrowRight" ? 1 : -1) * PAGE_W * 0.08, 0, PAGE_W);
      frame.setAttribute("aria-valuenow", String(Math.round((manualX / PAGE_W) * 100)));
      if (reduced) render(BRUSH[0], manualX);
      release();
    };
    frame.addEventListener("pointerdown", onDown);
    frame.addEventListener("pointermove", onMove);
    frame.addEventListener("pointerup", onUp);
    frame.addEventListener("pointercancel", onUp);
    frame.addEventListener("keydown", onKey);

    // Only animate while it's on screen.
    const io = new IntersectionObserver(([entry]) => {
      if (reduced) return;
      if (entry.isIntersecting && pausedAt !== null) {
        t0 += performance.now() - pausedAt;
        pausedAt = null;
        raf = requestAnimationFrame(frameLoop);
      } else if (!entry.isIntersecting && pausedAt === null) {
        cancelAnimationFrame(raf);
        pausedAt = performance.now();
      }
    });
    io.observe(root);

    // The window arrives tilted back and stands up as the page scrolls.
    let tiltRaf = 0;
    const onScroll = () => {
      cancelAnimationFrame(tiltRaf);
      tiltRaf = requestAnimationFrame(() => {
        const r = root.getBoundingClientRect();
        const vh = window.innerHeight;
        const p = reduced ? 1 : clamp((vh - r.top) / (vh * 0.75) - 0.35);
        tilt.style.transform = `rotateX(${lerp(16, 0, eo(p))}deg) scale(${lerp(0.94, 1, eo(p))})`;
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);

    return () => {
      ro.disconnect();
      io.disconnect();
      cancelAnimationFrame(raf);
      cancelAnimationFrame(tiltRaf);
      window.clearTimeout(idle);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      frame.removeEventListener("pointerdown", onDown);
      frame.removeEventListener("pointermove", onMove);
      frame.removeEventListener("pointerup", onUp);
      frame.removeEventListener("pointercancel", onUp);
      frame.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div ref={rootRef} className="relative [perspective:2400px]">
      <div ref={tiltRef} className="relative origin-[50%_0%] will-change-transform [transform-style:preserve-3d]">
        {/* The browser window. */}
        <div
          ref={frameRef}
          role="slider"
          tabIndex={0}
          aria-label="Queuebird's landing page, as generated and polished. Drag or use the arrow keys to compare."
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={50}
          className="pp-frame relative w-full cursor-ew-resize touch-pan-y select-none overflow-hidden rounded-[14px] bg-black outline-none ring-1 ring-white/15 shadow-[0_50px_140px_-30px_rgba(0,0,0,.95),0_0_0_1px_rgba(255,255,255,.04)] focus-visible:ring-2 focus-visible:ring-fg-3"
          style={{ aspectRatio: `${PAGE_W} / ${PAGE_H + CHROME_H}` }}
        >
          <div
            data-stage
            className="absolute left-0 top-0 origin-top-left"
            style={{ width: PAGE_W, height: PAGE_H + CHROME_H, transform: "scale(var(--s, 0.5))" }}
          >
            {/* Chrome. */}
            <div className="absolute inset-x-0 top-0 h-[46px] border-b border-[#262626] bg-[#161616]">
              <div className="absolute left-[18px] top-4 flex gap-2">
                <i className="block size-[13px] rounded-full bg-[#ff5f57]" />
                <i className="block size-[13px] rounded-full bg-[#febc2e]" />
                <i className="block size-[13px] rounded-full bg-[#28c840]" />
              </div>
              <div className="absolute left-1/2 top-[9px] flex h-7 w-[440px] -translate-x-1/2 items-center justify-center rounded-lg bg-[#0b0b0b] font-[system-ui,-apple-system,sans-serif] text-[15px] text-[#8a8a8a]">
                demo.polishd.site
              </div>
              <div
                data-badge
                className="absolute right-4 top-[9px] flex h-7 items-center gap-[7px] rounded-[14px] bg-[#ef4444] px-3 font-mono text-[15px] font-bold text-white opacity-0 transition-colors duration-300 data-[ok='1']:bg-[#16a34a]"
              >
                <span>●</span>
                <span data-badge-n>0 flagged</span>
              </div>
            </div>

            <div className="absolute left-0 overflow-hidden" style={{ top: CHROME_H, width: PAGE_W, height: PAGE_H }}>
              <div className="pv" dangerouslySetInnerHTML={{ __html: QB_ROUGH }} />
              <div data-clean className="pv" dangerouslySetInnerHTML={{ __html: QB_POLISHED }} />

              {/* Findings, called out where they live. */}
              <div data-ann className="pointer-events-none absolute inset-0">
                <svg width={PAGE_W} height={PAGE_H} className="absolute inset-0 overflow-visible">
                  {RADII.map(([x, y, w, h, r], i) => (
                    <path
                      key={i}
                      data-rad
                      d={rrPath(x - 5, y - 5, w + 10, h + 10, r + 5)}
                      fill="rgba(239,68,68,.05)"
                      stroke="#ef4444"
                      strokeWidth={3}
                      opacity={0}
                    />
                  ))}
                </svg>
                {RADII.map(([x, y, , , r], i) => (
                  <div key={i} data-radtag className={`${TAG} origin-bottom-left bg-[#ef4444] opacity-0`} style={{ left: x - 5, top: y - 39 }}>
                    r {r}px
                  </div>
                ))}
                {SWATCHES.map(([c, x, y], i) => (
                  <div
                    key={i}
                    data-ring
                    className="absolute size-[52px] rounded-full border-[3px] border-[#ef4444] opacity-0"
                    style={{ left: x - 26, top: y - 26, boxShadow: `inset 0 0 0 4px ${c}` }}
                  />
                ))}
                {PADS.map(([x, y, l], i) => (
                  <div key={i} data-pad className={`${TAG} origin-bottom-left bg-[#ef4444] opacity-0`} style={{ left: x, top: y }}>
                    {l}
                  </div>
                ))}
                {TYPES.map(([x, y, l], i) => (
                  <div
                    key={i}
                    data-type
                    className={`${TAG} origin-bottom-left bg-[#f97316] opacity-0 shadow-[0_4px_14px_rgba(249,115,22,.35)]`}
                    style={{ left: x, top: y }}
                  >
                    {l}
                  </div>
                ))}
                <div data-con className="absolute opacity-0">
                  <div
                    className="absolute rounded-md border-[3px] border-dashed border-[#ef4444]"
                    style={{ left: CONTRAST.x, top: CONTRAST.y, width: CONTRAST.w, height: CONTRAST.h }}
                  />
                  <div data-contag className={`${TAG} origin-right bg-[#ef4444]`} style={{ left: CONTRAST.tag[0], top: CONTRAST.tag[1] }}>
                    {CONTRAST.label}
                  </div>
                </div>
                {Array.from({ length: 5 }, (_, i) => (
                  <div
                    key={i}
                    data-ripple
                    className="absolute rounded-full border-[3px] border-[#ef4444] opacity-0"
                    style={{ left: RAGE.x, top: RAGE.y }}
                  />
                ))}
                <div data-ragetag className={`${TAG} origin-bottom-left bg-[#ef4444] opacity-0`} style={{ left: RAGE.tag[0], top: RAGE.tag[1] }}>
                  rage click
                </div>
                <div data-dead className="absolute opacity-0">
                  <div
                    className="absolute rounded-md border-[3px] border-[#ef4444]"
                    style={{ left: DEAD.x, top: DEAD.y, width: DEAD.w, height: DEAD.h }}
                  />
                  <div data-deadtag className={`${TAG} origin-left bg-[#ef4444]`} style={{ left: DEAD.tag[0], top: DEAD.tag[1] }}>
                    dead click
                  </div>
                </div>
                {FP.map(([x, y], i) => (
                  <div
                    key={i}
                    data-fp
                    className="absolute size-[18px] rounded-full bg-[rgba(239,68,68,.85)] opacity-0 shadow-[0_0_0_6px_rgba(239,68,68,.18)]"
                    style={{ left: x - 9, top: y - 9 }}
                  />
                ))}
              </div>

              {/* The scan line. */}
              <div data-scan className="pointer-events-none absolute inset-x-0 top-0" style={{ display: "none" }}>
                <div className="h-[160px] -translate-y-full bg-gradient-to-b from-[rgba(239,68,68,0)] to-[rgba(239,68,68,.10)]" />
                <div className="h-[3px] -translate-y-[160px] bg-[#ef4444] shadow-[0_0_24px_6px_rgba(239,68,68,.55)]" />
              </div>

              {/* The polish: a warm band of light with brush streaks. */}
              <div
                data-stroke
                className="pp-stroke pointer-events-none absolute -top-[300px] left-0 h-[1400px]"
                style={{ width: STROKE_W, display: "none" }}
              />
              {/* The scrub handle, while you're dragging. */}
              <div data-handle className="pointer-events-none absolute inset-y-0 left-0" style={{ display: "none" }}>
                <div className="absolute inset-y-0 -left-[1.5px] w-[3px] bg-white shadow-[0_0_0_1px_rgba(0,0,0,.15),0_0_30px_rgba(255,236,205,.8)]" />
                <div className="absolute left-0 top-1/2 flex size-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-[18px] text-[#0a0a0a] shadow-[0_6px_24px_rgba(0,0,0,.6)]">
                  ⟷
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Polishd, beside the window: what it found, then what got fixed. */}
        <div
          data-card
          className="font-chart z-10 mt-4 w-full rounded-xl border border-line bg-surface/95 p-1.5 opacity-0 shadow-pop backdrop-blur-md md:absolute md:-bottom-12 md:-right-6 md:mt-0 md:w-[340px] lg:-right-24"
        >
          <div className="flex items-center justify-between px-3 pb-2 pt-2">
            <span className="text-[13px] font-semibold text-fg">Findings</span>
            <span className="rounded-md px-1.5 py-0.5 font-mono text-[11px] text-fg-3 ring-1 ring-inset ring-line-strong">
              <span data-open>0</span> open
            </span>
          </div>
          <ul className="space-y-1">
            {FINDINGS_PREVIEW.map((f, i) => (
              <li
                key={i}
                data-row
                className="group flex items-center gap-2.5 rounded-lg bg-raised px-3 py-2 opacity-0 transition-colors duration-300 data-[fixed='1']:bg-ok/[0.06]"
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${f.source === "Design" ? "bg-blue" : "bg-bad"} transition-opacity duration-300 group-data-[fixed='1']:opacity-0`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] text-fg transition-colors duration-300 group-data-[fixed='1']:text-fg-3">
                    {f.title}
                  </span>
                  <span className="block truncate font-mono text-[10.5px] text-fg-4">{f.cite}</span>
                </span>
                <span
                  data-check
                  className="grid size-4 shrink-0 scale-50 place-items-center rounded-full bg-ok text-[10px] font-bold text-black opacity-0 transition-[opacity,scale] duration-300 ease-[var(--ease-out)] data-[on='1']:scale-100 data-[on='1']:opacity-100"
                >
                  ✓
                </span>
              </li>
            ))}
          </ul>
          <div data-merged className="flex items-center gap-2 px-3 pb-1.5 pt-2.5 font-mono text-[11px] text-ok opacity-0 transition-opacity duration-300">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
              <path d="M5 3.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0zm0 2.122a2.25 2.25 0 1 0-1.5 0v5.256a2.25 2.25 0 1 0 1.5 0V5.372zM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zM11 2.5h-1V4h1a1 1 0 0 1 1 1v5.628a2.25 2.25 0 1 0 1.5 0V5A2.5 2.5 0 0 0 11 2.5zm1 10.25a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0z" />
            </svg>
            Fixed by your coding agent · PR #43 merged
          </div>
        </div>
      </div>
    </div>
  );
}
