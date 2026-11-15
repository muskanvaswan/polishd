import Link from "next/link";
import type { ComponentType, SVGProps } from "react";

import { Arrow, Braces, Clock, Flow, Gauge, Pulse, Retry } from "@/components/site/icons";

/**
 * Six feature cards, each icon in its own colour, a hover lift, and a
 * "Learn more →" that's a styled span. The fix makes those links and gives
 * the icons one colour.
 */
type F = {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  title: string;
  body: string;
  tone: string;
  href: string;
};

const FEATURES: F[] = [
  {
    icon: Retry,
    title: "Durable retries",
    body: "Every job is persisted before it runs. Failures retry with exponential backoff, and nothing is lost on deploy.",
    tone: "bg-emerald-500/10 text-emerald-400 ring-emerald-500/20",
    href: "/docs#retries",
  },
  {
    icon: Clock,
    title: "Cron, in code",
    body: "Schedules live next to the function they run, typed and versioned with the rest of your app.",
    tone: "bg-sky-500/10 text-sky-400 ring-sky-500/20",
    href: "/docs#cron",
  },
  {
    icon: Flow,
    title: "Multi-step workflows",
    body: "Chain steps that each retry on their own. Sleep for days between them without holding a worker.",
    tone: "bg-amber-500/10 text-amber-400 ring-amber-500/20",
    href: "/docs#workflows",
  },
  {
    icon: Gauge,
    title: "Concurrency controls",
    body: "Limit by queue, by user or by key. Rate-limit the API you call instead of getting rate-limited by it.",
    tone: "bg-rose-500/10 text-rose-400 ring-rose-500/20",
    href: "/docs#queues",
  },
  {
    icon: Pulse,
    title: "Live observability",
    body: "Every run, every attempt, every log line, searchable. Replay a failed job with one click.",
    tone: "bg-violet-500/10 text-violet-400 ring-violet-500/20",
    href: "/docs#queues",
  },
  {
    icon: Braces,
    title: "Type-safe end to end",
    body: "Payloads are typed from the job's signature, so a renamed field breaks the build, not production.",
    tone: "bg-fuchsia-500/10 text-fuchsia-400 ring-fuchsia-500/20",
    href: "/docs#quickstart",
  },
];

const STATS = [
  ["2.4B", "jobs run every month"],
  ["99.99%", "uptime, last 12 months"],
  ["38ms", "median dispatch time"],
];

export default function Features() {
  return (
    <section id="features" className="mx-auto max-w-7xl px-6 py-24">
      <div className="max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-widest text-violet-400 fx-palette:text-accent-fg">Features</p>
        <h2 className="mt-3 text-5xl font-bold tracking-tight text-white max-md:text-3xl fx-palette:text-fg fx-type:text-4xl max-md:fx-type:text-3xl fx-type:font-semibold">
          Everything you need to run jobs in production
        </h2>
        <p className="mt-4 text-lg text-zinc-400 fx-palette:text-fg-2 fx-type:text-base">
          Batteries included, nothing to host. Queuebird runs on your existing deploy.
        </p>
      </div>

      <div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-3 fx-space:gap-4">
        {FEATURES.map((f) => (
          <div
            key={f.title}
            className="group relative rounded-2xl border border-white/10 bg-white/[0.02] p-[22px] transition-all duration-300 hover:-translate-y-1 hover:border-violet-500/40 fx-palette:border-line fx-palette:bg-surface fx-palette:hover:border-zinc-700 fx-radii:rounded-xl fx-space:p-6"
          >
            <div className={`mb-5 inline-flex size-11 items-center justify-center rounded-xl ring-1 ${f.tone} fx-palette:bg-raised fx-palette:text-accent-fg fx-palette:ring-line fx-radii:rounded-lg`}>
              <f.icon className="size-5" />
            </div>
            <h3 className="text-lg font-semibold text-white fx-palette:text-fg fx-type:text-base">{f.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-neutral-500 fx-contrast:text-fg-2">{f.body}</p>
            {/* Looks like a link. Isn't one. */}
            <span data-flaw="links" className="mt-4 inline-flex cursor-pointer items-center gap-1 text-sm font-medium text-violet-400 transition group-hover:gap-2 fx-links:hidden">
              Learn more <Arrow className="size-3.5" />
            </span>
            <Link
              href={f.href}
              className="mt-4 hidden items-center gap-1 text-sm font-medium text-accent-fg transition hover:gap-2 fx-links:inline-flex"
            >
              Learn more <Arrow className="size-3.5" />
            </Link>
          </div>
        ))}
      </div>

      <div className="mt-20 grid gap-8 border-y border-zinc-800/80 py-12 sm:grid-cols-3 fx-palette:border-line">
        {STATS.map(([v, l]) => (
          <div key={l} className="text-center">
            <div className="text-5xl font-bold tracking-tight text-zinc-100 fx-palette:text-fg fx-type:text-4xl fx-type:font-semibold">
              {v}
            </div>
            <div className="mt-2 text-sm text-zinc-600 fx-contrast:text-fg-3">{l}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
