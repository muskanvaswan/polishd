import { Eyebrow, Heading, Pill, Sub, Wrap } from "@/components/ui";

/**
 * The design review, told as the thing it actually is: a brand guide written
 * backwards.
 *
 * Everything on this page until now is behavioural — what people *did*. This
 * section is the other axis, and the copy leans on the one idea that makes it
 * land: you already have a design system, you just never wrote it down, and
 * nobody has ever shown it to you in one place.
 *
 * The specimens below are illustrative, but shaped exactly like the real tab:
 * measured values, usage weight, and the outliers marked in amber.
 */

/** A type scale as it usually ends up: mostly deliberate, partly not. */
const SPECIMENS = [
  { px: 32, weight: 600, uses: 41, outlier: false },
  { px: 28, weight: 600, uses: 12, outlier: false },
  { px: 21, weight: 500, uses: 3, outlier: true },
  { px: 17, weight: 400, uses: 6, outlier: true },
  { px: 16, weight: 400, uses: 388, outlier: false },
  { px: 14, weight: 400, uses: 205, outlier: false },
  { px: 13, weight: 500, uses: 96, outlier: false },
];

/** The palette, weighted by how much of the UI each colour actually covers. */
const SWATCHES = [
  { hex: "#0a0a0a", pct: 46, role: "bg" },
  { hex: "#ffffff", pct: 22, role: "text" },
  { hex: "#fefefe", pct: 1, role: "text", outlier: true },
  { hex: "#2e2e2e", pct: 14, role: "border" },
  { hex: "#737373", pct: 9, role: "text" },
  { hex: "#f5a623", pct: 2, role: "text" },
];

const RADII = ["4px", "6px", "8px", "12px", "14px", "999px"];

export default function Design() {
  return (
    <section id="design" className="py-[76px] md:py-28">
      <Wrap>
        <Eyebrow>Live today · the design tab</Eyebrow>
        <Heading>
          You already have a design system.
          <br />
          <span className="text-[#666]">Nobody ever wrote it down.</span>
        </Heading>
        <Sub>
          Forty files of generated components, and somewhere in them a type scale, a palette and a
          spacing rhythm that nobody chose on purpose. Polishd reads it back out of your rendered
          pages and prints the brand guide you never made — after the build, not before.
        </Sub>

        <div className="mt-[34px] grid grid-cols-1 gap-3 lg:grid-cols-[1.25fr_1fr]">
          {/* The specimen sheet — what the site actually ships. */}
          <div className="card r lift overflow-hidden">
            <div className="flex items-center gap-2.5 border-b border-[#2e2e2e] px-4 py-[13px]">
              <span className="label">Typography</span>
              <span className="rounded-full bg-[#1a1a1a] px-2.5 py-[3px] font-mono text-[10px] text-[#888]">
                measured on 7 pages
              </span>
            </div>

            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-4 px-4 py-6">
              {SPECIMENS.map((s) => (
                <div key={s.px} className="flex flex-col items-start">
                  <span
                    className="leading-none"
                    style={{ fontSize: `${s.px}px`, fontWeight: s.weight }}
                  >
                    Aa
                  </span>
                  <span
                    className={`mt-2 font-mono text-[10px] tabular-nums ${
                      s.outlier ? "text-amber-400" : "text-[#666]"
                    }`}
                  >
                    {s.px}/{s.weight}
                    <span className="text-[#444]"> ×{s.uses}</span>
                  </span>
                </div>
              ))}
              <span className="self-center rounded-[5px] bg-[#1a1a1a] px-2 py-1 font-mono text-[10px] text-[#888]">
                +9 more
              </span>
            </div>

            <Finding tone="amber">
              Sixteen sizes across seven pages, nine of them used fewer than five times. Those
              aren&apos;t steps in a scale — they&apos;re accidents with a font-size.
            </Finding>

            <div className="flex items-center gap-2.5 border-y border-[#2e2e2e] px-4 py-[13px]">
              <span className="label">Palette</span>
              <span className="rounded-full bg-[#1a1a1a] px-2.5 py-[3px] font-mono text-[10px] text-[#888]">
                by coverage
              </span>
            </div>

            <div className="grid grid-cols-3 gap-3 px-4 py-5 min-[520px]:grid-cols-6">
              {SWATCHES.map((c) => (
                <div key={c.hex} className="min-w-0">
                  <span
                    className="block h-14 w-full rounded-md border border-[#2e2e2e]"
                    style={{ background: c.hex }}
                  />
                  <span className="mt-1.5 block truncate font-mono text-[10.5px] text-[#ccc]">
                    {c.hex}
                  </span>
                  <span
                    className={`block text-[10px] tabular-nums ${
                      c.outlier ? "text-amber-400" : "text-[#555]"
                    }`}
                  >
                    {c.pct}% · {c.role}
                  </span>
                </div>
              ))}
            </div>

            <Finding tone="amber">
              <code className="font-mono text-amber-300">#fefefe</code> sits one step from{" "}
              <code className="font-mono text-amber-300">#ffffff</code> and covers 1% of the UI. One
              of the two is a typo nobody has noticed.
            </Finding>
          </div>

          {/* The checks a person would have to run by hand, and never does. */}
          <div className="grid grid-cols-1 gap-3">
            <div
              className="card r lift overflow-hidden"
              style={{ "--d": "90ms" } as React.CSSProperties}
            >
              <div className="flex items-center gap-2.5 border-b border-[#2e2e2e] px-4 py-[13px]">
                <span className="label">Contrast</span>
                <span className="ml-auto rounded-full bg-red-950/60 px-2.5 py-[3px] text-[10px] font-semibold uppercase tracking-[0.09em] text-red-400">
                  Fails AA
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-3 px-4 py-[18px]">
                <span
                  className="flex h-11 w-16 flex-none items-center justify-center rounded-md border border-[#2e2e2e] text-[15px] font-medium"
                  style={{ background: "#000000", color: "#737373" }}
                >
                  Aa
                </span>
                <span className="font-mono text-[11px] text-[#999]">#737373 on #000000</span>
                <span className="text-[12px] tabular-nums text-red-400">
                  4.43:1 <span className="text-[#666]">(needs 4.5:1 at 12px)</span>
                </span>
              </div>

              <div className="border-t border-[#2e2e2e] px-4 py-[13px] text-[12.5px] leading-[1.25] text-[#666]">
                Seven hundredths off the line, on your body text.{" "}
                <span className="text-[#e4e4e4]">Nobody eyeballs that.</span>
              </div>
            </div>

            <div
              className="card r lift overflow-hidden"
              style={{ "--d": "150ms" } as React.CSSProperties}
            >
              <div className="flex items-center gap-2.5 border-b border-[#2e2e2e] px-4 py-[13px]">
                <span className="label">Radii &amp; spacing</span>
              </div>

              <div className="flex flex-wrap items-end gap-3.5 px-4 py-[18px]">
                {RADII.map((r) => (
                  <span key={r} className="flex flex-col items-center gap-1.5">
                    <span
                      className="block h-9 w-9 border border-[#555] bg-[#161616]"
                      style={{ borderRadius: r }}
                    />
                    <span className="font-mono text-[10px] text-[#888]">
                      {r === "999px" ? "full" : r}
                    </span>
                  </span>
                ))}
              </div>

              <Finding tone="blue">
                Six roundings and 30% of padding off the 4px grid — 13px, 18px, 22px.
              </Finding>
            </div>

            <div
              className="card r lift overflow-hidden"
              style={{ "--d": "210ms" } as React.CSSProperties}
            >
              <div className="flex items-center gap-2.5 border-b border-[#2e2e2e] px-4 py-[13px]">
                <span className="label">Aesthetic review</span>
                <Pill className="ml-auto">Your model</Pill>
              </div>

              <div className="px-4 py-[18px]">
                <p className="text-[13px] leading-[1.35] text-[#e4e4e4]">
                  The palette is disciplined and the spacing rhythm is real — this reads as one
                  product. What breaks it is the long tail: sizes and greys that appear once, on one
                  page, doing a job an existing token already does.
                </p>
                <p className="mt-3 flex flex-wrap items-center gap-1.5 text-[10px] text-[#888]">
                  <span className="rounded-[5px] bg-[#101c14] px-1.5 py-0.5 text-emerald-500">
                    ✓ one palette, held
                  </span>
                  <span className="rounded-[5px] bg-amber-950/60 px-1.5 py-0.5 text-amber-400">
                    ✕ 2 one-off type sizes
                  </span>
                  <span className="rounded-[5px] bg-amber-950/60 px-1.5 py-0.5 text-amber-400">
                    ✕ near-duplicate greys
                  </span>
                </p>
              </div>
            </div>
          </div>
        </div>

        <p
          className="r mt-6 max-w-[68ch] text-[13px] leading-[1.35] text-[#555]"
          style={{ "--d": "180ms" } as React.CSSProperties}
        >
          Every number above is measured, not guessed — each page tallies its own rendered CSS once
          per visitor session, and the flags are arithmetic. The model only gets the last word, on
          the tally it can&apos;t argue with.
        </p>
      </Wrap>
    </section>
  );
}

/** A deterministic finding: the same amber/blue note the dashboard prints. */
function Finding({ tone, children }: { tone: "amber" | "blue"; children: React.ReactNode }) {
  return (
    <p
      className={`mx-4 mb-4 rounded-md border px-3 py-2.5 text-[12px] leading-[1.35] ${
        tone === "amber"
          ? "border-amber-900/50 bg-amber-950/30 text-amber-400"
          : "border-[#1e3a5f]/60 bg-[#0c1a2b]/60 text-[#7fb2e5]"
      }`}
    >
      {children}
    </p>
  );
}
