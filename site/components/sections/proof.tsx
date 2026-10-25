import { ArrowRightIcon, CheckIcon, GearIcon, RefreshIcon, SparkIcon } from "@/components/dash/icons";
import ActionablesPointer from "@/components/dash/pointer";
import { StatTile } from "@/components/dash/tiles";
import { Badge, IconBtn, cardHeader, cardTitleCls } from "@/components/dash/ui";
import { Eyebrow, Heading, Sub, Wrap } from "@/components/ui";

/**
 * The shipped half of the loop, as the Analytics tab's own components: the
 * six stat tiles with the shape of each count over time, the device split
 * that explains most of the story, and the summary card — the model's
 * paragraph and its wins. The losses aren't on the card any more: it ends
 * with how many are waiting on the Actionables tab, and on this page that
 * links to the Actionables section.
 *
 * The numbers are illustrative — they mirror a real install, a desktop-first
 * publication read mostly on phones — so the layout is shown at its real
 * density.
 */

const MODEL = "anthropic/claude-sonnet-5-5";
const MODEL_BADGE = "anthropic · claude-sonnet-5-5";

// Fourteen days of each series, for the sparklines.
const STATS = [
  { label: "Sessions", value: 1253, tone: "accent", spark: [38, 52, 47, 61, 58, 73, 69, 84, 77, 95, 102, 96, 118, 131] },
  { label: "Page views", value: 4850, tone: "accent", spark: [140, 190, 175, 230, 220, 280, 265, 330, 300, 370, 410, 380, 460, 505] },
  { label: "Rage clicks", value: 53, tone: "bad", spark: [2, 5, 3, 6, 4, 7, 3, 5, 4, 8, 6, 5, 9, 7] },
  { label: "Dead clicks", value: 1025, tone: "warn", spark: [40, 66, 58, 81, 74, 92, 70, 88, 79, 101, 96, 84, 112, 105] },
  { label: "JS errors", value: 4, tone: "bad", spark: [0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0] },
  { label: "Events", value: 19541, tone: "accent", spark: [900, 1300, 1150, 1500, 1420, 1750, 1600, 1900, 1800, 2100, 2200, 2050, 2450, 2600] },
] as const;

const DEVICES = [
  { name: "Mobile", pct: 86.8, sessions: 1087, px: 390 },
  { name: "Desktop", pct: 11.3, sessions: 141, px: 1440 },
  { name: "Tablet", pct: 1.9, sessions: 24, px: 810 },
];

const WINS = [
  "Deep engagement on long reads — an average dwell of nearly 32 minutes.",
  "Strong adoption of the narration feature: 254 clicks across 6 pages.",
  "Core articles scrolled clean through to 100% completion.",
];

const delay = (ms: number) => ({ "--d": `${ms}ms` }) as React.CSSProperties;

export default function Proof() {
  return (
    <section id="live" className="py-[76px] md:py-28">
      <Wrap>
        <Eyebrow>Live today · stages 01–04</Eyebrow>
        <Heading>
          What gets measured,
          <br />
          <span className="text-fg-4">gets improved.</span>
        </Heading>
        <Sub>
          Refining needs evidence. This is the captured half of the loop — no surveys, no
          session-replay creep, running on your own database, on a dashboard at{" "}
          <code className="font-mono text-fg-2">/polishd</code>.
        </Sub>

        <div className="mt-[34px] grid grid-cols-2 gap-2.5 min-[460px]:grid-cols-3 lg:grid-cols-6">
          {STATS.map((s, i) => (
            <div key={s.label} className="r font-chart text-fg" style={delay(i * 60)}>
              <StatTile label={s.label} value={s.value} tone={s.tone} spark={[...s.spark]} />
            </div>
          ))}
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_1.35fr]">
          {/* Stage 02 — measured. */}
          <div className="card font-chart r lift overflow-hidden text-fg">
            <div className={cardHeader}>
              <div className="flex min-w-0 items-center gap-2.5">
                <span className={cardTitleCls}>Device sizes</span>
                <Badge mono>1,253 sessions</Badge>
              </div>
            </div>

            {DEVICES.map((d) => (
              <div
                key={d.name}
                className="flex items-center gap-3 border-t border-line px-4 py-3.5 text-[12.5px] first:border-t-0 sm:px-5"
              >
                <span className="w-16 shrink-0 font-medium text-fg">{d.name}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-raised">
                  <span
                    className="fill block h-full rounded-full bg-fg"
                    data-w={d.pct}
                    style={{ "--w": d.pct } as React.CSSProperties}
                  />
                </span>
                <span className="w-12 text-right font-semibold tabular-nums text-fg">{d.pct}%</span>
                <span className="hidden w-24 text-right tabular-nums text-fg-3 min-[400px]:block">
                  {d.sessions.toLocaleString("en-US")} sessions
                </span>
                <span className="hidden w-14 text-right font-mono text-[11.5px] text-fg-3 sm:block">
                  ~{d.px}px
                </span>
              </div>
            ))}

            <div className="border-t border-line px-4 py-3.5 text-[12.5px] leading-relaxed text-fg-3 sm:px-5">
              Built for desktop. Read on mobile.{" "}
              <span className="text-fg">That&apos;s a finding, not a number.</span>
            </div>
          </div>

          {/* Stages 03 + 04 — the story, then the bug. */}
          <div className="card font-chart r lift overflow-hidden text-fg" style={delay(120)}>
            <div className={cardHeader}>
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="text-accent">
                  <SparkIcon size={15} />
                </span>
                <span className={cardTitleCls}>All you need to know</span>
                <Badge mono showFrom="sm">
                  {MODEL_BADGE}
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                <IconBtn>
                  <RefreshIcon />
                </IconBtn>
                <IconBtn>
                  <GearIcon />
                </IconBtn>
              </div>
            </div>

            <div className="px-4 py-5 sm:px-5">
              <p className="max-w-[72ch] text-[14.5px] leading-[1.65] text-fg">
                Designed as a desktop-first reading experience, yet{" "}
                <b className="font-semibold">86.8%</b> of visitors arrive on mobile. Attention is
                excellent — long reads hold for minutes — but people keep tapping static text as
                though it were a link, and one article records no scroll at all.
              </p>

              <div className="mt-5">
                <div className="mb-2.5 flex items-center gap-2 text-[13px] font-semibold text-fg">
                  <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-ok" />
                  Wins
                </div>
                <ul className="space-y-2">
                  {WINS.map((w) => (
                    <li key={w} className="flex gap-2.5 text-[13px] leading-snug text-fg-2">
                      <span className="mt-px shrink-0 text-ok">
                        <CheckIcon size={13} />
                      </span>
                      <span>{w}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* The losses wait on the Actionables tab now, with the design
                  review's issues; the card says how many. */}
              <ActionablesPointer count={4} tone="bg-bad" from="the analytics" />

              <div className="mt-4 text-[12px] text-fg-3">
                Generated 2h ago · {MODEL} · refreshes daily
              </div>
            </div>

            {/* The one piece of setup the card surfaces: whether the model has
                read the codebase it's describing. */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-sunken px-4 py-2.5 sm:px-5">
              <span className="text-[12px] text-fg-3">
                3 components have appeared since the last codebase scan.
              </span>
              <span className="inline-flex items-center gap-1 text-[12px] font-medium text-fg-2">
                Re-scan in Settings
                <ArrowRightIcon />
              </span>
            </div>
          </div>
        </div>
      </Wrap>
    </section>
  );
}
