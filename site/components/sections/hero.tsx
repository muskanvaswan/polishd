import { PolishdMonitor } from "@polishd/next/client";

import InstallCommand from "@/components/install-command";
import { Arrow, PrimaryLink, d } from "@/components/kit";
import PolishPass from "@/components/polish-pass";
import Wordmark from "@/components/wordmark";
import { DEMO_URL } from "@/lib/links";

/**
 * The first screen answers the developer's first question — what is this,
 * and what do I install — before it tries to impress. Then the window below
 * shows it working on a real (deliberately rough) site.
 */
export default function Hero() {
  return (
    <section className="relative z-10 overflow-x-clip pb-28 pt-[72px] md:pb-40 md:pt-[96px]">
      {/* The warm light the brush leaves, behind the window. */}
      <div className="glow pointer-events-none absolute left-1/2 top-[520px] h-[900px] w-[1400px] -translate-x-1/2" />

      <div className="relative mx-auto flex max-w-[1080px] flex-col items-center px-5 text-center sm:px-6">
        <a
          href="#runs"
          className="r-load group inline-flex items-center gap-2 rounded-full border max-sm:rounded-2xl max-sm:text-left border-line bg-surface/70 py-1 pl-1 pr-3 font-chart text-[12.5px] text-fg-2 backdrop-blur transition-colors duration-200 hover:border-line-strong hover:text-fg"
          style={d(0)}
        >
          <span className="rounded-full bg-raised px-2 py-0.5 font-mono text-[10.5px] text-fg ring-1 ring-inset ring-line-strong">
            npm
          </span>
          <span>
            An npm package that gives you a <span className="whitespace-nowrap">self-hosted</span> analytics and UI/UX review dashboard
          </span>
          <Arrow />
        </a>

        <h1 className="r-load mt-7 text-[clamp(60px,12vw,148px)] leading-[0.92]" style={d(70)}>
          <Wordmark />
        </h1>

        <p
          className="r-load sheen mt-5 font-heading text-[clamp(26px,3.6vw,44px)] font-semibold leading-[1.08] tracking-[0.005em]"
          style={d(140)}
        >
          Find the rough edges. Ship the fixes.
        </p>

        <p
          className="r-load mt-5 max-w-[60ch] text-pretty font-chart text-[16px] leading-[1.6] text-fg-3 md:text-[17.5px]"
          style={d(210)}
        >
          Polishd watches how real people use your Next.js app, reads back the design you actually
          shipped, and turns each rough edge it finds into an issue{" "}
          <span className="text-fg-2">your coding agent can fix</span>. It installs as a package; the
          dashboard lives at <code className="font-mono text-[0.9em] text-fg-2">/polishd</code> in
          your own app.
        </p>

        <div className="r-load mt-8 flex flex-wrap items-center justify-center gap-2.5" style={d(280)}>
          <PolishdMonitor name="hero-install" className="flex">
            <InstallCommand />
          </PolishdMonitor>
          <PolishdMonitor name="hero-demo" className="flex">
            <PrimaryLink href={DEMO_URL} external>
              Try the live demo <Arrow up />
            </PrimaryLink>
          </PolishdMonitor>
        </div>

        <ul
          className="r-load mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 font-mono text-[11.5px] text-fg-4"
          style={d(340)}
        >
          {["3 files in your app", "your database", "your model key", "MIT"].map((s) => (
            <li key={s} className="flex items-center gap-2">
              <span className="h-1 w-1 rounded-full bg-fg-4" />
              {s}
            </li>
          ))}
        </ul>
      </div>

      {/* Polishd on a real site: scan, findings, the polish. */}
      <div className="r-load relative mx-auto mt-16 w-full max-w-[1120px] px-5 sm:px-6 md:mt-20" style={d(420)}>
        <PolishPass />
        <p className="mt-6 text-center font-mono text-[11.5px] text-fg-4 md:mt-16">
          Queuebird, our demo: a launch page generated in one go. Drag across it to compare before and after.{" "}
          <a href={DEMO_URL} target="_blank" rel="noopener" className="text-fg-3 underline decoration-line-strong underline-offset-4 transition-colors hover:text-fg">
            Open the real one
          </a>
        </p>
      </div>
    </section>
  );
}
