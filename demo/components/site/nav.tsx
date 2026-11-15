import Link from "next/link";

import { Bird } from "@/components/site/icons";

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="grid size-8 place-items-center rounded-[10px] bg-violet-500 fx-palette:bg-accent fx-radii:rounded-lg">
        <Bird className="size-[18px] text-white fx-palette:text-fg" />
      </span>
      <span className="text-[19px] font-semibold tracking-tight text-white fx-palette:text-fg fx-type:text-xl">queuebird</span>
    </Link>
  );
}

/** Queuebird's top bar. "Changelog" is styled like the links beside it and wired to nothing. */
export default function Nav() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-black/60 backdrop-blur-xl fx-palette:border-line fx-palette:bg-canvas/80">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-10 px-6">
        <Logo />
        <nav className="hidden items-center gap-7 text-[15px] text-zinc-400 md:flex fx-palette:text-fg-2 fx-space:gap-6 fx-type:text-sm">
          <Link href="/docs" className="transition-colors hover:text-white">
            Docs
          </Link>
          <Link href="/pricing" className="transition-colors hover:text-white">
            Pricing
          </Link>
          {/* Looks like the links beside it. Isn't one. */}
          <span data-flaw="links" className="cursor-pointer transition-colors hover:text-white fx-links:hidden">
            Changelog
          </span>
          <Link href="/docs#changelog" className="hidden transition-colors hover:text-white fx-links:inline">
            Changelog
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-4">
          <Link href="/docs" className="hidden text-sm text-neutral-400 transition-colors hover:text-white sm:block fx-palette:text-fg-2">
            Sign in
          </Link>
          <Link
            href="/docs"
            className="rounded-full bg-white px-[18px] py-[7px] text-sm font-medium text-black transition-colors hover:bg-zinc-200 fx-palette:bg-fg fx-palette:text-canvas fx-radii:rounded-lg fx-space:px-4 fx-space:py-2"
          >
            Get started
          </Link>
        </div>
      </div>
    </header>
  );
}
