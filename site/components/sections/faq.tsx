import type { ReactNode } from "react";

import { SectionHead, Wrap, d } from "@/components/kit";
import { DOCS_URL, REPO_URL } from "@/lib/links";

const C = ({ children }: { children: ReactNode }) => (
  <code className="rounded bg-raised px-1 py-0.5 font-mono text-[0.88em] text-fg-2 ring-1 ring-inset ring-line">{children}</code>
);

const QA: [string, ReactNode][] = [
  [
    "What exactly is Polishd?",
    <>
      An open-source npm package, <C>@polishd/next</C>, MIT-licensed. It adds browser capture, an
      ingest route and a dashboard page to your Next.js app, and stores what it captures in your own
      database. There&apos;s no Polishd account and no hosted analytics service.
    </>,
  ],
  [
    "Is it a Claude Code skill, or an MCP server?",
    <>
      Neither. It runs inside your app, in production, measuring your real users. Agents come in at
      two points: it ships an <C>AGENTS.md</C> so a coding agent can install it for you, and it hands
      filed issues to your coding agent to fix.
    </>,
  ],
  [
    "What does it cost?",
    <>
      Nothing — it&apos;s free and open source. The AI reviews use your own model key, and they read a
      digest of a few hundred tokens rather than raw events, cached until the data changes.
    </>,
  ],
  [
    "What does it collect about my users?",
    <>
      Clicks and what they led to, scroll depth, web vitals, the pages people move between, and a
      scan of the design each page renders — per anonymous session, keyed by one httpOnly UUID
      cookie. No fingerprinting and no personal data.
    </>,
  ],
  [
    "Which frameworks does it support?",
    <>
      Next.js 15.3 or later, with the App Router, on Node 22.5 or later. There&apos;s no Pages Router
      support, and no other frameworks yet.
    </>,
  ],
  [
    "Where does the data live in production?",
    <>
      In Postgres, through <C>POLISHD_DATABASE_URL</C>. Serverless hosts like Vercel have read-only
      filesystems, so the SQLite file is for development. Polishd&apos;s two tables are prefixed{" "}
      <C>polishd_</C>, so the database your app already uses is fine.
    </>,
  ],
  [
    "Which coding agents can fix things?",
    <>
      Any of them can take the copied fix prompt — Claude Code, Cursor, Copilot. One-click{" "}
      <span className="text-fg-2">Create fix</span> works with the Claude Code GitHub Action and
      GitHub Copilot&apos;s coding agent, and follows the issue through to its pull request.
    </>,
  ],
  [
    "Is it safe to add to a production app?",
    <>
      It&apos;s in beta, so read the <a href={DOCS_URL} className="text-fg-2 underline decoration-line-strong underline-offset-4 hover:text-fg">docs</a> first. If
      it can&apos;t open its store it degrades to a no-op rather than failing your app, and the
      dashboard stays locked in production until you set a token, wire your own auth, or make it
      public on purpose. The source is on{" "}
      <a href={REPO_URL} className="text-fg-2 underline decoration-line-strong underline-offset-4 hover:text-fg">GitHub</a>.
    </>,
  ],
];

export default function Faq() {
  return (
    <section id="faq" className="relative z-10 py-24 md:py-32">
      <Wrap>
        <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr]">
          <SectionHead title={<>The questions developers ask first.</>} />
          <div className="r divide-y divide-line border-y border-line" style={d(80)}>
            {QA.map(([q, a]) => (
              <details key={q} className="group py-1">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-4 font-heading text-[17px] font-semibold text-fg transition-colors hover:text-white [&::-webkit-details-marker]:hidden">
                  {q}
                  <span className="grid size-6 shrink-0 place-items-center rounded-full text-fg-3 ring-1 ring-inset ring-line-strong transition-transform duration-300 ease-[var(--ease-out)] group-open:rotate-45">
                    <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                      <path d="M5 1v8M1 5h8" />
                    </svg>
                  </span>
                </summary>
                <p className="pb-5 pr-10 font-chart text-[15px] leading-[1.65] text-fg-3">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </Wrap>
    </section>
  );
}
