import { Eyebrow, Heading, Sub, Wrap } from "@/components/ui";

const BEATS = [
  {
    k: "The build",
    v: "A weekend",
    d: "Generated, assembled, deployed. The easy part is finished.",
  },
  {
    k: "The rough edges",
    v: "Ship with it",
    d: "The tap target that isn't, the dead end, the error nobody sees.",
  },
  {
    k: "The feedback",
    v: "Silence",
    d: "Users don't report friction. They just quietly stop coming back.",
  },
];

export default function Premise() {
  return (
    <section className="py-[76px] md:py-28">
      <Wrap>
        <Eyebrow>The premise</Eyebrow>
        <Heading>
          Build fast,
          <br />
          <span className="text-[#666]">refine relentlessly.</span>
        </Heading>
        <Sub>
          Vibe coding gets you to a working build in a weekend, and hands the rough edges to your
          users to discover. Shipping got cheap; finishing didn&apos;t.
        </Sub>

        <div className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-[#2e2e2e] bg-[#2e2e2e] sm:grid-cols-3">
          {BEATS.map((b, i) => (
            <div
              key={b.k}
              className="r bg-[#0a0a0a] p-5"
              style={{ "--d": `${i * 80}ms` } as React.CSSProperties}
            >
              <div className="label">{b.k}</div>
              <div className="mt-3 text-[22px] font-semibold tracking-[-0.025em]">{b.v}</div>
              <p className="mt-2.5 text-[13.5px] leading-[1.2] text-[#666]">{b.d}</p>
            </div>
          ))}
        </div>
      </Wrap>
    </section>
  );
}
