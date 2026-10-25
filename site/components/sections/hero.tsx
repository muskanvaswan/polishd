import InstallCommand from "@/components/install-command";
import ScrubHero from "@/components/scrub-hero";
import { DOCS_URL } from "@/lib/links";
import { Eyebrow, GhostLink, Wrap } from "@/components/ui";
import Wordmark from "@/components/wordmark";

/**
 * The hero: the wordmark set in the highway alphabet — the halftone bottle
 * standing in for the h, dots shimmering — the pitch under it, and the brush
 * scrubbing the wireframe below.
 */
export default function Hero() {
  return (
    <section className="relative z-10 flex flex-col pt-16 pb-12 md:min-h-screen md:max-h-none md:pt-20 md:pb-0">
      <Wrap>
        <div className="flex flex-col items-center text-center">
          <Eyebrow atLoad>The taste loop for Next.js</Eyebrow>

          {/* The bottle stands in for the h — legs notched into its base. */}
          <h1
            className="r-load mt-4 text-[clamp(64px,13vw,160px)] leading-[0.95]"
            style={{ "--d": "70ms" } as React.CSSProperties}
          >
            <Wordmark />
          </h1>

          <p
            className="r-load font-heading mt-3 text-[clamp(19px,2.6vw,26px)] font-semibold tracking-[0.015em] text-fg"
            style={{ "--d": "140ms" } as React.CSSProperties}
          >
            Build fast, refine relentlessly.
          </p>

          <p
            className="r-load mt-6 max-w-[62ch] font-mono text-[12.5px] leading-[1.7] text-fg-3 md:text-[13.5px]"
            style={{ "--d": "200ms" } as React.CSSProperties}
          >
            Vibe coding gets you to a working build in a weekend, and hands the rough edges to your
            users to discover. Shipping got cheap; finishing didn&apos;t. Polishd reads back the
            design your site really ships, watches how it&apos;s really used, and closes the loop
            on fixing both. Because the taste is in the details.
          </p>

          <div
            className="r-load mt-8 flex flex-wrap items-center justify-center gap-2.5"
            style={{ "--d": "260ms" } as React.CSSProperties}
          >
            <InstallCommand />
            <GhostLink href={DOCS_URL}>Read the docs</GhostLink>
          </div>
        </div>

      </Wrap>

      {/* The brush at work, at 80% of the screen's width. The window is far
          taller than the space the copy leaves in the viewport, so the hero
          shows its upper reach and cuts the rest: the container clips at the
          fold and a mask dissolves the last stretch, so the page fades out
          into the next section instead of ending on an edge. */}
      <div
        className="r-load fade-b relative mx-auto mt-14 max-h-[56vh] w-full overflow-hidden md:mt-12 md:max-h-none md:min-h-[390px] md:flex-1 md:basis-0"
        style={{ "--d": "320ms" } as React.CSSProperties}
      >
        <div className="mx-auto w-[88vw] md:w-[80vw]">
          <ScrubHero />
        </div>
      </div>
    </section>
  );
}
