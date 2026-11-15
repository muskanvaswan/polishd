import Link from "next/link";

import { Logo } from "@/components/site/nav";

const COLS: [string, [string, string][]][] = [
  ["Product", [["Docs", "/docs"], ["Pricing", "/pricing"], ["Changelog", "/docs#changelog"]]],
  ["Concepts", [["Queues", "/docs#queues"], ["Retries", "/docs#retries"], ["Cron", "/docs#cron"]]],
  ["Demo", [["polishd.site", "https://polishd.site"]]],
];

export function CallToAction() {
  return (
    <section className="mx-auto max-w-7xl px-6 pb-24">
      <div className="relative overflow-hidden rounded-3xl border border-zinc-800 bg-[#131316] px-8 py-16 text-center fx-palette:border-line fx-palette:bg-surface fx-radii:rounded-xl">
        <h2 className="text-4xl font-bold tracking-tight text-white max-md:text-3xl fx-palette:text-fg fx-type:text-4xl max-md:fx-type:text-3xl fx-type:font-semibold">
          Ship your first job in five minutes.
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-zinc-400 fx-palette:text-fg-2">
          Free up to 10k runs a month. No card, no infrastructure, no YAML.
        </p>
        <Link
          href="/docs"
          className="mt-8 inline-flex items-center rounded-full bg-white px-7 py-3 font-semibold text-black transition hover:bg-zinc-200 fx-palette:bg-fg fx-palette:text-canvas fx-radii:rounded-lg fx-space:px-6"
        >
          Get started for free
        </Link>
      </div>
    </section>
  );
}

export default function Footer() {
  return (
    <footer className="border-t border-white/10 fx-palette:border-line">
      <div className="mx-auto grid max-w-7xl gap-10 px-6 py-14 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
        <div>
          <Logo />
          <p className="mt-4 max-w-xs text-sm text-zinc-600 fx-contrast:text-fg-3">
            A sample site for the Polishd demo. Queuebird isn&apos;t a real product.
          </p>
        </div>
        {COLS.map(([h, links]) => (
          <div key={h}>
            <div className="text-sm font-medium text-white fx-palette:text-fg">{h}</div>
            <ul className="mt-4 space-y-2.5 text-sm text-neutral-500 fx-contrast:text-fg-2">
              {links.map(([l, href]) => (
                <li key={l}>
                  <Link href={href} className="transition-colors hover:text-white">
                    {l}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-white/5 py-6 text-center text-xs text-zinc-700 fx-palette:border-line fx-contrast:text-fg-3">
        © 2026 Queuebird, Inc. All rights reserved.
      </div>
    </footer>
  );
}
