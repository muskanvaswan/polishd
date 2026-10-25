import { NPM_URL, REPO_URL } from "@/lib/links";
import { Pill } from "@/components/ui";
import Wordmark from "@/components/wordmark";

export default function SiteHeader() {
  return (
    <header
      id="top-bar"
      className="sticky top-0 z-50 border-b border-transparent bg-black/60 backdrop-blur-[14px] transition-colors duration-300 [&.stuck]:border-b-line [&.stuck]:bg-black/85"
    >
      <div className="relative z-2 mx-auto flex h-[58px] w-full max-w-[1080px] items-center gap-3.5 px-6">
        <a href="#" aria-label="Polishd — back to the top" className="flex items-center text-fg">
          <Wordmark className="text-[22px]" />
        </a>

        <Pill tone="amber">Coming soon</Pill>

        <nav className="ml-auto flex items-center gap-1.5">
          <NavLink href="#design" hideOnMobile>
            Design
          </NavLink>
          <NavLink href="#live" hideOnMobile>
            Live today
          </NavLink>
          <NavLink href="#act" hideOnMobile>
            Actionables
          </NavLink>
          <NavLink href="#loop" hideOnMobile>
            The loop
          </NavLink>
          <NavLink href={NPM_URL}>npm</NavLink>
          <NavLink href={REPO_URL}>GitHub</NavLink>
        </nav>
      </div>
    </header>
  );
}

function NavLink({
  href,
  children,
  hideOnMobile = false,
}: {
  href: string;
  children: string;
  hideOnMobile?: boolean;
}) {
  return (
    <a
      href={href}
      rel="noopener"
      className={`rounded-[7px] px-2.5 py-[7px] text-[12.5px] text-fg-3 transition-colors duration-200 hover:bg-raised hover:text-fg ${
        hideOnMobile ? "max-sm:hidden" : ""
      }`}
    >
      {children}
    </a>
  );
}
