import InstallCommand from "@/components/install-command";
import { DOCS_URL } from "@/lib/links";
import { Eyebrow, GhostLink, Wrap } from "@/components/ui";

const CYCLE = [
  "track",
  "measure",
  "analyse",
  "surface",
  "experiment",
  "verify",
  "ship",
  "repeat",
];

export default function Hero() {
  return (
    <section className="pt-[72px] pb-12 md:pt-[110px] md:pb-[72px]">
      <Wrap>
        <Eyebrow>The taste loop for Next.js</Eyebrow>

        <h1
          className="r mt-[22px] max-w-[20ch] text-[clamp(42px,8.4vw,92px)] font-semibold leading-[0.96] tracking-[-0.045em]"
          style={{ "--d": "70ms" } as React.CSSProperties}
        >
          <span className="display">
            Build fast,
            <br />
            refine relentlessly.
          </span>
        </h1>

        <p
          className="r mt-[26px] max-w-[58ch] text-[clamp(15px,1.9vw,18px)] leading-[1.25] text-[#888]"
          style={{ "--d": "150ms" } as React.CSSProperties}
        >
          Vibe coding gets you to a working build in a weekend, and hands the rough edges to your
          users to discover. Shipping got cheap; finishing didn&apos;t. Polishd reads back the
          design your site really ships, watches how it&apos;s really used, and closes the loop on
          fixing both. Because the taste is in the details.
        </p>

        <div
          className="r mt-9 flex flex-wrap items-center gap-2.5"
          style={{ "--d": "220ms" } as React.CSSProperties}
        >
          <InstallCommand />
          <GhostLink href={DOCS_URL}>Read the docs</GhostLink>
        </div>
      </Wrap>

      <div
        className="r fade-x mt-16 overflow-hidden border-y border-[#1a1a1a] py-[13px]"
        style={{ "--d": "300ms" } as React.CSSProperties}
        aria-hidden
      >
        <div className="ticker-track flex w-max">
          {[0, 1].map((copy) =>
            CYCLE.map((word) => (
              <span
                key={`${copy}-${word}`}
                className="whitespace-nowrap px-[22px] font-mono text-[11.5px] uppercase tracking-[0.06em] text-[#666]"
              >
                {word} <span className="text-[#444]">→</span>
              </span>
            )),
          )}
        </div>
      </div>
    </section>
  );
}
