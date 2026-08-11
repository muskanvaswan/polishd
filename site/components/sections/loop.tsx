"use client";

import { useEffect, useRef, useState } from "react";

import LoopRing from "@/components/loop-ring";
import { STAGES } from "@/lib/loop";
import { Eyebrow, Heading, StatusChip, Sub, Wrap } from "@/components/ui";

export default function Loop() {
  const [active, setActive] = useState(0);
  const cards = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    // A zero-height band across the middle of the viewport: whichever card
    // crosses it is the stage you're reading.
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const i = Number((entry.target as HTMLElement).dataset.stage);
          if (!Number.isNaN(i)) setActive(i);
        }
      },
      { rootMargin: "-50% 0px -50% 0px", threshold: 0 },
    );

    for (const card of cards.current) if (card) io.observe(card);
    return () => io.disconnect();
  }, []);

  return (
    <section id="loop" className="py-[76px] md:py-28">
      <Wrap>
        <Eyebrow>The loop</Eyebrow>
        <Heading>
          Every rough edge,
          <br />
          <span className="text-[#666]">from signal to shipped fix.</span>
        </Heading>
        <Sub>
          Six stages, one cycle. Four of them are live now — the last two are coming soon.
        </Sub>

        <div className="mt-14 grid grid-cols-1 gap-10 lg:grid-cols-[380px_1fr] lg:gap-16">
          <div className="self-start lg:sticky lg:top-[128px]">
            <LoopRing stages={STAGES} active={active} />
          </div>

          <div>
            {STAGES.map((stage, i) => {
              return (
                <div
                  key={stage.id}
                  data-stage={i}
                  ref={(el) => {
                    cards.current[i] = el;
                  }}
                  className="flex flex-col justify-center border-t border-[#2e2e2e] py-9 first:border-t-0 lg:min-h-[52vh] lg:border-t-0 lg:py-0"
                >
                  <div
                    className={`transition-opacity duration-500 ${
                      active === i ? "opacity-100" : "lg:opacity-35"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-[11px] text-[#555]">{stage.id}</span>
                      <span className="text-[13px] font-medium uppercase tracking-[0.14em]">
                        {stage.name}
                      </span>
                      <StatusChip status={stage.status} />
                    </div>

                    <h3 className="mt-4 max-w-[20ch] text-[clamp(22px,3.2vw,32px)] font-semibold leading-[1.12] tracking-[-0.03em]">
                      {stage.lead}
                    </h3>

                    <p className="mt-3.5 max-w-[46ch] text-[14.5px] leading-[1.25] text-[#888]">
                      {stage.body}
                    </p>

                    {stage.tags && (
                      <div className="mt-4 flex flex-wrap gap-1.5">
                        {stage.tags.map((t) => (
                          <span
                            key={t}
                            className="rounded-[5px] bg-[#1a1a1a] px-2 py-1 font-mono text-[10px] text-[#888]"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            <div className="flex items-center gap-3 border-t border-[#2e2e2e] pt-9 lg:border-t-0 lg:pt-0">
              <span className="font-mono text-[11px] text-[#555]">↺</span>
              <p className="text-[14px] text-[#666]">
                Deploy if the answer is yes.{" "}
                <span className="text-[#e4e4e4]">Otherwise, back to stage 01.</span>
              </p>
            </div>
          </div>
        </div>
      </Wrap>
    </section>
  );
}
