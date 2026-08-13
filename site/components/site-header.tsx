import { NPM_URL, REPO_URL } from "@/lib/links";
import { Pill } from "@/components/ui";

export default function SiteHeader() {
  return (
    <header
      id="top-bar"
      className="sticky top-0 z-50 border-b border-transparent bg-black/60 backdrop-blur-[14px] transition-colors duration-300 [&.stuck]:border-b-[#2e2e2e] [&.stuck]:bg-black/85"
    >
      <div className="relative z-2 mx-auto flex h-[58px] w-full max-w-[1080px] items-center gap-3.5 px-6">
        <a
          href="#"
          className="group flex items-center gap-2.5 text-[13px] font-semibold uppercase tracking-[0.14em]"
        >
          <span className="relative h-[15px] w-[15px] flex-none rounded-full border-[1.5px] border-white">
            <span className="absolute inset-[3px] scale-0 rounded-full bg-white transition-transform duration-500 ease-[cubic-bezier(.2,.8,.2,1)] group-hover:scale-100" />
          </span>
          Polishd
        </a>

        <Pill tone="amber">Coming soon</Pill>

        <nav className="ml-auto flex items-center gap-1.5">
          <NavLink href="#design" hideOnMobile>
            Design
          </NavLink>
          <NavLink href="#loop" hideOnMobile>
            The loop
          </NavLink>
          <NavLink href="#live" hideOnMobile>
            Live today
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
      className={`rounded-[7px] px-2.5 py-[7px] text-[12.5px] text-[#888] transition-colors duration-200 hover:bg-[#1a1a1a] hover:text-white ${
        hideOnMobile ? "max-sm:hidden" : ""
      }`}
    >
      {children}
    </a>
  );
}
