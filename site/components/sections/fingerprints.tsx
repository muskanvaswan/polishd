import type { CSSProperties, ReactNode } from "react";

import { Headline, Slide, d } from "@/components/kit";
import { WALKTHROUGH } from "@/lib/findings";

/**
 * The problem, as the film tells it: building got fast, and speed leaves
 * fingerprints. The headline is one cell of the bento; each other cell is one
 * kind of fingerprint, with the values Polishd measured on Queuebird, the
 * demo app — a launch page generated in one go.
 */

/** Queuebird's palette after every fix, as Polishd's re-scan measured it. */
const AFTER = [
  "#ffffff", "#a1a1aa", "#8b8b95", "#27272a", "#18181b", "#111113", "#09090b",
  "#7c3aed", "#a78bfa", "#34d399", "#38bdf8", "#fbbf24", "#fb7185",
];

export default function Fingerprints() {
  return (
    <Slide id="why" label="What a fast build leaves behind">
      <div className="bento">
        <div className="cell-bare r flex flex-col justify-center deck:col-span-5 deck:row-span-4 deck:pr-6">
          <Headline lead="Building got fast.">Finishing didn&apos;t.</Headline>
          <p className="lede mt-[clamp(14px,2.8vh,28px)] max-w-[40ch]">
            Speed leaves fingerprints: the kind nobody catches in review, and every user feels. These are from
            Queuebird, our demo, a launch page generated in one go.
          </p>
        </div>

        <Tile className="deck:col-span-4 deck:row-span-2" delay={60} title="33 colours. A system needs half that." note="zinc and neutral greys, side by side">
          <Palette />
        </Tile>
        <Tile className="deck:col-span-3 deck:row-span-2" delay={120} title="Seven corner radii." note="where 2–4 would do">
          <Radii />
        </Tile>
        <Tile className="deck:col-span-4 deck:row-span-2" delay={180} title="Eighteen font sizes." note="where 5–8 would do">
          <TypeScale />
        </Tile>
        <Tile className="deck:col-span-3 deck:row-span-2" delay={240} title="A footer nobody can read." note="2.0:1, and AA needs 4.5:1">
          <Contrast />
        </Tile>
        <Tile className="deck:col-span-4 deck:row-span-2" delay={300} title="Padding that's almost right." note="7, 11, 13, 15, 17: none on the scale">
          <Spacing />
        </Tile>
        <Tile className="deck:col-span-8 deck:row-span-2" delay={360} title="Rage clicks. Dead clicks. Controls that aren't." note="what your users feel before you do">
          <Behaviour />
        </Tile>
      </div>
    </Slide>
  );
}

function Tile({
  title,
  note,
  children,
  className = "",
  delay = 0,
}: {
  title: string;
  note: string;
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <div className={`cell r flex flex-col max-lg:min-h-[250px] ${className}`} style={d(delay)}>
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-sunken/70">{children}</div>
      <div className="shrink-0 border-t border-line px-4 py-[clamp(8px,1.4vh,13px)]">
        <h3 className="font-heading text-[clamp(14px,min(1.2vw,2.1vh),17.5px)] font-semibold leading-[1.2] text-fg">{title}</h3>
        <p className="mt-0.5 font-mono text-[clamp(10.5px,min(0.82vw,1.4vh),11.5px)] text-bad">{note}</p>
      </div>
    </div>
  );
}

function Palette() {
  const before = WALKTHROUGH.design.palette;
  return (
    <div className="grid w-full max-w-[560px] gap-[clamp(8px,1.6vh,16px)] px-5">
      <div>
        <div className="mb-1.5 flex items-baseline justify-between font-mono text-[10.5px] text-fg-3">
          <span>as generated</span>
          <span className="text-bad">{before.length}</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {before.map((c) => (
            <span key={c} className="block size-[clamp(13px,1.9vh,19px)] rounded-[4px] ring-1 ring-inset ring-white/10" style={{ backgroundColor: c }} />
          ))}
        </div>
      </div>
      <div className="collapse-label">
        <div className="mb-1.5 flex items-baseline justify-between font-mono text-[10.5px] text-fg-3">
          <span>after the fixes, re-scanned by Polishd</span>
          <span className="text-ok">{AFTER.length}</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {AFTER.map((c) => (
            <span key={c} className="block size-[clamp(13px,1.9vh,19px)] rounded-[4px] ring-1 ring-inset ring-white/10" style={{ backgroundColor: c }} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Radii() {
  return (
    <div className="grid grid-cols-4 gap-x-3 gap-y-[clamp(4px,1vh,10px)]">
      {WALKTHROUGH.design.radii.map((r) => (
        <div key={r} className="flex flex-col items-center gap-1">
          <span className="block size-[clamp(22px,3.4vh,32px)] border-2 border-bad/80 bg-bad/[0.06]" style={{ borderRadius: r }} />
          <span className="font-mono text-[10px] text-fg-3">{r}px</span>
        </div>
      ))}
    </div>
  );
}

function Spacing() {
  return (
    <div className="flex flex-col items-center gap-[clamp(6px,1.4vh,14px)]">
      <div className="flex items-end gap-2.5">
        {[7, 11, 13, 15, 17].map((v) => (
          <div key={v} className="flex flex-col items-center gap-1.5">
            <span className="block w-6 rounded-[3px] border border-bad/70 bg-bad/10" style={{ height: `clamp(${v * 1.8}px, ${v * 0.34}vh, ${v * 3}px)` }} />
            <span className="font-mono text-[11px] text-bad">{v}</span>
          </div>
        ))}
      </div>
      <div className="font-mono text-[10.5px] text-fg-3">the scale: 8, 12, 16, 20</div>
    </div>
  );
}

function TypeScale() {
  return (
    <div className="flex max-w-[340px] flex-wrap items-end justify-center gap-x-1.5 gap-y-1.5 px-3">
      {[...WALKTHROUGH.design.typeScale].reverse().map((s) => (
        <div key={s} className="flex flex-col items-center gap-1">
          <span className="font-[system-ui,-apple-system,sans-serif] font-bold leading-none text-fg" style={{ fontSize: `clamp(${Math.round(s * 0.28)}px, ${(s * 0.047).toFixed(2)}vh, ${Math.round(s * 0.42)}px)` }}>
            Aa
          </span>
          <span className="font-mono text-[9px] text-warn">{s}</span>
        </div>
      ))}
    </div>
  );
}

function Contrast() {
  return (
    <div className="w-[82%] max-w-[330px] rounded-lg bg-black px-4 py-[clamp(10px,1.8vh,16px)] ring-1 ring-white/10">
      <div className="font-[system-ui,-apple-system,sans-serif] text-[13px] font-semibold text-[#fafafa]">queuebird</div>
      <div className="relative mt-2 inline-block whitespace-nowrap font-[system-ui,-apple-system,sans-serif] text-[11px] text-[#3f3f46]">
        © 2026 Queuebird, Inc.
        <span className="absolute -inset-x-1.5 -inset-y-1 rounded border-2 border-dashed border-[#ef4444]" />
      </div>
      <div className="mt-3 flex items-center gap-2 font-mono text-[10.5px]">
        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#27272a]">
          <span className="block h-full w-[44%] rounded-full bg-[#ef4444]" />
        </span>
        <span className="text-[#ef4444]">2.0:1</span>
      </div>
    </div>
  );
}

function Ripples({ x, y }: { x: number; y: number }) {
  return (
    <>
      {[0, 0.25, 0.5].map((rd) => (
        <span
          key={rd}
          className="ripple absolute size-14 rounded-full border-2 border-bad"
          style={{ left: x, top: y, "--rd": `${rd}s` } as CSSProperties}
        />
      ))}
    </>
  );
}

function Tag({ children, tone = "bad" }: { children: ReactNode; tone?: "bad" | "warn" }) {
  return (
    <span className={`whitespace-nowrap rounded px-1.5 py-0.5 font-mono text-[9.5px] font-bold text-black ${tone === "bad" ? "bg-bad" : "bg-warn"}`}>
      {children}
    </span>
  );
}

function Behaviour() {
  return (
    <div className="relative h-full w-full max-w-[900px] px-5 pt-[clamp(10px,2vh,22px)]">
      {/* Queuebird in miniature. */}
      <div className="relative mx-auto h-full w-full overflow-hidden rounded-t-xl border border-b-0 border-line-strong bg-black">
        <div className="flex h-8 items-center gap-4 border-b border-white/10 px-4">
          <span className="size-3.5 rounded-[4px] bg-[#8b5cf6]" />
          <span className="h-1.5 w-14 rounded-full bg-fg-4" />
          <span className="ml-3 h-1.5 w-7 rounded-full bg-line-strong" />
          <span className="h-1.5 w-7 rounded-full bg-line-strong" />
          <span className="ml-auto h-4 w-14 rounded-full bg-fg-3" />
        </div>

        <div className="grid grid-cols-1 gap-3 px-4 pb-4 pt-[clamp(10px,1.8vh,18px)] sm:grid-cols-3">
          {/* The copy icon. */}
          <div className="relative rounded-lg border border-line bg-[#0d0d10] p-3">
            <div className="flex items-center justify-between rounded-md border border-[#262626] bg-[#171717] px-2.5 py-1.5 font-mono text-[10px] text-[#d4d4d4]">
              <span>
                <span className="text-[#525252]">$ </span>npm i queuebird
              </span>
              <span className="relative grid size-4 place-items-center rounded-[3px] text-[#737373]">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <rect x="8" y="8" width="13" height="13" rx="2" />
                  <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                </svg>
                <span className="absolute -inset-1.5 rounded border-2 border-warn" />
              </span>
            </div>
            <div className="mt-3">
              <Tag tone="warn">copy icon · dead ×72</Tag>
            </div>
          </div>

          {/* The billing switch. */}
          <div className="relative rounded-lg border border-line bg-[#0d0d10] p-3">
            <div className="relative mx-auto flex w-fit rounded-full border border-[#27272a] bg-[#18181b] p-0.5 text-[10px]">
              <span className="rounded-full bg-[#27272a] px-2.5 py-1 text-white">Monthly</span>
              <span className="relative px-2.5 py-1 text-[#a1a1aa]">
                Yearly
                <Ripples x={22} y={11} />
              </span>
            </div>
            <div className="mt-3 text-center">
              <Tag>Yearly switch · rage ×30</Tag>
            </div>
          </div>

          {/* The code tabs. */}
          <div className="relative rounded-lg border border-line bg-[#0d0d10] p-3">
            <div className="flex gap-3 border-b border-white/10 pb-1.5 text-[10px]">
              <span className="text-white">TypeScript</span>
              <span className="relative text-[#71717a]">
                Next.js
                <Ripples x={18} y={7} />
              </span>
              <span className="text-[#71717a]">Cron</span>
            </div>
            <div className="mt-2 space-y-1">
              <span className="block h-1.5 w-4/5 rounded-full bg-[#c084fc]/40" />
              <span className="block h-1.5 w-3/5 rounded-full bg-[#34d399]/40" />
            </div>
            <div className="mt-3">
              <Tag>code tab · rage ×23</Tag>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
