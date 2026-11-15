import { PolishdMonitor } from "@polishd/next/client";

import { Arrow, GhostLink, PrimaryLink } from "@/components/kit";
import QueuebirdThumb from "@/components/queuebird-thumb";
import { DEMO_URL } from "@/lib/links";

/** The invitation to the live demo: a real site with Polishd installed, and its real dashboard. */
export default function Demo() {
  return (
    <section id="demo" className="relative z-10 py-24 md:py-32">
      <div className="mx-auto max-w-[1240px] px-5 sm:px-6">
        <div className="r card relative overflow-hidden px-6 py-10 sm:px-10 md:px-14 md:py-16">
          <div className="glow pointer-events-none absolute -right-40 -top-40 h-[700px] w-[900px]" />
          <div className="relative grid items-center gap-12 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <h2 className="sheen text-balance font-heading text-[clamp(32px,4.2vw,52px)] font-semibold leading-[1.02]">
                Poke at a real one.
              </h2>
              <p className="prose-sub mt-5 max-w-[46ch]">
                Queuebird is a dev-tool launch page generated in one go, the way an AI tool writes
                them, with Polishd installed. Click around it, hammer the copy icon, try the
                &ldquo;Yearly&rdquo; switch. Then open its dashboard: the real one, the same{" "}
                <code className="font-mono text-[0.9em] text-fg-2">/polishd</code> you&apos;d get in your
                own app, open to look around.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <PolishdMonitor name="demo-cta" className="flex">
                  <PrimaryLink href={DEMO_URL} external>
                    Open the demo site <Arrow up />
                  </PrimaryLink>
                </PolishdMonitor>
                <PolishdMonitor name="demo-dashboard" className="flex">
                  <GhostLink href={`${DEMO_URL}/polishd`} external>
                    Open its dashboard <Arrow up />
                  </GhostLink>
                </PolishdMonitor>
              </div>
              <p className="mt-4 font-mono text-[11.5px] text-fg-4">no sign-up · nothing to install · read-only</p>
            </div>

            {/* Queuebird, with the demo's bar under it. */}
            <div className="relative pb-12 lg:pb-0">
              <div className="relative [perspective:1600px]">
                <div className="origin-left [transform:rotateY(-8deg)_rotateX(4deg)] max-lg:[transform:none]">
                  <QueuebirdThumb />
                </div>
              </div>
              <div
                aria-hidden
                className="font-chart absolute -bottom-1 left-1/2 flex h-11 -translate-x-1/2 items-center gap-2.5 whitespace-nowrap rounded-full border border-white/15 bg-canvas/95 pl-4 pr-1.5 shadow-pop backdrop-blur-md lg:bottom-[-22px]"
              >
                <span className="text-[14px] font-extrabold tracking-[-0.03em] text-fg">polishd</span>
                <span className="h-5 w-px bg-line-strong max-sm:hidden" />
                <span className="flex items-center gap-1.5 rounded-full border border-line bg-raised px-3 py-1.5 text-[11.5px] text-fg max-sm:hidden">
                  <span className="size-1.5 rounded-full bg-bad" />9 bugs
                </span>
                <span className="rounded-full bg-fg px-3 py-1.5 text-[11.5px] font-semibold text-black">Open the dashboard ↗</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
