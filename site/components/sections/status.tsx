import { SectionHead, Status, Wrap, d } from "@/components/kit";
import { STAGES } from "@/lib/loop";

/** What ships today and what doesn't yet, said plainly. */
export default function StatusSection() {
  return (
    <section id="status" className="relative z-10 py-24 md:py-32">
      <Wrap>
        <SectionHead
          lead={<>What&apos;s live,</>}
          title={<>and what isn&apos;t yet.</>}
          sub="Polishd is in beta (0.3). Five stages of the loop ship today. The last two — trying a fix on a slice of traffic, then checking the signal moved — are being built, and their API isn't settled."
        />

        <div className="relative mt-14">
          {/* The track the stages sit on. */}
          <div className="absolute left-[13px] top-0 h-full w-px bg-gradient-to-b from-ok/50 via-ok/40 to-warn/30 lg:left-0 lg:top-[13px] lg:h-px lg:w-full lg:bg-gradient-to-r" />
          <ol className="relative grid gap-6 lg:grid-cols-7 lg:gap-4">
            {STAGES.map((s, i) => {
              const live = s.status === "live";
              return (
                <li key={s.id} className="r relative pl-10 lg:pl-0 lg:pt-10" style={d(i * 60)}>
                  <span
                    className={`absolute left-0 top-0 grid size-[27px] place-items-center rounded-full font-mono text-[10px] ${
                      live ? "bg-ok/15 text-ok ring-1 ring-ok/40" : "border border-dashed border-warn/60 bg-black text-warn"
                    }`}
                  >
                    {s.id}
                  </span>
                  <div className="flex items-center gap-2 lg:flex-col lg:items-start">
                    <h3 className="font-heading text-[18px] font-semibold text-fg">{s.name}</h3>
                    <Status live={live} />
                  </div>
                  <p className="mt-2 font-chart text-[13.5px] leading-[1.5] text-fg-3">{s.lead}</p>
                </li>
              );
            })}
          </ol>
        </div>
      </Wrap>
    </section>
  );
}
