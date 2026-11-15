"use client";

import { useEffect, useRef } from "react";

const W = 1280;
const H = 760;
const CHROME = 44;

/**
 * Queuebird, the demo app (demo/ in this repo), in a small browser window: its
 * hero as generated, rough edges and all. Drawn at 1280px and scaled to fit.
 */
export default function QueuebirdThumb({ url = "demo.polishd.site" }: { url?: string }) {
  const frame = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const f = frame.current!;
    const fit = () => stage.current!.style.setProperty("--s", String(f.clientWidth / W));
    const ro = new ResizeObserver(fit);
    ro.observe(f);
    fit();
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={frame}
      aria-hidden
      className="relative w-full overflow-hidden rounded-[10px] bg-black ring-1 ring-white/10"
      style={{ aspectRatio: `${W} / ${H + CHROME}` }}
    >
      <div
        ref={stage}
        className="absolute left-0 top-0 origin-top-left font-[system-ui,-apple-system,'Segoe_UI',sans-serif]"
        style={{ width: W, height: H + CHROME, transform: "scale(var(--s, 0.3))" }}
      >
        {/* Browser chrome. */}
        <div className="absolute inset-x-0 top-0 h-[44px] border-b border-[#222] bg-[#161616]">
          <div className="absolute left-[18px] top-[15px] flex gap-2">
            <i className="block size-[13px] rounded-full bg-[#ff5f57]" />
            <i className="block size-[13px] rounded-full bg-[#febc2e]" />
            <i className="block size-[13px] rounded-full bg-[#28c840]" />
          </div>
          <div className="absolute left-1/2 top-[8px] flex h-7 w-[420px] -translate-x-1/2 items-center justify-center rounded-lg bg-[#0b0b0b] text-[14px] text-[#8a8a8a]">
            {url}
          </div>
        </div>

        {/* The page. */}
        <div className="absolute inset-x-0 bottom-0 overflow-hidden bg-black" style={{ top: CHROME }}>
          <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,#000_60%,transparent_100%)]" />

          {/* Nav. */}
          <div className="relative flex h-16 items-center gap-10 border-b border-white/10 px-12">
            <div className="flex items-center gap-2.5">
              <span className="block size-8 rounded-[10px] bg-[#8b5cf6]" />
              <span className="text-[19px] font-semibold tracking-tight text-white">queuebird</span>
            </div>
            <div className="flex gap-7 text-[15px] text-[#a1a1aa]">
              <span>Docs</span>
              <span>Pricing</span>
              <span>Changelog</span>
            </div>
            <span className="ml-auto rounded-full bg-white px-[18px] py-[7px] text-[14px] font-medium text-black">Get started</span>
          </div>

          {/* Hero. */}
          <div className="relative mx-auto flex max-w-[900px] flex-col items-center pt-20 text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-[#8b5cf6]/30 bg-[#8b5cf6]/10 py-1 pl-1 pr-[13px] text-[13px] text-[#c4b5fd]">
              <span className="rounded-full bg-[#8b5cf6] px-2 py-0.5 text-[11px] font-semibold text-white">New</span>
              Queuebird 2.0 — multi-step workflows are here →
            </span>
            <div className="mt-8 text-[72px] font-bold leading-[1.05] tracking-tight text-white">
              Background jobs that
              <br />
              <span className="text-[#c084fc]">just work.</span>
            </div>
            <p className="mt-6 max-w-[640px] text-[20px] leading-relaxed text-[#71717a]">
              Durable queues, retries, cron and multi-step workflows for TypeScript. No Redis to run, no workers to
              babysit — just functions.
            </p>
            <div className="mt-10 flex gap-4">
              <span className="rounded-xl bg-[#6366f1] px-6 py-3 text-[16px] font-semibold text-white">
                Start building →
              </span>
              <span className="rounded-lg border border-[#27272a] bg-[#18181b]/60 px-6 py-3 text-[16px] font-medium text-[#d4d4d8]">
                Read the docs
              </span>
            </div>
            <span className="mt-10 flex items-center gap-4 rounded-[10px] border border-[#262626] bg-[#171717] py-[7px] pl-4 pr-[7px] font-mono text-[14px] text-[#d4d4d4]">
              <span>
                <span className="text-[#525252]">$ </span>npm i queuebird
              </span>
              <span className="grid size-7 place-items-center rounded-md text-[#737373]">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <rect x="8" y="8" width="13" height="13" rx="2" />
                  <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                </svg>
              </span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
