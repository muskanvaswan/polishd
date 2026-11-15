import { PolishdMonitor } from "@polishd/next/client";

import FilmButton from "@/components/film-button";
import InstallCommand from "@/components/install-command";
import { Arrow, PrimaryLink, d } from "@/components/kit";
import Wordmark from "@/components/wordmark";
import { DEMO_URL, DOCS_URL, NPM_URL, REPO_URL } from "@/lib/links";

export default function Closing() {
  return (
    <section className="relative z-10 overflow-x-clip pb-14 pt-24 md:pt-36">
      <div className="glow pointer-events-none absolute left-1/2 top-0 h-[800px] w-[1300px] -translate-x-1/2" />
      <div className="relative mx-auto flex max-w-[1080px] flex-col items-center px-5 text-center sm:px-6">
        <div className="r text-[clamp(64px,14vw,180px)] leading-[0.9]" style={d(60)}>
          <Wordmark />
        </div>
        <p className="r sheen mt-6 font-heading text-[clamp(26px,3.4vw,42px)] font-semibold" style={d(140)}>
          Build fast. Refine relentlessly.
        </p>
        <div className="r mt-10 flex flex-wrap items-center justify-center gap-2.5" style={d(220)}>
          <PolishdMonitor name="closing-install" className="flex">
            <InstallCommand />
          </PolishdMonitor>
          <PolishdMonitor name="closing-demo" className="flex">
            <PrimaryLink href={DEMO_URL} external>
              Try the live demo <Arrow up />
            </PrimaryLink>
          </PolishdMonitor>
          <PolishdMonitor name="closing-film" className="flex">
            <FilmButton />
          </PolishdMonitor>
        </div>
      </div>

      <footer className="relative mx-auto mt-32 flex max-w-[1240px] flex-wrap items-center gap-x-6 gap-y-3 border-t border-line px-5 pt-8 font-chart text-[13px] text-fg-4 sm:px-6">
        <span>
          Made by{" "}
          <a href="https://github.com/muskanvaswan" className="text-fg-3 transition-colors hover:text-fg">
            Muskan Vaswan
          </a>
          . MIT licensed.
        </span>
        <nav className="ml-auto flex flex-wrap gap-x-5 gap-y-2">
          <a href={DOCS_URL} className="transition-colors hover:text-fg">Docs</a>
          <a href={REPO_URL} className="transition-colors hover:text-fg">GitHub</a>
          <a href={NPM_URL} className="transition-colors hover:text-fg">npm</a>
          <a href="/AGENTS.md" className="transition-colors hover:text-fg">AGENTS.md</a>
          <a href={DEMO_URL} className="transition-colors hover:text-fg">Demo</a>
        </nav>
      </footer>
    </section>
  );
}
