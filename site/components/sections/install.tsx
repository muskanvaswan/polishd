import type { ReactNode } from "react";

import { Eyebrow, Heading, Sub, Wrap } from "@/components/ui";

export default function Install() {
  return (
    <section id="install" className="py-[76px] md:py-28">
      <Wrap>
        <Eyebrow>Start the loop</Eyebrow>
        <Heading>
          Three commands.
          <br />
          <span className="text-[#666]">Then your own dashboard.</span>
        </Heading>
        <Sub>
          No third-party service, no script tag, no account. Events land in your database —
          SQLite locally, Postgres in production.
        </Sub>

        <div className="mt-[38px] grid grid-cols-1 gap-3 lg:grid-cols-3">
          <Step n="01" title="Install" body="One package. Next.js 15+, App Router." delay={0}>
            <Prompt /> npm i @polishd/next
          </Step>
          <Step
            n="02"
            title="Init"
            body="Wires the proxy, client, route and dashboard for you."
            delay={90}
          >
            <Prompt /> npx polishd init
          </Step>
          <Step n="03" title="Look" body="Run the app and open the dashboard." delay={180}>
            <Prompt /> npm run dev
            {"\n"}
            <span className="text-[#444]"># →</span>{" "}
            <span className="text-emerald-400">/polishd</span>
          </Step>
        </div>
      </Wrap>
    </section>
  );
}

function Prompt() {
  return <span className="text-[#444]">$</span>;
}

function Step({
  n,
  title,
  body,
  delay,
  children,
}: {
  n: string;
  title: string;
  body: string;
  delay: number;
  children: ReactNode;
}) {
  return (
    <div
      className="card r rounded-[11px] p-5"
      style={{ "--d": `${delay}ms` } as React.CSSProperties}
    >
      <div className="font-mono text-[10.5px] text-[#444]">{n}</div>
      <h3 className="mt-3 text-[15px] font-semibold tracking-[-0.01em]">{title}</h3>
      <p className="mt-2 text-[13.5px] leading-[1.2] text-[#666]">{body}</p>
      <pre className="mt-3.5 overflow-x-auto rounded-lg border border-[#1a1a1a] bg-[#050505] px-3 py-[11px] font-mono text-[11.5px] leading-[1.7] text-[#e4e4e4]">
        {children}
      </pre>
    </div>
  );
}
