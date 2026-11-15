"use client";

import Link from "next/link";
import { useState } from "react";

import { Check } from "@/components/site/icons";

/**
 * Three tiers and a Monthly / Yearly switch. As generated, the switch is two
 * styled spans: "Yearly" lights up on hover, promises 20% off, and changes
 * nothing. The fix makes it a switch that changes the prices.
 */

type Tier = {
  name: string;
  monthly: number;
  yearly: number;
  blurb: string;
  feats: string[];
  cta: string;
  popular?: boolean;
  card: string;
  btn: string;
  check: string;
};

const TIERS: Tier[] = [
  {
    name: "Hobby",
    monthly: 0,
    yearly: 0,
    blurb: "For side projects and prototypes.",
    feats: ["10k runs / month", "3 queues", "24h log retention", "Community support"],
    cta: "Start free",
    card: "rounded-2xl border border-zinc-800 bg-zinc-900/40 fx-palette:border-line fx-palette:bg-surface",
    btn: "rounded-lg border border-zinc-700 text-white hover:bg-zinc-800 fx-palette:border-line fx-palette:text-fg",
    check: "text-zinc-500 fx-palette:text-accent-fg",
  },
  {
    name: "Pro",
    monthly: 29,
    yearly: 23,
    blurb: "For production apps with real users.",
    feats: ["1M runs / month", "Unlimited queues", "Workflows and cron", "30-day log retention", "Email support"],
    cta: "Get started",
    popular: true,
    card: "rounded-3xl border-2 border-violet-500 bg-[#141118] fx-palette:border-accent fx-palette:bg-surface",
    btn: "rounded-xl bg-violet-500 text-white hover:bg-violet-400 fx-palette:bg-accent fx-palette:text-fg",
    check: "text-violet-400 fx-palette:text-accent-fg",
  },
  {
    name: "Scale",
    monthly: 99,
    yearly: 79,
    blurb: "For teams running critical pipelines.",
    feats: ["20M runs / month", "SSO and audit logs", "99.99% uptime SLA", "1-year log retention", "Dedicated Slack channel"],
    cta: "Contact sales",
    card: "rounded-xl border border-neutral-800 bg-neutral-900/40 fx-palette:border-line fx-palette:bg-surface",
    btn: "rounded-md bg-white text-black hover:bg-neutral-200 fx-palette:bg-fg fx-palette:text-canvas",
    check: "text-indigo-400 fx-palette:text-accent-fg",
  },
];

export default function Pricing({ heading = true }: { heading?: boolean }) {
  const [yearly, setYearly] = useState(false);

  return (
    <section id="pricing" className="mx-auto max-w-7xl px-6 py-24">
      {heading ? (
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-[42px] font-bold tracking-tight text-white max-md:text-3xl fx-palette:text-fg fx-type:text-4xl max-md:fx-type:text-3xl fx-type:font-semibold">
            Simple, transparent pricing
          </h2>
          <p className="mt-4 text-lg text-neutral-400 fx-palette:text-fg-2 fx-type:text-base">Start free. Scale when you&apos;re ready.</p>
        </div>
      ) : null}

      <div className="mt-10 flex justify-center">
        {/* As generated: a switch that doesn't switch. */}
        <div className="inline-flex items-center rounded-full border border-zinc-800 bg-zinc-900 p-1 text-sm fx-billing:hidden fx-palette:border-line fx-palette:bg-surface">
          <span className="rounded-full bg-zinc-800 px-4 py-1.5 font-medium text-white fx-palette:bg-raised fx-palette:text-fg">Monthly</span>
          <span data-flaw="billing" className="flex cursor-pointer items-center gap-2 px-4 py-1.5 text-zinc-400 transition-colors hover:text-white fx-palette:text-fg-2">
            Yearly
            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-400 fx-type:text-xs">-20%</span>
          </span>
        </div>
        {/* Fixed: a switch. */}
        <div role="radiogroup" aria-label="Billing period" className="hidden items-center rounded-full border border-line bg-surface p-1 text-sm fx-billing:inline-flex">
          {[
            [false, "Monthly"],
            [true, "Yearly"],
          ].map(([v, label]) => (
            <button
              key={String(label)}
              type="button"
              role="radio"
              aria-checked={yearly === v}
              onClick={() => setYearly(v as boolean)}
              className={`flex cursor-pointer items-center gap-2 rounded-full px-4 py-1.5 transition-colors ${
                yearly === v ? "bg-raised font-medium text-fg" : "text-fg-2 hover:text-fg"
              }`}
            >
              {label}
              {v ? <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-400">-20%</span> : null}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-12 grid items-start gap-6 lg:grid-cols-3 fx-space:gap-4">
        {TIERS.map((t) => (
          <div key={t.name} data-tier={t.name.toLowerCase()} className={`relative p-8 ${t.card} fx-radii:rounded-xl`}>
            {t.popular ? (
              <span className="absolute -top-3 left-8 rounded-full bg-purple-600 px-[13px] py-1 text-[11px] font-semibold uppercase tracking-wide text-white fx-palette:bg-accent fx-palette:text-fg fx-space:px-3 fx-type:text-xs">
                Most popular
              </span>
            ) : null}
            <h3 className="text-xl font-semibold text-white fx-palette:text-fg">{t.name}</h3>
            <p className="mt-1.5 text-sm text-neutral-500 fx-contrast:text-fg-2">{t.blurb}</p>
            <div className="mt-6 flex items-baseline gap-1">
              <span className="text-5xl font-bold tracking-tight text-white fx-palette:text-fg fx-type:text-4xl fx-type:font-semibold">
                ${yearly ? t.yearly : t.monthly}
              </span>
              <span className="text-zinc-500 fx-contrast:text-fg-3">/mo</span>
            </div>
            <p className="mt-1 h-5 text-xs text-zinc-600 fx-contrast:text-fg-3">{yearly && t.monthly ? "billed yearly" : t.monthly ? "billed monthly" : "free forever"}</p>
            <Link
              href={t.name === "Scale" ? "/pricing#faq" : "/docs"}
              className={`mt-6 flex h-11 items-center justify-center text-sm font-semibold transition ${t.btn} fx-radii:rounded-lg`}
            >
              {t.cta}
            </Link>
            <ul className="mt-8 space-y-3 text-[15px] text-zinc-300 fx-palette:text-fg-2 fx-type:text-sm">
              {t.feats.map((f) => (
                <li key={f} className="flex items-center gap-3">
                  <Check className={`size-4 shrink-0 ${t.check}`} />
                  {f}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
