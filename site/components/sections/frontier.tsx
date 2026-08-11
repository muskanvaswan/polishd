import { Eyebrow, Heading, StatusChip, Sub, Wrap } from "@/components/ui";

const NEXT = [
  {
    id: "05",
    name: "Experiment",
    lead: "Fix it behind a flag.",
    body: "Roll the change to a slice of traffic. Both versions stay live, measured by the same signals that found the problem.",
    frame: (
      <>
        <span className="text-[#444]">flag</span> polishd
        <span className="text-violet-400">.experiment</span>(
        <span className="text-emerald-400">&quot;tappable-headings&quot;</span>)
      </>
    ),
  },
  {
    id: "06",
    name: "Verify",
    lead: "Did the signal actually move?",
    body: "Rage clicks down, scroll depth up — or not. Deploy on a yes; run the loop again on a no.",
    frame: (
      <>
        rage <span className="text-[#444]">53 →</span>{" "}
        <span className="text-emerald-400">7</span>
        {"   "}
        <span className="text-[#444]">verdict</span>{" "}
        <span className="text-emerald-400">ship</span>
      </>
    ),
  },
];

export default function Frontier() {
  return (
    <section id="next" className="py-[76px] md:py-28">
      <Wrap>
        <Eyebrow>Next · stages 05–06</Eyebrow>
        <Heading>
          The half that <span className="text-[#666]">closes the loop.</span>
        </Heading>
        <Sub>
          Finding the rough edge is only worth something if the fix is proven. These two stages
          are in build — what&apos;s live now is the first four.
        </Sub>

        <div className="mt-[38px] grid grid-cols-1 gap-3 md:grid-cols-2">
          {NEXT.map((s, i) => (
            <div
              key={s.id}
              className="r rounded-[11px] border border-dashed border-[#2e2e2e] bg-[#070707] p-5"
              style={{ "--d": `${i * 90}ms` } as React.CSSProperties}
            >
              <div className="flex items-center gap-3">
                <span className="font-mono text-[11px] text-[#555]">{s.id}</span>
                <span className="text-[13px] font-medium uppercase tracking-[0.14em] text-[#aaa]">
                  {s.name}
                </span>
                <StatusChip status="coming" className="ml-auto" />
              </div>

              <h3 className="mt-4 text-[19px] font-semibold tracking-[-0.02em]">{s.lead}</h3>
              <p className="mt-2.5 max-w-[42ch] text-[13.5px] leading-[1.2] text-[#666]">
                {s.body}
              </p>

              <pre className="mt-4 overflow-x-auto rounded-lg border border-[#1a1a1a] bg-[#050505] px-3 py-[11px] font-mono text-[11.5px] leading-[1.7] text-[#bbb]">
                {s.frame}
              </pre>
            </div>
          ))}
        </div>

        <p
          className="r mt-6 text-[13px] text-[#555]"
          style={{ "--d": "180ms" } as React.CSSProperties}
        >
          Shapes shown are illustrative — the API isn&apos;t settled yet.
        </p>
      </Wrap>
    </section>
  );
}
