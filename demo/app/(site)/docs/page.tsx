import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import CopyButton from "@/components/site/copy";

export const metadata: Metadata = { title: "Quickstart" };

const NAV: [string, [string, string][]][] = [
  ["Getting started", [["Introduction", "#introduction"], ["Quickstart", "#quickstart"], ["Installation", "#installation"]]],
  ["Concepts", [["Queues", "#queues"], ["Retries", "#retries"], ["Cron", "#cron"], ["Workflows", "#workflows"]]],
  ["Resources", [["Changelog", "#changelog"]]],
];

function Code({ file, copy, children }: { file: string; copy: string; children: ReactNode }) {
  return (
    <div className="mt-5 overflow-hidden rounded-xl border border-zinc-800 bg-[#0d0d10] fx-palette:border-line fx-palette:bg-surface">
      <div className="flex items-center justify-between border-b border-zinc-800 py-1 pl-4 pr-1.5 fx-palette:border-line">
        <span className="font-code text-xs text-zinc-500 fx-contrast:text-fg-3">{file}</span>
        <CopyButton text={copy} />
      </div>
      <pre className="overflow-x-auto p-[18px] font-code text-[13.5px] leading-[1.8] text-zinc-300 fx-palette:text-fg fx-type:text-sm fx-space:p-4">
        <code>{children}</code>
      </pre>
    </div>
  );
}

function H2({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="mt-14 scroll-mt-24 text-2xl font-semibold tracking-tight text-white fx-palette:text-fg fx-type:text-xl">
      {children}
    </h2>
  );
}

function P({ children }: { children: ReactNode }) {
  return <p className="mt-4 leading-7 text-zinc-400 fx-palette:text-fg-2">{children}</p>;
}

function C({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-zinc-800 px-1.5 py-0.5 font-code text-[13px] text-pink-400 fx-palette:bg-raised fx-palette:text-fg fx-type:text-sm">
      {children}
    </code>
  );
}

const k = "text-purple-400 fx-palette:text-accent-fg";
const s = "text-emerald-400";
const cm = "text-zinc-600 fx-contrast:text-fg-3";

export default function Docs() {
  return (
    <div className="mx-auto grid max-w-7xl gap-12 px-6 py-12 lg:grid-cols-[220px_minmax(0,1fr)_180px]">
      <aside className="hidden lg:block">
        <nav className="sticky top-28 space-y-8 text-sm">
          {NAV.map(([h, items]) => (
            <div key={h}>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 fx-contrast:text-fg-3 fx-type:text-xs">{h}</div>
              <ul className="mt-3 space-y-1">
                {items.map(([l, href]) => (
                  <li key={l}>
                    <a
                      href={href}
                      className={`block rounded-md px-[11px] py-1.5 transition-colors fx-radii:rounded-lg fx-space:px-3 ${
                        l === "Quickstart"
                          ? "bg-violet-500/10 font-medium text-violet-300 fx-palette:text-accent-fg"
                          : "text-zinc-400 hover:text-white fx-palette:text-fg-2"
                      }`}
                    >
                      {l}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      <article className="max-w-3xl">
        <p id="introduction" className="text-sm font-medium text-violet-400 fx-palette:text-accent-fg">Getting started</p>
        <h1 id="quickstart" className="mt-2 scroll-mt-24 text-5xl font-bold tracking-tight text-white max-md:text-4xl fx-palette:text-fg fx-type:text-4xl fx-type:font-semibold">
          Quickstart
        </h1>
        <P>
          Queuebird runs your background jobs as plain functions in your existing app. This guide takes you from
          zero to a retried, observable job in about five minutes.
        </P>

        <H2 id="installation">1. Install the SDK</H2>
        <Code file="terminal" copy="npm i queuebird">
          <span className={cm}>$</span> npm i queuebird
        </Code>
        <P>
          Then add your project key to <C>.env.local</C> as <C>QUEUEBIRD_KEY</C>. You&apos;ll find it on the
          dashboard under Settings → API keys.
        </P>

        <H2 id="queues">2. Define a job</H2>
        <P>
          A job is a named async function. Its argument is its payload, and it&apos;s typed end to end.
        </P>
        <Code file="jobs/welcome.ts" copy={'export const sendWelcome = queue("send-welcome", async (user: User) => {})'}>
          <span className={k}>import</span> {"{ queue }"} <span className={k}>from</span> <span className={s}>&quot;queuebird&quot;</span>;{"\n\n"}
          <span className={k}>export const</span> sendWelcome = <span className="text-sky-400">queue</span>(<span className={s}>&quot;send-welcome&quot;</span>, <span className={k}>async</span> (user: User) =&gt; {"{"}
          {"\n"}
          {"  "}
          <span className={k}>await</span> email.<span className="text-sky-400">send</span>({"{"} to: user.email, template: <span className={s}>&quot;welcome&quot;</span> {"}"});{"\n"}
          {"}"});
        </Code>

        <H2 id="retries">3. Enqueue it</H2>
        <P>
          Call <C>enqueue</C> from a route handler, a server action, or another job. It returns as soon as the job is
          persisted. If the function throws, Queuebird retries it with exponential backoff — five attempts by default.
        </P>
        <Code file="app/api/signup/route.ts" copy={'await sendWelcome.enqueue(user, { delay: "10m" });'}>
          <span className={cm}>{"// Runs in ten minutes, retried on failure."}</span>
          {"\n"}
          <span className={k}>await</span> sendWelcome.<span className="text-sky-400">enqueue</span>(user, {"{"} delay: <span className={s}>&quot;10m&quot;</span> {"}"});
        </Code>

        <div className="mt-8 rounded-lg border-l-4 border-amber-500 bg-amber-500/10 fx-palette:border-amber-400 px-[18px] py-[15px] text-sm text-amber-200/90 fx-radii:rounded-xl fx-space:px-4 fx-space:py-4">
          <strong className="font-semibold">Note:</strong> jobs must be idempotent. A retried job can run more than
          once if it fails after doing part of its work.
        </div>

        <H2 id="cron">Cron</H2>
        <P>
          Swap <C>queue</C> for <C>cron</C> and pass a schedule. Schedules are deployed with your code, so a preview
          deploy never fires production cron.
        </P>

        <H2 id="workflows">Workflows</H2>
        <P>
          A workflow is a job made of steps. Each step retries on its own, and <C>step.sleep</C> can wait for days
          without holding a worker.
        </P>

        <H2 id="changelog">Changelog</H2>
        <ul className="mt-4 space-y-3 text-zinc-400 fx-palette:text-fg-2">
          <li>
            <span className="font-code text-sm text-zinc-500 fx-contrast:text-fg-3">2.0.0</span> — Multi-step workflows.
          </li>
          <li>
            <span className="font-code text-sm text-zinc-500 fx-contrast:text-fg-3">1.8.0</span> — Per-key concurrency limits.
          </li>
          <li>
            <span className="font-code text-sm text-zinc-500 fx-contrast:text-fg-3">1.7.0</span> — Replay failed runs from the dashboard.
          </li>
        </ul>

        <div className="mt-16 flex items-center justify-between border-t border-zinc-800 pt-6 text-sm fx-palette:border-line">
          <span className="text-zinc-600 fx-contrast:text-fg-3">Last updated 3 days ago</span>
          <Link href="/pricing" className="font-medium text-violet-400 hover:text-violet-300 fx-palette:text-accent-fg">
            Next: Pricing →
          </Link>
        </div>
      </article>

      <aside className="hidden lg:block">
        <div className="sticky top-28 text-sm">
          <div className="text-[13px] font-medium text-white fx-palette:text-fg fx-type:text-sm">On this page</div>
          <ul className="mt-3 space-y-2 text-zinc-500 fx-contrast:text-fg-2">
            {[
              ["Install the SDK", "#installation"],
              ["Define a job", "#queues"],
              ["Enqueue it", "#retries"],
              ["Cron", "#cron"],
              ["Workflows", "#workflows"],
            ].map(([l, href]) => (
              <li key={l}>
                <a href={href} className="transition-colors hover:text-white">
                  {l}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
