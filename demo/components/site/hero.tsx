import Link from "next/link";

import CopyButton from "@/components/site/copy";
import { Arrow } from "@/components/site/icons";

const LOGOS = ["Northwind", "Contoso", "Globex", "Initech", "Vandelay", "Acme"];

/**
 * The hero, as generated: an announcement pill, a headline whose accent is a
 * purple nothing else uses, an indigo button beside a violet one elsewhere,
 * a subtitle a shade too dim to pass AA, buttons that don't agree on a
 * radius, the install command, and a logo row set too dark to read. Every
 * flaw here is one Polishd measures; nothing it can't see is staged.
 */
export default function Hero() {
  return (
    <section className="relative isolate overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(to_right,rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,#000_60%,transparent_100%)]"
      />

      <div className="mx-auto max-w-5xl px-6 pb-[90px] pt-28 text-center max-md:pt-20 fx-space:pb-24">
        <Link
          href="/docs#workflows"
          className="group inline-flex items-center gap-2 rounded-full border border-violet-500/30 bg-violet-500/10 py-1 pl-1 pr-[13px] text-[13px] text-violet-300 transition hover:bg-violet-500/20 fx-palette:border-line fx-palette:bg-surface fx-palette:text-fg-2 fx-palette:hover:bg-raised fx-space:pr-3 fx-type:text-sm"
        >
          <span className="rounded-full bg-violet-500 px-2 py-0.5 text-[11px] font-semibold text-white fx-palette:bg-accent fx-type:text-xs">
            New
          </span>
          Queuebird 2.0 — multi-step workflows are here
          <Arrow className="size-3.5 transition group-hover:translate-x-0.5" />
        </Link>

        <h1 className="mt-8 text-7xl font-bold tracking-tight text-white max-md:text-5xl fx-palette:text-fg">
          Background jobs that
          <br />
          <span className="text-purple-400 fx-palette:text-accent-fg">
            just work.
          </span>
        </h1>

        <p className="mx-auto mt-6 max-w-2xl text-xl leading-relaxed text-zinc-500 max-md:text-lg fx-contrast:text-fg-2 fx-type:text-xl max-md:fx-type:text-base">
          Durable queues, retries, cron and multi-step workflows for TypeScript. No Redis to run, no workers to
          babysit — just functions.
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-4 fx-space:gap-3">
          <Link
            href="/docs"
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-500 px-6 py-3 font-semibold text-white transition hover:opacity-90 fx-palette:bg-accent fx-radii:rounded-lg fx-space:px-5 fx-space:py-2.5"
          >
            Start building
            <Arrow className="size-4" />
          </Link>
          <Link
            href="/docs"
            className="inline-flex items-center rounded-lg border border-zinc-800 bg-zinc-900/60 px-6 py-3 font-medium text-zinc-300 transition hover:bg-zinc-800 fx-palette:border-line fx-palette:bg-surface fx-palette:text-fg fx-space:px-5 fx-space:py-2.5"
          >
            Read the docs
          </Link>
        </div>

        <div className="mx-auto mt-10 flex w-fit items-center gap-4 rounded-[10px] border border-neutral-800 bg-neutral-900 py-[7px] pl-4 pr-[7px] font-code text-sm text-neutral-300 fx-palette:border-line fx-palette:bg-surface fx-palette:text-fg fx-radii:rounded-lg fx-space:py-1.5 fx-space:pr-1.5">
          <span>
            <span className="select-none text-neutral-600 fx-contrast:text-fg-3">$ </span>npm i queuebird
          </span>
          <CopyButton text="npm i queuebird" />
        </div>

        <div className="mt-20 fx-space:mt-20">
          <p className="text-sm text-zinc-500 fx-contrast:text-fg-3">Trusted by engineering teams at</p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-12 gap-y-4 fx-space:gap-x-10">
            {LOGOS.map((l) => (
              <span key={l} className="text-[22px] font-semibold tracking-tight text-zinc-700 fx-contrast:text-fg-3 fx-type:text-xl">
                {l}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
