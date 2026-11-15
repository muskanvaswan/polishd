import { PolishdMonitor } from "@polishd/next/client";

import AgentPrompt from "@/components/agent-prompt";
import CopyButton from "@/components/copy-button";
import { SectionHead, Wrap, d } from "@/components/kit";

const STEPS = [
  { cmd: "npm i @polishd/next", note: "The Postgres driver comes along as an optional dependency." },
  { cmd: "npx @polishd/next init", note: "Writes the three files. Never touches your middleware." },
  { cmd: "npm run dev", note: "Then open /polishd. Events land in a local SQLite file." },
  { cmd: "npx @polishd/next doctor", note: "Checks the wiring that would otherwise fail silently." },
];

export default function Install() {
  return (
    <section id="install" className="relative z-10 py-24 md:py-32">
      <Wrap>
        <SectionHead
          lead={<>Two minutes.</>}
          title={<>Four commands.</>}
          sub="Next.js 15.3 or later with the App Router, on Node 22.5 or later. In production on a serverless host, point it at a Postgres database — the one your app already has works."
        />

        <ol className="mt-12 grid gap-3 md:grid-cols-2">
          {STEPS.map((s, i) => (
            <li key={s.cmd} className="r card flex items-start gap-4 p-4 sm:p-5" style={d(60 + i * 60)}>
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-raised font-mono text-[11px] text-fg-2 ring-1 ring-inset ring-line-strong">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                  <code className="truncate font-mono text-[13.5px] text-fg">
                    <span className="text-fg-4">$ </span>
                    {s.cmd}
                  </code>
                  <PolishdMonitor name={`install-copy-${i + 1}`} className="flex">
                    <CopyButton text={s.cmd} label={`"${s.cmd}"`} />
                  </PolishdMonitor>
                </div>
                <p className="mt-1.5 font-chart text-[13.5px] leading-[1.5] text-fg-3">{s.note}</p>
              </div>
            </li>
          ))}
        </ol>

        <AgentPrompt />
      </Wrap>
    </section>
  );
}
