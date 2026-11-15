"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { SectionHead, Wrap } from "@/components/kit";
import DotBottle from "@/components/dot-bottle";
import { WALKTHROUGH } from "@/lib/findings";

/**
 * How it works, as the film's second half: five steps on the left, and on
 * the right the dashboard they happen in, pinned while you read. Whichever
 * step crosses the middle of the screen drives the panel. On a phone each
 * step carries its own copy of the panel instead.
 */

type Step = { n: string; k: string; title: string; body: ReactNode; tab: number };

const STEPS: Step[] = [
  {
    n: "00",
    k: "Install",
    title: "One command. Three files.",
    tab: -1,
    body: (
      <>
        <Code>init</Code> detects your app and writes the capture script, the ingest route and the
        dashboard page. No proxy, no middleware, no config. <Code>doctor</Code> checks the wiring that
        would otherwise fail silently.
      </>
    ),
  },
  {
    n: "01",
    k: "Design",
    title: "Reads back the design you shipped.",
    tab: 2,
    body: (
      <>
        Palette, type scale, radii and spacing, reverse-engineered from the pages your visitors
        actually render. Every one-off is flagged against the system it breaks: near-duplicate
        colours, contrast failures, spacing off the grid, arbitrary values standing in for a theme.
      </>
    ),
  },
  {
    n: "02",
    k: "Behaviour",
    title: "Watches real people use it.",
    tab: 1,
    body: (
      <>
        Rage clicks, dead clicks, scroll depth, web vitals and the paths people take, from real
        sessions. Anonymous by design: one httpOnly session cookie, no fingerprinting, no personal
        data — written to your own database.
      </>
    ),
  },
  {
    n: "03",
    k: "Analyse",
    title: "Turns the numbers into a story.",
    tab: 0,
    body: (
      <>
        The model you choose reads a compact digest of the aggregates — never raw events — and
        writes what&apos;s really happening in plain English, beside a design review. Anything it
        cites that isn&apos;t in your data is thrown away.
      </>
    ),
  },
  {
    n: "04",
    k: "Fix",
    title: "Rough edges become pull requests.",
    tab: 3,
    body: (
      <>
        Everything lands in one Actionables list, cited to the page, selector and source file.
        File it to GitHub in one click. <span className="text-fg-2">Create fix</span> hands the issue
        to your coding agent, which checks it&apos;s real and opens a pull request — or says why it
        changed nothing.
      </>
    ),
  },
];

const TABS = ["Overview", "Analytics", "Design", "Actionables"];

function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-raised px-1 py-0.5 font-mono text-[0.88em] text-fg-2 ring-1 ring-inset ring-line">{children}</code>;
}

export default function HowItWorks() {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.step));
        }
      },
      { rootMargin: "-48% 0px -48% 0px" },
    );
    refs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <section id="how" className="relative z-10 py-24 md:py-32">
      <Wrap wide>
        <div className="mx-auto max-w-[1080px]">
          <SectionHead
            lead={<>From a real session</>}
            title={<>to a merged fix.</>}
            sub="Five steps, all of them shipping today. Scroll through them on the dashboard they happen in, filled in with the demo app's real numbers. The two reviews and the pull request are examples."
          />
        </div>

        <div className="mt-10 grid gap-x-14 lg:mt-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
          {/* Steps. */}
          <div>
            {STEPS.map((s, i) => (
              <div
                key={s.n}
                ref={(el) => {
                  refs.current[i] = el;
                }}
                data-step={i}
                className="flex flex-col justify-center py-10 lg:min-h-[78vh] lg:py-0"
              >
                <div className={`transition-opacity duration-500 ${active === i ? "lg:opacity-100" : "lg:opacity-35"}`}>
                  <div className="flex items-center gap-3 font-mono text-[12px] uppercase tracking-[0.16em]">
                    <span
                      className={`step-dot grid size-7 place-items-center rounded-full text-[11px] ring-1 ring-inset ${
                        active === i ? "bg-fg text-black ring-fg" : "bg-surface text-fg-3 ring-line-strong"
                      }`}
                    >
                      {s.n}
                    </span>
                    <span className="text-fg-3">{s.k}</span>
                  </div>
                  <h3 className="mt-5 text-balance font-heading text-[clamp(28px,3.2vw,40px)] font-semibold leading-[1.06] text-fg">
                    {s.title}
                  </h3>
                  <p className="mt-4 max-w-[46ch] font-chart text-[15.5px] leading-[1.65] text-fg-3">{s.body}</p>
                </div>
                {/* Phones: the panel goes with its step. */}
                <div className="mt-8 lg:hidden">
                  <Window tab={s.tab}>
                    <Panel i={i} on />
                  </Window>
                </div>
              </div>
            ))}
          </div>

          {/* The dashboard, pinned. */}
          <div className="relative hidden lg:block">
            <div className="sticky top-[calc(50vh-300px)] py-[9vh]">
              <Window tab={STEPS[active].tab}>
                {STEPS.map((s, i) => (
                  <Panel key={s.n} i={i} on={active === i} />
                ))}
              </Window>
              {/* Progress. */}
              <div className="mt-5 flex items-center justify-center gap-2">
                {STEPS.map((s, i) => (
                  <span
                    key={s.n}
                    className={`h-1 rounded-full transition-[width,background-color] duration-500 ease-[var(--ease-out)] ${
                      i === active ? "w-8 bg-fg" : i < active ? "w-3 bg-fg-3" : "w-3 bg-line-strong"
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </Wrap>
    </section>
  );
}

/** The dashboard's frame: the mark, the tabs, a body. */
function Window({ tab, children }: { tab: number; children: ReactNode }) {
  return (
    <div className="font-chart overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_40px_120px_-30px_rgba(0,0,0,.9),0_0_0_1px_rgba(255,255,255,.02)]">
      <div className="flex h-12 items-center gap-5 border-b border-line px-4 sm:gap-7 sm:px-5">
        <span className="flex items-end font-highway text-[17px] font-extrabold lowercase leading-none tracking-[-0.03em] text-fg">
          polis
          <DotBottle className="mx-[0.02em] inline-block h-[0.73em]" />d
        </span>
        <div className="relative flex h-full items-center gap-4 sm:gap-6">
          {TABS.map((t, i) => (
            <span
              key={t}
              className={`relative flex h-full items-center text-[12.5px] transition-colors duration-300 ${
                i === tab ? "text-fg" : "text-fg-4"
              } ${i === 0 || i === 3 ? "" : "max-sm:hidden"}`}
            >
              {t}
              <span
                className={`absolute inset-x-0 bottom-0 h-[2px] bg-fg transition-[opacity,transform] duration-300 ease-[var(--ease-out)] ${
                  i === tab ? "opacity-100" : "scale-x-50 opacity-0"
                }`}
              />
            </span>
          ))}
        </div>
        <span className="ml-auto hidden font-mono text-[11px] text-fg-4 sm:block">/polishd</span>
      </div>
      <div className="relative h-[480px] sm:h-[520px]">{children}</div>
    </div>
  );
}

function Panel({ i, on }: { i: number; on: boolean }) {
  const Body = [InstallPanel, DesignPanel, BehaviourPanel, AnalysePanel, FixPanel][i];
  return (
    <div className="step-panel absolute inset-0 overflow-hidden p-4 sm:p-6" data-on={on ? "1" : ""} aria-hidden={!on}>
      <Body />
    </div>
  );
}

const k = (n: number) => ({ "--k": n }) as CSSProperties;
const lab = "text-[10.5px] font-semibold uppercase tracking-[0.08em] text-fg-3";
const sub = "rounded-xl border border-line bg-sunken";

function InstallPanel() {
  const L: [string, string, string?][] = [
    ["$", "npm i @polishd/next", "cmd"],
    ["", "added 1 package"],
    ["$", "npx @polishd/next init", "cmd"],
    ["✔", "Detected Next.js App Router", "ok"],
    ["✔", "Created instrumentation-client.ts", "ok"],
    ["✔", "Created app/api/polishd/route.ts", "ok"],
    ["✔", "Created app/polishd/page.tsx", "ok"],
    ["✔", "Created polishd.defaults.json", "ok"],
    ["", ""],
    ["$", "npx @polishd/next doctor", "cmd"],
    ["✓", "Capture, ingest and dashboard wired", "ok"],
    ["✓", "Store writable · .polishd/analytics.db", "ok"],
  ];
  return (
    <div className={`${sub} h-full p-5 font-mono text-[12.5px] leading-[1.9] sm:p-7 sm:text-[13.5px]`}>
      {L.map(([p, s, kind], n) => (
        <div key={n} className="tl whitespace-nowrap" style={k(n)}>
          <span className={kind === "ok" ? "text-ok" : "text-fg-4"}>{p}</span>
          {p ? " " : ""}
          <span className={kind === "cmd" ? "text-fg" : kind === "ok" ? "text-fg-2" : "text-fg-4"}>{s || " "}</span>
        </div>
      ))}
      <div className="tl mt-1 inline-block h-4 w-2 translate-y-0.5 bg-fg-3 blip" style={k(L.length)} />
    </div>
  );
}

function DesignPanel() {
  const W = WALKTHROUGH.design;
  return (
    <div className="grid h-full grid-rows-[auto_auto_1fr] gap-3">
      <div className={`st ${sub} p-4`} style={k(0)}>
        <div className="flex items-center justify-between">
          <span className={lab}>Palette as shipped</span>
          <span className="font-mono text-[11px] text-bad">{W.paletteNote}</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-1">
          {W.palette.map((c, n) => (
            <span key={n} className="size-5 rounded-[5px] ring-1 ring-inset ring-white/10" style={{ backgroundColor: c }} />
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 font-mono text-[11px] text-fg-4">
          <span>brand kit</span>
          {W.kit.map(([name, hex]) => (
            <span key={name} className="flex items-center gap-1.5 rounded-md bg-raised px-1.5 py-0.5 text-fg-2 ring-1 ring-inset ring-line">
              <span className="size-2.5 rounded-sm ring-1 ring-inset ring-white/15" style={{ backgroundColor: hex }} />
              {name}
            </span>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className={`st ${sub} p-4`} style={k(1)}>
          <span className={lab}>Font sizes · {W.typeScale.length}</span>
          <div className="mt-3 flex flex-wrap items-end gap-x-1 gap-y-2">
            {W.typeScale.map((s) => (
              <span key={s} className="flex flex-col items-center gap-1">
                <span className="font-semibold leading-none text-fg" style={{ fontSize: Math.max(7, Math.round(s * 0.3)) }}>
                  Aa
                </span>
                <span className="font-mono text-[9.5px] text-fg-4">{s}</span>
              </span>
            ))}
          </div>
        </div>
        <div className={`st ${sub} p-4`} style={k(2)}>
          <span className={lab}>Corner radii · {W.radii.length}</span>
          <div className="mt-3 flex flex-wrap items-end gap-1">
            {W.radii.map((r) => (
              <span key={r} className="flex flex-col items-center gap-1">
                <span className="block size-5 border-[1.5px] border-fg-3 bg-raised" style={{ borderRadius: r }} />
                <span className="font-mono text-[9.5px] text-fg-4">{r}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className={`st ${sub} overflow-hidden p-1.5`} style={k(3)}>
        {W.flags.map((f, n) => (
          <div key={n} className="flex items-center gap-3 rounded-lg px-3 py-[7px] odd:bg-raised/60">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${f.tone === "bad" ? "bg-bad" : "bg-warn"}`} />
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg">{f.title}</span>
            <span className="shrink-0 font-mono text-[11px] text-fg-4">{f.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BehaviourPanel() {
  const W = WALKTHROUGH.behaviour;
  return (
    <div className="grid h-full grid-rows-[auto_1fr_auto] gap-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {W.metrics.map((m, n) => (
          <div key={m.label} className={`st ${sub} p-3.5`} style={k(n)}>
            <div className={lab}>{m.label}</div>
            <div className={`mt-2 text-[26px] font-semibold leading-none tracking-[-0.01em] ${m.tone === "bad" ? "text-bad" : m.tone === "warn" ? "text-warn" : "text-fg"}`}>
              {m.value}
            </div>
            <div className="mt-1.5 font-mono text-[10.5px] text-fg-4">{m.note}</div>
          </div>
        ))}
      </div>
      <div className={`st ${sub} p-4`} style={k(4)}>
        <span className={lab}>Where people struggle</span>
        <div className="mt-4 space-y-4">
          {W.struggle.map((s, n) => (
            <div key={n}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate font-mono text-[12px] text-fg">{s.label}</span>
                <span className={`shrink-0 font-mono text-[11px] ${s.tone === "bad" ? "text-bad" : "text-warn"}`}>{s.value}</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-raised">
                <div className={`h-full rounded-full ${s.tone === "bad" ? "bg-bad" : "bg-warn"}`} style={{ width: `${s.share}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="st flex flex-wrap gap-2" style={k(5)}>
        {[
          ["bg-ok", "SQLite · dev"],
          ["bg-blue", "Postgres · production"],
          ["bg-violet", "no analytics vendor"],
        ].map(([c, s]) => (
          <span key={s} className="flex items-center gap-2 rounded-lg border border-line-strong bg-raised px-3 py-1.5 font-mono text-[11px] text-fg-2">
            <span className={`h-1.5 w-1.5 rounded-full ${c}`} />
            {s}
          </span>
        ))}
      </div>
    </div>
  );
}

function AnalysePanel() {
  const W = WALKTHROUGH.analyse;
  return (
    <div className="grid h-full grid-rows-[1fr_auto] gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {W.reviews.map((r, n) => (
          <div key={r.title} className={`st ${sub} p-4`} style={k(n)}>
            <div className={`${lab} flex items-center gap-2`}>
              <span className={`h-1.5 w-1.5 rounded-full ${r.tone === "bad" ? "bg-bad" : "bg-blue"}`} />
              {r.title}
              <span className="ml-auto normal-case tracking-normal text-fg-4">example</span>
            </div>
            <p className="mt-3 text-[13.5px] leading-[1.6] text-fg-2 sm:text-[14px]">{r.body}</p>
          </div>
        ))}
      </div>
      <div className="st flex flex-wrap items-center gap-3" style={k(2)}>
        <span className="inline-flex h-9 items-center gap-2 rounded-lg bg-fg px-3.5 text-[13px] font-semibold text-black">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
            <rect x="5" y="5" width="9" height="9" rx="2" />
            <path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" />
          </svg>
          Copy fix prompt
        </span>
        <span className="font-mono text-[11px] text-fg-4">{W.promptNote}</span>
      </div>
    </div>
  );
}

function FixPanel() {
  const W = WALKTHROUGH.fix;
  return (
    <div className="grid h-full grid-rows-[auto_1fr] gap-3">
      <div className="space-y-2">
        {W.rows.map((r, n) => (
          <div key={r.title} className={`st flex items-center gap-3 rounded-xl border border-line bg-raised px-3.5 py-2.5`} style={k(n)}>
            <span
              className={`flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 font-mono text-[9.5px] font-semibold uppercase tracking-[0.08em] ${
                r.source === "Design" ? "bg-blue/10 text-blue" : "bg-bad/10 text-bad"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${r.source === "Design" ? "bg-blue" : "bg-bad"}`} />
              {r.source}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] text-fg">{r.title}</span>
              <span className="block truncate font-mono text-[10.5px] text-fg-4">{r.cite}</span>
            </span>
            <span
              className={`hidden shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11.5px] font-medium sm:flex ${
                n === 0 ? "border-ok/30 bg-ok/10 text-ok" : "border-line-strong text-fg-2"
              }`}
            >
              {n === 0 ? `Issue #${W.issue} · fixing` : "File issue"}
            </span>
          </div>
        ))}
      </div>
      <div className="st rounded-xl border border-[#30363d] bg-[#0d1117] p-4 sm:p-5" style={k(3)}>
        <div className="flex items-center gap-2 font-mono text-[11px] text-[#8b949e]">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="#3fb950" aria-hidden>
            <path d="M5 3.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0zm0 2.122a2.25 2.25 0 1 0-1.5 0v5.256a2.25 2.25 0 1 0 1.5 0V5.372zM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zM11 2.5h-1V4h1a1 1 0 0 1 1 1v5.628a2.25 2.25 0 1 0 1.5 0V5A2.5 2.5 0 0 0 11 2.5zm1 10.25a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0z" />
          </svg>
          PULL REQUEST #{W.pr} · opened by your coding agent
        </div>
        <div className="mt-2.5 text-[16px] font-semibold text-[#f0f6fc] sm:text-[17px]">{W.prTitle}</div>
        <div className="mt-1 font-mono text-[11px] text-[#8b949e]">
          Fixes #{W.issue} · {W.prFiles} · <span className="text-[#3fb950]">+{W.plus}</span>{" "}
          <span className="text-[#f85149]">−{W.minus}</span>
        </div>
        <div className="mt-3.5 overflow-hidden rounded-lg border border-[#30363d] font-mono text-[11.5px] sm:text-[12px]">
          {W.diff.map(([sign, line], n) => (
            <div
              key={n}
              className={`truncate px-3 py-1 ${sign === "-" ? "bg-[rgba(248,81,73,.12)] text-[#ffa198]" : "bg-[rgba(63,185,80,.12)] text-[#7ee787]"}`}
            >
              {sign} {line}
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <span className="flex items-center gap-2 text-[12.5px] text-[#3fb950]">✓ All checks have passed</span>
          <span className="ml-auto rounded-lg bg-[#238636] px-3 py-1.5 text-[12.5px] font-semibold text-white">Ready to merge</span>
        </div>
      </div>
    </div>
  );
}
