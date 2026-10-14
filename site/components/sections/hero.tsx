import DotBottle from "@/components/dot-bottle";
import InstallCommand from "@/components/install-command";
import ScrubHero from "@/components/scrub-hero";
import { DOCS_URL } from "@/lib/links";
import { Eyebrow, GhostLink, Wrap } from "@/components/ui";

/**
 * The hero: the wordmark set in the highway alphabet — the halftone bottle
 * standing in for the h, dots shimmering — the pitch under it, and the brush
 * scrubbing the wireframe below.
 */
export default function Hero() {
  return (
    <section className="relative z-10 flex flex-col pt-16 pb-12 md:h-screen md:pt-20 md:pb-0">
      <Wrap>
        <div className="flex flex-col items-center text-center">
          <Eyebrow>The taste loop for Next.js</Eyebrow>

          {/* The bottle stands in for the h — legs notched into its base. */}
          <h1
            aria-label="polishd"
            className="r font-highway mt-4 text-[clamp(64px,13vw,160px)] font-extrabold lowercase leading-[0.95] tracking-[-0.03em]"
            style={{ "--d": "70ms" } as React.CSSProperties}
          >
            <span aria-hidden>polis</span>
            <DotBottle className="mx-[0.02em] inline-block h-[0.73em]" />
            <span aria-hidden>d</span>
          </h1>

          <p
            className="r mt-3 text-[clamp(19px,2.6vw,26px)] font-semibold tracking-[-0.02em] text-[#e5e5e5]"
            style={{ "--d": "140ms" } as React.CSSProperties}
          >
            Build fast, refine relentlessly.
          </p>

          <p
            className="r mt-6 max-w-[62ch] font-mono text-[12.5px] leading-[1.7] text-[#888] md:text-[13.5px]"
            style={{ "--d": "200ms" } as React.CSSProperties}
          >
            Vibe coding gets you to a working build in a weekend, and hands the rough edges to your
            users to discover. Shipping got cheap; finishing didn&apos;t. Polishd reads back the
            design your site really ships, watches how it&apos;s really used, and closes the loop
            on fixing both. Because the taste is in the details.
          </p>

          <div
            className="r mt-8 flex flex-wrap items-center justify-center gap-2.5"
            style={{ "--d": "260ms" } as React.CSSProperties}
          >
            <InstallCommand />
            <GhostLink href={DOCS_URL}>Read the docs</GhostLink>
          </div>
        </div>

      </Wrap>

      {/* The brush at work. On desktop the hero owns exactly one screen: the
          wireframe takes whatever height the copy leaves over, oversized by
          11% so about a tenth of it runs past the fold into the next section.
          The aspect ratio mirrors the grid (76 cols x 0.6em wide, 34 rows x
          1.3em tall, with the 1.5% font slack), so setting its height is what
          decides its width. */}
      <div
        className="r mx-auto mt-14 w-[92vw] md:relative md:mt-12 md:min-h-0 md:w-full md:flex-1"
        style={{ "--d": "320ms" } as React.CSSProperties}
      >
        <div className="md:absolute md:left-1/2 md:top-0 md:aspect-[1.047/1] md:h-[111%] md:w-auto md:max-w-[92vw] md:-translate-x-1/2">
          <ScrubHero />
        </div>
      </div>
    </section>
  );
}
