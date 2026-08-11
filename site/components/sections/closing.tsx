import InstallCommand from "@/components/install-command";
import { NPM_URL, REPO_URL, DOCS_URL } from "@/lib/links";
import { GhostLink, Wrap } from "@/components/ui";

export default function Closing() {
  return (
    <>
      <section className="pt-[88px] pb-[72px] text-center md:pt-[132px] md:pb-[108px]">
        <Wrap>
          <h2 className="r mx-auto max-w-[15ch] text-[clamp(34px,7vw,74px)] font-semibold leading-[1.02] tracking-[-0.04em]">
            <span className="display">Make your website look polishd.</span>
          </h2>

          <div
            className="r mt-7 inline-flex items-center gap-2.5 rounded-full border border-[#2e2e2e] px-4 py-2 text-[12px] text-[#888]"
            style={{ "--d": "90ms" } as React.CSSProperties}
          >
            <span className="blip h-1.5 w-1.5 rounded-full bg-[#f5a623]" />
            Half the loop is live. The rest is coming soon, in all its glory.
          </div>

          <div
            className="r mt-9 flex flex-wrap items-center justify-center gap-2.5"
            style={{ "--d": "160ms" } as React.CSSProperties}
          >
            <InstallCommand />
            <GhostLink href={REPO_URL}>Star on GitHub</GhostLink>
          </div>
        </Wrap>
      </section>

      <footer className="border-t border-[#2e2e2e] pt-7 pb-11">
        <Wrap className="flex flex-wrap items-center gap-3.5 text-[12px] text-[#444]">
          <span className="font-mono">@polishd/next</span>
          <span>·</span>
          <span>MIT</span>
          <span className="flex w-full gap-3.5 min-[560px]:ml-auto min-[560px]:w-auto">
            <FootLink href={NPM_URL}>npm</FootLink>
            <FootLink href={REPO_URL}>GitHub</FootLink>
            <FootLink href={DOCS_URL}>Docs</FootLink>
          </span>
        </Wrap>
      </footer>
    </>
  );
}

function FootLink({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      rel="noopener"
      className="text-[#666] transition-colors duration-200 hover:text-white"
    >
      {children}
    </a>
  );
}
