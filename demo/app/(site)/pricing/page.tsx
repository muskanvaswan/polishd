import type { Metadata } from "next";

import { CallToAction } from "@/components/site/footer";
import Pricing from "@/components/site/pricing";

export const metadata: Metadata = { title: "Pricing" };

const FAQ = [
  ["What counts as a run?", "One attempt of one job. A job that fails twice and then succeeds is three runs."],
  ["Can I change plans later?", "Any time. Upgrades apply immediately; downgrades at the end of the billing period."],
  ["Do I need to run Redis or workers?", "No. Queuebird calls your app's own endpoints, so it runs wherever your app does."],
  ["Is there a free trial of Pro?", "Fourteen days, no card. You drop back to Hobby if you don't upgrade."],
];

export default function PricingPage() {
  return (
    <>
      <div className="mx-auto max-w-3xl px-6 pt-24 text-center max-md:pt-16">
        <h1 className="text-6xl font-bold tracking-tight text-white max-md:text-4xl fx-palette:text-fg fx-type:text-7xl max-md:fx-type:text-5xl">
          Pricing
        </h1>
        <p className="mt-4 text-xl text-zinc-400 fx-palette:text-fg-2 fx-type:text-xl max-md:fx-type:text-base">
          Pay for runs, not for servers. Every plan includes the dashboard.
        </p>
      </div>
      <Pricing heading={false} />

      <section id="faq" className="mx-auto max-w-3xl px-6 pb-24">
        <h2 className="text-3xl font-bold tracking-tight text-white fx-palette:text-fg fx-type:text-xl fx-type:font-semibold">
          Frequently asked questions
        </h2>
        <div className="mt-8 divide-y divide-neutral-800 border-y border-neutral-800 fx-palette:divide-line fx-palette:border-line">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group py-[17px] fx-space:py-4">
              <summary className="cursor-pointer list-none font-medium text-zinc-200 fx-palette:text-fg">{q}</summary>
              <p className="mt-[9px] leading-relaxed text-zinc-500 fx-contrast:text-fg-2 fx-space:mt-2">{a}</p>
            </details>
          ))}
        </div>
      </section>
      <CallToAction />
    </>
  );
}
