import BrandBoard from "@/components/dash/brand-board";
import ActionablesPointer from "@/components/dash/pointer";
import { RefreshIcon, SparkIcon } from "@/components/dash/icons";
import {
  Badge,
  Callout,
  ColorToken,
  ContrastMeter,
  ContrastToken,
  IconBtn,
  StatusPill,
  cardHeader,
  cardTitleCls,
  contrastPercent,
} from "@/components/dash/ui";
import { Eyebrow, Heading, Sub, Wrap } from "@/components/ui";

/**
 * The design review, told as the thing it actually is: a brand guide written
 * backwards.
 *
 * Everything else on this page is behavioural — what people *did*. This
 * section is the other axis, shown as the dashboard's own components rather
 * than a picture of the whole tab: the Overview's brand board for the
 * palette — the colors a site really ships, one-offs left out — then the
 * measurements the Design tab makes: type specimens, the pairings that fail
 * WCAG, the radii and padding in use, and the model's read of all of it,
 * which hands its findings to the Actionables tab. One-offs and off-grid
 * values are flagged the way the tab flags them.
 *
 * The site measured is an editorial site in Georgia and Helvetica with one
 * rust for actions. The values are illustrative; every flag is the
 * arithmetic the real tab runs.
 */

const MODEL = "anthropic/claude-sonnet-5-5";
const MODEL_BADGE = "anthropic · claude-sonnet-5-5";

const SERIF = 'Georgia, "Times New Roman", serif';
const SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif';

/** The type scale as it usually ends up: mostly deliberate, partly not. */
const SPECIMENS = [
  { px: 44, weight: 700, css: SERIF, uses: 12 },
  { px: 28, weight: 400, css: SERIF, uses: 31 },
  { px: 21, weight: 500, css: SERIF, uses: 3, outlier: true },
  { px: 17, weight: 400, css: SANS, uses: 388 },
  { px: 15, weight: 400, css: SANS, uses: 6, outlier: true },
  { px: 14, weight: 500, css: SANS, uses: 96 },
  { px: 13, weight: 500, css: SANS, uses: 205 },
];

const CONTRAST = [
  { fg: "#a8a29e", bg: "#ffffff", ratio: 2.6, required: 4.5, px: 13 },
  { fg: "#78716c", bg: "#f5f1ea", ratio: 4.3, required: 4.5, px: 17 },
];

const RADII = [
  { value: "4px", uses: 41 },
  { value: "6px", uses: 18 },
  { value: "8px", uses: 27 },
  { value: "12px", uses: 9 },
  { value: "14px", uses: 2, outlier: true },
  { value: "full", uses: 12 },
];

const SPACING = [
  { px: 8, uses: 41 },
  { px: 12, uses: 26 },
  { px: 13, uses: 4, offGrid: true },
  { px: 16, uses: 58 },
  { px: 18, uses: 16, offGrid: true },
  { px: 22, uses: 9, offGrid: true },
];
const SPACING_MAX = 24;

const delay = (ms: number) => ({ "--d": `${ms}ms` }) as React.CSSProperties;

export default function Design() {
  return (
    <section id="design" className="py-[76px] md:py-28">
      <Wrap>
        <Eyebrow>Live today · the design tab</Eyebrow>
        <Heading>
          You already have a design system.
          <br />
          <span className="text-fg-4">Nobody ever wrote it down.</span>
        </Heading>
        <Sub>
          Forty files of generated components, and somewhere in them a type scale, a palette and a
          spacing rhythm that nobody chose on purpose. Polishd reads it back out of your rendered
          pages and prints the brand guide you never made — after the build, not before.
        </Sub>

        <div className="mt-[34px] grid grid-cols-1 gap-3 lg:grid-cols-[1.25fr_1fr]">
          <div className="grid content-start gap-3">
            {/* The palette, as the Overview's brand board draws it: the system
                the pages actually ship, ranked, one-offs left out. */}
            <div className="card font-chart r lift overflow-hidden text-fg">
              <div className={cardHeader}>
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className={cardTitleCls}>Color palette</span>
                  <Badge showFrom="sm">one-offs left out</Badge>
                </div>
                <StatusPill tone="ok">7 pages scanned</StatusPill>
              </div>
              <div className="p-4 sm:p-5">
                <BrandBoard />
              </div>
              <Callout tone="warn" className="mx-4 mb-4 sm:mx-5">
                <ColorToken hex="#c4400d" /> sits one step from <ColorToken hex="#c2410c" /> and
                covers 1% of the UI, so it isn&apos;t on the board. One of the two is a typo nobody
                has noticed.
              </Callout>
            </div>

            {/* The specimen sheet — every size the site ships, one-offs included. */}
            <div className="card font-chart r lift overflow-hidden text-fg" style={delay(90)}>
              <div className={cardHeader}>
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className={cardTitleCls}>Typography</span>
                  <Badge showFrom="sm">measured on 7 pages</Badge>
                </div>
                <span className="text-[12px] text-fg-3">16 sizes</span>
              </div>

              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-4 px-4 pt-5 pb-4 sm:px-5">
                {SPECIMENS.map((s) => (
                  <div key={`${s.px}-${s.weight}`} className="flex flex-col items-start">
                    <span
                      className="leading-none text-fg"
                      style={{ fontFamily: s.css, fontSize: `${s.px}px`, fontWeight: s.weight }}
                    >
                      Aa
                    </span>
                    <span className="mt-2 flex items-center gap-1.5">
                      <span
                        className={`rounded-md bg-raised px-1.5 py-0.5 font-mono text-[11px] tabular-nums ring-1 ring-inset ring-line-strong ${
                          s.outlier ? "text-warn" : "text-fg-2"
                        }`}
                      >
                        {s.px}px / {s.weight}
                      </span>
                      <span className="text-[11.5px] tabular-nums text-fg-3">×{s.uses}</span>
                    </span>
                  </div>
                ))}
                <span className="self-center rounded-md bg-raised px-2 py-1 text-[11px] font-medium text-fg-3 ring-1 ring-inset ring-line-strong">
                  +9 more
                </span>
              </div>

              <Callout tone="warn" className="mx-4 mb-4 sm:mx-5">
                Sixteen sizes across seven pages, nine of them used fewer than five times. Those
                aren&apos;t steps in a scale — they&apos;re accidents with a font-size.
              </Callout>
            </div>

            <div className="card font-chart r lift overflow-hidden text-fg" style={delay(150)}>
              <div className={cardHeader}>
                <span className={cardTitleCls}>Corner radii</span>
                <Badge tone="warn">6 radii</Badge>
              </div>

              <div className="flex flex-wrap items-end gap-4 px-4 pt-5 sm:px-5">
                {RADII.map((r) => (
                  <div key={r.value} className="flex flex-col items-center gap-1.5">
                    <div
                      className="h-10 w-10 border-[1.5px] border-accent/70 bg-accent/[0.07]"
                      style={{ borderRadius: r.value === "full" ? "9999px" : r.value }}
                    />
                    <span className={`font-mono text-[11.5px] ${r.outlier ? "text-warn" : "text-fg-2"}`}>
                      {r.value}
                    </span>
                    <span className="-mt-1 text-[11px] tabular-nums text-fg-3">×{r.uses}</span>
                  </div>
                ))}
              </div>

              <Callout tone="warn" className="mx-4 my-4 sm:mx-5">
                6 distinct corner radii (4px, 6px, 8px, 12px, 14px, full) — most systems settle on
                2–4 (e.g. small, medium, full).
              </Callout>
            </div>
          </div>

          {/* The checks a person would have to run by hand, and never does. */}
          <div className="grid content-start gap-3">
            <div className="card font-chart r lift overflow-hidden text-fg" style={delay(60)}>
              <div className={cardHeader}>
                <span className={cardTitleCls}>Contrast</span>
                <Badge tone="bad">2 pairs fail AA</Badge>
              </div>

              {CONTRAST.map((p, i) => (
                <div
                  key={p.fg + p.bg}
                  className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3.5 sm:px-5 ${
                    i === 0 ? "" : "border-t border-line"
                  }`}
                >
                  <span
                    className="flex h-10 w-14 shrink-0 items-center justify-center rounded-lg text-[15px] font-semibold ring-1 ring-inset ring-fg/10"
                    style={{ backgroundColor: p.bg, color: p.fg }}
                  >
                    Aa
                  </span>
                  <span className="flex items-center gap-1.5 text-[12px] text-fg-3">
                    <ColorToken hex={p.fg} /> on <ColorToken hex={p.bg} />
                  </span>
                  <span className="flex items-center gap-2.5">
                    <ContrastMeter ratio={p.ratio} required={p.required} />
                    <span className="text-[12px] tabular-nums text-fg-3">
                      needs {contrastPercent(p.required)}% at {p.px}px
                    </span>
                  </span>
                </div>
              ))}

              <div className="border-t border-line px-4 py-3 text-[12.5px] leading-relaxed text-fg-3 sm:px-5">
                A hair under the line, on your body text.{" "}
                <span className="text-fg">Nobody eyeballs that.</span>
              </div>
            </div>

            <div className="card font-chart r lift overflow-hidden text-fg" style={delay(120)}>
              <div className={cardHeader}>
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="text-accent">
                    <SparkIcon size={15} />
                  </span>
                  <span className={cardTitleCls}>Aesthetic review</span>
                  <Badge mono showFrom="xl">
                    {MODEL_BADGE}
                  </Badge>
                </div>
                <IconBtn>
                  <RefreshIcon />
                </IconBtn>
              </div>

              <div className="px-4 py-4 sm:px-5">
                <p className="text-[13.5px] leading-[1.65] text-fg">
                  One serif for display and one rust for every action: this reads as a single
                  publication. What breaks it is the long tail — sizes and greys that appear once,
                  doing a job an existing token already does, and a byline grey (
                  <ColorToken hex="#a8a29e" /> on <ColorToken hex="#ffffff" />,{" "}
                  <ContrastToken ratio={2.6} />) that costs readers on every post.
                </p>
                <ActionablesPointer count={3} tone="bg-warn" from="the design review" />
                <p className="mt-3 text-[12px] text-fg-3">
                  Generated 2h ago · {MODEL} · with screenshots of 3 pages and 4 flagged values
                </p>
              </div>
            </div>

            <div className="card font-chart r lift overflow-hidden text-fg" style={delay(180)}>
              <div className={cardHeader}>
                <span className={cardTitleCls}>Spacing</span>
                <Badge tone="warn">30% off-grid</Badge>
              </div>

              <div className="space-y-2 px-4 pt-5 sm:px-5">
                {SPACING.map((s) => {
                  const w = Math.max((s.px / SPACING_MAX) * 100, 2);
                  return (
                    <div key={s.px} className="flex items-center gap-3">
                      <span className="w-9 shrink-0 text-right font-mono text-[11.5px] tabular-nums text-fg-2">
                        {s.px}px
                      </span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-raised">
                        <div
                          className={`fill h-full rounded-full ${s.offGrid ? "bg-warn/80" : "bg-accent/80"}`}
                          data-w={w}
                          style={{ "--w": w } as React.CSSProperties}
                        />
                      </div>
                      <span className="w-9 shrink-0 text-right text-[11.5px] tabular-nums text-fg-3">×{s.uses}</span>
                      <span className="w-14 shrink-0">{s.offGrid && <Badge tone="warn">off-grid</Badge>}</span>
                    </div>
                  );
                })}
              </div>

              <Callout tone="info" className="mx-4 my-4 sm:mx-5">
                30% of padding values sit off a 4px grid (13px, 18px, 22px) — consistent rhythm
                usually comes from a 4px or 8px base unit.
              </Callout>
            </div>
          </div>
        </div>

        <p className="r mt-6 max-w-[68ch] text-[13px] leading-[1.35] text-fg-3" style={delay(180)}>
          Every number above is measured, not guessed — each page tallies its own rendered CSS once
          per visitor session, and the flags are arithmetic. The model gets the last word, on a
          tally it can&apos;t argue with, and it sees the pages too: a review shoots the first
          screen of the top pages and pictures each flagged value in place.
        </p>
      </Wrap>
    </section>
  );
}
