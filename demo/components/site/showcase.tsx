"use client";

import { useState, type ReactNode } from "react";

import CopyButton from "@/components/site/copy";

/**
 * "Write a function. Queuebird runs it." The code window's tabs were
 * generated as styled spans: the first looks selected, the others light up on
 * hover, and none of them switch anything. The fix makes them tabs.
 */

const k = (s: string) => <span className="text-purple-400 fx-palette:text-accent-fg">{s}</span>;
const str = (s: string) => <span className="text-emerald-400">{s}</span>;
const fn = (s: string) => <span className="text-sky-400">{s}</span>;
const num = (s: string) => <span className="text-amber-300">{s}</span>;
const c = (s: string) => <span className="text-zinc-600 fx-contrast:text-fg-3">{s}</span>;

const TABS: { id: string; label: string; file: string; copy: string; code: ReactNode }[] = [
  {
    id: "ts",
    label: "TypeScript",
    file: "jobs/welcome.ts",
    copy: 'import { queue } from "queuebird";',
    code: (
      <>
        {k("import")} {"{ queue }"} {k("from")} {str('"queuebird"')};{"\n\n"}
        {c("// Retried with backoff, up to 5 times, if it throws.")}
        {"\n"}
        {k("export const")} sendWelcome = {fn("queue")}({str('"send-welcome"')}, {k("async")} (user: User) =&gt; {"{"}
        {"\n"}
        {"  "}
        {k("await")} email.{fn("send")}({"{"} to: user.email, template: {str('"welcome"')} {"}"});{"\n"}
        {"}"});{"\n\n"}
        {c("// Anywhere in your app:")}
        {"\n"}
        {k("await")} sendWelcome.{fn("enqueue")}(user, {"{"} delay: {str('"10m"')} {"}"});
      </>
    ),
  },
  {
    id: "next",
    label: "Next.js",
    file: "app/api/signup/route.ts",
    copy: 'import { sendWelcome } from "@/jobs/welcome";',
    code: (
      <>
        {k("import")} {"{ sendWelcome }"} {k("from")} {str('"@/jobs/welcome"')};{"\n\n"}
        {k("export async function")} {fn("POST")}(req: Request) {"{"}
        {"\n"}
        {"  "}
        {k("const")} user = {k("await")} db.user.{fn("create")}({k("await")} req.{fn("json")}());{"\n"}
        {"  "}
        {c("// Returns in ~38ms. The email goes out in ten minutes.")}
        {"\n"}
        {"  "}
        {k("await")} sendWelcome.{fn("enqueue")}(user, {"{"} delay: {str('"10m"')} {"}"});{"\n"}
        {"  "}
        {k("return")} Response.{fn("json")}(user, {"{"} status: {num("201")} {"}"});{"\n"}
        {"}"}
      </>
    ),
  },
  {
    id: "cron",
    label: "Cron",
    file: "jobs/digest.ts",
    copy: 'import { cron } from "queuebird";',
    code: (
      <>
        {k("import")} {"{ cron }"} {k("from")} {str('"queuebird"')};{"\n\n"}
        {c("// Every weekday at 9am, in the user's timezone.")}
        {"\n"}
        {k("export const")} dailyDigest = {fn("cron")}({str('"0 9 * * 1-5"')}, {k("async")} () =&gt; {"{"}
        {"\n"}
        {"  "}
        {k("const")} users = {k("await")} db.user.{fn("findMany")}({"{"} where: {"{"} digest: {k("true")} {"}"} {"}"});{"\n"}
        {"  "}
        {k("await")} sendDigest.{fn("enqueueMany")}(users, {"{"} concurrency: {num("20")} {"}"});{"\n"}
        {"}"});
      </>
    ),
  },
];

const RUNS = [
  { job: "send-welcome", status: "completed", meta: "182ms", ago: "2s ago" },
  { job: "sync-stripe-invoices", status: "retrying", meta: "attempt 2/5", ago: "14s ago" },
  { job: "generate-report", status: "completed", meta: "4.2s", ago: "1m ago" },
  { job: "resize-avatar", status: "failed", meta: "timeout", ago: "3m ago" },
  { job: "daily-digest", status: "scheduled", meta: "9:00 AM", ago: "in 6h" },
];

const STATUS: Record<string, string> = {
  completed: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
  retrying: "border-amber-500/20 bg-amber-500/10 text-amber-400",
  failed: "border-rose-500/20 bg-rose-500/10 text-rose-400",
  scheduled: "border-sky-500/20 bg-sky-500/10 text-sky-400",
};

export default function Showcase() {
  const [tab, setTab] = useState(0);
  const t = TABS[tab];

  return (
    <section className="mx-auto max-w-7xl px-6 py-24 fx-space:py-24">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-indigo-400 fx-palette:text-accent-fg fx-type:text-xs">
          How it works
        </p>
        <h2 className="mt-3 text-[42px] font-bold tracking-tight text-white max-md:text-3xl fx-palette:text-fg fx-type:text-4xl max-md:fx-type:text-3xl fx-type:font-semibold">
          Write a function. Queuebird runs it.
        </h2>
        <p className="mt-4 text-lg text-neutral-400 fx-palette:text-fg-2 fx-type:text-base">
          Wrap any async function in <code className="rounded bg-zinc-800 px-1.5 py-0.5 font-code text-[15px] text-pink-400 fx-palette:bg-raised fx-palette:text-fg fx-type:text-sm">queue()</code>{" "}
          and call it from anywhere. We handle retries, backoff, concurrency and the dashboard.
        </p>
      </div>

      <div className="mt-14 grid gap-6 lg:grid-cols-[1.35fr_1fr]">
        {/* The code window. */}
        <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0d0d10] fx-palette:border-line fx-palette:bg-surface">
          <div className="flex items-center gap-2 border-b border-white/10 px-4 fx-palette:border-line">
            <div className="flex gap-1.5 py-3 pr-3">
              <span className="size-3 rounded-full bg-red-500/80 fx-palette:bg-line" />
              <span className="size-3 rounded-full bg-yellow-500/80 fx-palette:bg-line" />
              <span className="size-3 rounded-full bg-green-500/80 fx-palette:bg-line" />
            </div>

            {/* As generated: tabs that don't switch. */}
            <div className="flex text-[13px] fx-tabs:hidden fx-type:text-sm">
              {TABS.map((x, i) => (
                <span
                  key={x.id}
                  data-flaw="tabs"
                  className={`cursor-pointer border-b-2 px-3 py-3 transition-colors ${
                    i === 0
                      ? "border-violet-500 text-white fx-palette:border-accent fx-palette:text-fg"
                      : "border-transparent text-zinc-500 hover:text-zinc-300 fx-contrast:text-fg-2"
                  }`}
                >
                  {x.label}
                </span>
              ))}
            </div>
            {/* Fixed: tabs. */}
            <div role="tablist" className="hidden text-sm fx-tabs:flex">
              {TABS.map((x, i) => (
                <button
                  key={x.id}
                  type="button"
                  role="tab"
                  aria-selected={i === tab}
                  onClick={() => setTab(i)}
                  className={`cursor-pointer border-b-2 px-3 py-3 transition-colors ${
                    i === tab ? "border-accent text-fg" : "border-transparent text-fg-2 hover:text-fg"
                  }`}
                >
                  {x.label}
                </button>
              ))}
            </div>
            <span className="ml-auto hidden font-code text-xs text-zinc-600 sm:block fx-contrast:text-fg-3">{t.file}</span>
          </div>
          <div className="relative">
            <pre className="overflow-x-auto p-6 font-code text-[13.5px] leading-[1.8] text-zinc-300 fx-palette:text-fg fx-type:text-sm fx-space:p-6">
              <code>{t.code}</code>
            </pre>
            <div className="absolute right-3 top-3">
              <CopyButton text={t.copy} />
            </div>
          </div>
        </div>

        {/* The runs. */}
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-[22px] fx-palette:border-line fx-palette:bg-surface fx-radii:rounded-xl fx-space:p-6">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-white fx-palette:text-fg">Recent runs</span>
            <span className="flex items-center gap-1.5 text-xs text-emerald-400">
              <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />
              Live
            </span>
          </div>
          <ul className="mt-5 space-y-2.5">
            {RUNS.map((r) => (
              <li
                key={r.job}
                className="flex items-center gap-3 rounded-lg border border-white/5 bg-white/[0.02] px-[13px] py-[11px] fx-palette:border-line fx-palette:bg-raised fx-space:px-3 fx-space:py-2.5"
              >
                <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS[r.status]} fx-type:text-xs`}>{r.status}</span>
                <span className="min-w-0 flex-1 truncate font-code text-[13px] text-zinc-300 fx-palette:text-fg fx-type:text-sm">{r.job}</span>
                <span className="hidden text-xs text-zinc-500 sm:block fx-contrast:text-fg-3">{r.meta}</span>
                <span className="w-14 text-right text-xs text-zinc-600 fx-contrast:text-fg-3">{r.ago}</span>
              </li>
            ))}
          </ul>
          <div className="mt-5 grid grid-cols-3 gap-3 border-t border-neutral-800 pt-5 fx-palette:border-line">
            {[
              ["12,840", "runs today"],
              ["99.7%", "succeeded"],
              ["38ms", "p50 dispatch"],
            ].map(([v, l]) => (
              <div key={l}>
                <div className="text-xl font-semibold text-white fx-palette:text-fg">{v}</div>
                <div className="mt-0.5 text-xs text-neutral-500 fx-contrast:text-fg-3">{l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
