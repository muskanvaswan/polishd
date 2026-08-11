import { Eyebrow, Heading, Pill, Sub, Wrap } from "@/components/ui";

const STATS = [
  { k: "Sessions", v: 1253, tone: "text-white" },
  { k: "Page views", v: 4850, tone: "text-white" },
  { k: "Rage clicks", v: 53, tone: "text-red-500" },
  { k: "Dead clicks", v: 1025, tone: "text-[#f5a623]" },
  { k: "JS errors", v: 4, tone: "text-red-500" },
  { k: "Events", v: 19541, tone: "text-white" },
];

const DEVICES = [
  { name: "Mobile", pct: 86.8, meta: "1087 sessions" },
  { name: "Desktop", pct: 11.3, meta: "141 sessions" },
  { name: "Tablet", pct: 1.9, meta: "24 sessions" },
];

const WINS = [
  "Deep engagement on long reads — an average dwell of nearly 32 minutes.",
  "Strong adoption of the narration feature: 254 clicks across 6 pages.",
  "Core articles scrolled clean through to 100% completion.",
];

export default function Proof() {
  return (
    <section id="live" className="py-[76px] md:py-28">
      <Wrap>
        <Eyebrow>Live today · stages 01–04</Eyebrow>
        <Heading>
          What gets measured,
          <br />
          <span className="text-[#666]">gets improved.</span>
        </Heading>
        <Sub>
          Refining needs evidence. This is the captured half of the loop — no surveys, no
          session-replay creep, running on your own database, on a dashboard at{" "}
          <code className="font-mono text-[#aaa]">/polishd</code>.
        </Sub>

        <div className="mt-[34px] grid grid-cols-2 gap-2.5 min-[460px]:grid-cols-3 lg:grid-cols-6">
          {STATS.map((s, i) => (
            <div
              key={s.k}
              className="card r p-4"
              style={{ "--d": `${i * 60}ms` } as React.CSSProperties}
            >
              <div
                className={`text-[27px] font-semibold leading-none tracking-[-0.02em] tabular-nums ${s.tone}`}
                data-count={s.v}
              >
                {/* Real value server-side (no-JS + crawlers); the observer
                    resets it to 0 on mount and counts it back up. */}
                {s.v.toLocaleString("en-US")}
              </div>
              <div className="label mt-2.5">{s.k}</div>
            </div>
          ))}
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_1.35fr]">
          {/* Stage 02 — measured. */}
          <div className="card r lift overflow-hidden">
            <div className="flex items-center gap-2.5 border-b border-[#2e2e2e] px-4 py-[13px]">
              <span className="label">Device sizes</span>
              <span className="rounded-full bg-[#1a1a1a] px-2.5 py-[3px] font-mono text-[10px] text-[#888]">
                1,253 sessions
              </span>
            </div>

            {DEVICES.map((d) => (
              <div
                key={d.name}
                className="flex items-center gap-3.5 border-t border-[#2e2e2e] px-4 py-[13px] first:border-t-0"
              >
                <span className="w-[74px] flex-none text-[13px] font-medium">{d.name}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-[#1a1a1a]">
                  <span
                    className="fill block h-full rounded-full bg-blue-500"
                    data-w={d.pct}
                    style={{ "--w": d.pct } as React.CSSProperties}
                  />
                </span>
                <span className="w-[52px] text-right text-[13px] font-semibold tabular-nums">
                  {d.pct}%
                </span>
              </div>
            ))}

            <div className="border-t border-[#2e2e2e] px-4 py-[13px] text-[12.5px] leading-[1.2] text-[#666]">
              Built for desktop. Read on mobile.{" "}
              <span className="text-[#e4e4e4]">That&apos;s a finding, not a number.</span>
            </div>
          </div>

          {/* Stages 03 + 04 — the story, then the bug. */}
          <div
            className="card r lift overflow-hidden"
            style={{ "--d": "120ms" } as React.CSSProperties}
          >
            <div className="flex items-center gap-2.5 border-b border-[#2e2e2e] px-4 py-[13px]">
              <span className="label">All you need to know</span>
              <Pill className="ml-auto">Collecting</Pill>
            </div>

            <div className="p-5">
              <p className="text-[14px] leading-[1.3] text-[#e4e4e4]">
                Designed as a desktop-first reading experience, yet{" "}
                <b className="font-medium text-white">86.8%</b> of visitors arrive on mobile.
                Attention is excellent — long reads hold for minutes — but people keep tapping
                static text as though it were a link, and one article records no scroll at all.
              </p>

              <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2 md:gap-6">
                <div>
                  <h3 className="mb-3 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-emerald-400">
                    Wins
                  </h3>
                  <ul className="space-y-3">
                    {WINS.map((w) => (
                      <li
                        key={w}
                        className="flex gap-2.5 text-[13px] leading-[1.15] text-[#bbb]"
                      >
                        <span className="text-emerald-400">✓</span>
                        <span>{w}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <h3 className="mb-3 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-red-400">
                    Losses
                  </h3>
                  <ul className="space-y-4">
                    <li className="flex gap-2.5 text-[13px] leading-[1.15] text-[#bbb]">
                      <span className="text-red-400">✕</span>
                      <span>
                        Zero recorded scroll depth on one article — likely a viewport or script
                        failure.
                        <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <code className="rounded-[5px] bg-[#1a1a1a] px-1.5 py-0.5 font-mono text-[10px] text-[#888]">
                            /posts/…-loneliness
                          </code>
                          <FileBug />
                        </span>
                      </span>
                    </li>
                    <li className="flex gap-2.5 text-[13px] leading-[1.15] text-[#bbb]">
                      <span className="text-red-400">✕</span>
                      <span>
                        Users rage-click static text, mistaking styling for interactivity.
                        <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <code className="rounded-[5px] bg-[#101c14] px-1.5 py-0.5 font-mono text-[10px] text-emerald-500">
                            src/lib/api.ts
                          </code>
                          <FileBug />
                        </span>
                      </span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Wrap>
    </section>
  );
}

/** Stage 04 in one control: the finding, already shaped like a ticket. */
function FileBug() {
  return (
    <span className="rounded-[5px] border border-[#2e2e2e] px-1.5 py-0.5 text-[10px] text-[#888]">
      File bug
    </span>
  );
}
