/**
 * Polishd — the Issues tab (server-rendered).
 *
 * Every bug polishd has filed in the connected repo, in one list. The
 * dashboard files these one at a time — from a loss in the summary, or
 * automatically when the owner turned that on — and then never mentions them
 * again; this tab is where they add up to something: what was reported, what
 * the source verification made of it, and what has happened to it in the
 * tracker since.
 *
 * Each row is the join of two sources. The evidence citation, the analytics
 * claim and the verdict are polishd's own record, kept when the issue was
 * filed. The title, state, labels and comment count are read live from GitHub
 * on every render, so a bug someone closed an hour ago shows as closed here.
 * An issue that can no longer be read — deleted, transferred, token access
 * revoked — keeps its row and says so rather than quietly vanishing.
 *
 * The tab only appears once GitHub is connected (see `chrome.tsx`); reaching
 * it by URL without a connection renders the prompt to go and connect one.
 */
import type { ReactNode } from "react";

import type { PolishdFiledIssue, PolishdGithubIssue } from "../ai/types";
import { TabLink } from "./chrome";
import { border, card, divider, labelCls as label } from "./ui";

/** "3 Aug", or "3 Aug 2024" once it's from another year. */
function shortDate(ms: number): string {
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** Coarse relative age — "2d ago" — for the meta line. */
function timeAgo(ms: number): string {
  const delta = Date.now() - ms;
  if (delta < 60_000) return "just now";
  const mins = Math.floor(delta / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return shortDate(ms);
}

function Stat({
  label: labelText,
  value,
  tone = "text-white",
}: {
  label: string;
  value: number;
  tone?: string;
}) {
  return (
    <div className={`${card} px-4 py-4`}>
      <div className={`text-[28px] font-semibold tabular-nums leading-none ${tone}`}>
        {value.toLocaleString()}
      </div>
      <div className={`mt-2 ${label}`}>{labelText}</div>
    </div>
  );
}

/** Open / closed / unreadable — the one thing you look for per row. */
function StatePill({ detail }: { detail: PolishdGithubIssue | null }) {
  if (!detail) {
    return (
      <span className="shrink-0 rounded-full bg-[#1a1a1a] px-2 py-0.5 text-[10px] font-medium text-[#666]">
        ○ unreadable
      </span>
    );
  }
  if (detail.state === "open") {
    return (
      <span className="shrink-0 rounded-full bg-emerald-950 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
        ● open
      </span>
    );
  }
  const notPlanned = detail.stateReason === "not_planned";
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
        notPlanned ? "bg-[#1a1a1a] text-[#888]" : "bg-[#1e132b] text-[#b083f0]"
      }`}
    >
      {notPlanned ? "✕ not planned" : "✓ closed"}
    </span>
  );
}

function Chip({ children, tone = "text-[#888]" }: { children: ReactNode; tone?: string }) {
  return (
    <span
      className={`max-w-full break-all rounded border border-[#2e2e2e] px-1.5 py-0.5 text-[10px] font-medium ${tone}`}
    >
      {children}
    </span>
  );
}

/** The dot-separated facts under a row's title, in the order they matter. */
function metaLine(issue: PolishdFiledIssue): string {
  const { detail } = issue;
  const opened = detail?.createdAt ?? issue.filedAt;
  const bits: string[] = [];
  if (opened) bits.push(`opened ${timeAgo(opened)}`);
  if (detail?.author) bits.push(`by ${detail.author}`);
  if (detail?.closedAt) bits.push(`closed ${timeAgo(detail.closedAt)}`);
  // An "updated" that is really just the moment it was filed says nothing.
  else if (detail && detail.updatedAt > (opened ?? 0) + 60_000) {
    bits.push(`updated ${timeAgo(detail.updatedAt)}`);
  }
  if (detail && detail.comments > 0) {
    bits.push(`${detail.comments} ${detail.comments === 1 ? "comment" : "comments"}`);
  }
  if (detail && detail.assignees.length > 0) {
    bits.push(`assigned to ${detail.assignees.join(", ")}`);
  }
  return bits.join(" · ");
}

function IssueRow({ issue, repo }: { issue: PolishdFiledIssue; repo?: string }) {
  const { detail } = issue;
  const title = detail?.title ?? issue.claim ?? `Issue #${issue.number}`;

  return (
    <div className={`px-4 py-4 sm:px-5 ${divider} first:border-t-0`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <a
            href={issue.url}
            target="_blank"
            rel="noreferrer noopener"
            className="text-[14px] font-medium leading-snug text-white hover:text-[#8ab4f8]"
          >
            <span className="mr-1.5 font-mono text-[12px] tabular-nums text-[#666]">
              #{issue.number}
            </span>
            {title}
          </a>

          <p className="mt-1.5 text-[11px] leading-snug text-[#666]">{metaLine(issue)}</p>
        </div>
        <StatePill detail={detail} />
      </div>

      {/* What polishd knows and GitHub doesn't: where this came from. */}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <Chip tone="text-[#aaa]">
          <span className="text-[#666]">evidence</span>{" "}
          <span className="font-mono">{issue.evidence}</span>
        </Chip>
        {issue.verdict === "confirmed" && (
          <Chip tone="text-emerald-500">verified against source</Chip>
        )}
        {issue.verdict === "inconclusive" && (
          <Chip tone="text-[#f5a623]">filed unverified</Chip>
        )}
        {(detail?.labels ?? []).map((l) => (
          <Chip key={l}>{l}</Chip>
        ))}
      </div>

      {issue.claim && issue.claim !== title && (
        <p className="mt-2.5 text-[12px] leading-relaxed text-[#888]">
          <span className={label}>Reported as</span>{" "}
          <span className="text-[#aaa]">{issue.claim}</span>
        </p>
      )}

      {detail ? (
        detail.body.trim().length > 0 && (
          <details className="group mt-2.5">
            <summary className="cursor-pointer list-none text-[11px] font-medium text-[#888] transition-colors hover:text-white [&::-webkit-details-marker]:hidden">
              <span className="group-open:hidden">Show issue body ↓</span>
              <span className="hidden group-open:inline">Hide issue body ↑</span>
            </summary>
            <div className="mt-2 max-h-96 overflow-y-auto rounded-md border border-[#2e2e2e] bg-[#111] px-3 py-2.5">
              <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-[#aaa]">
                {detail.body}
              </pre>
            </div>
          </details>
        )
      ) : (
        <p className="mt-2.5 text-[12px] leading-relaxed text-[#777]">
          Polishd filed this issue{issue.filedAt ? ` on ${shortDate(issue.filedAt)}` : ""}, but
          GitHub won&apos;t return it now — it was deleted or transferred, or the access token
          no longer covers{repo ? ` ${repo}` : " the repository"}.
        </p>
      )}
    </div>
  );
}

export default function IssuesView({
  issues,
  repo,
  connected,
}: {
  issues: PolishdFiledIssue[];
  /** The connected repository, "owner/repo". */
  repo?: string;
  /** False when the tab was reached by URL without a GitHub connection. */
  connected: boolean;
}) {
  const open = issues.filter((i) => i.detail?.state === "open").length;
  const closed = issues.filter((i) => i.detail?.state === "closed").length;
  const verified = issues.filter((i) => i.verdict === "confirmed").length;

  return (
    <main className="text-white">
      <div className={`mb-8 flex items-start justify-between gap-3 border-b ${border} pb-6`}>
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-white">Issues</h1>
          <p className="mt-1 text-[13px] text-[#666]">
            Bugs polishd filed from your analytics — each one traced back to the behavior that
            found it, and shown as your tracker has it now.
          </p>
        </div>
        {repo && (
          <a
            href={`https://github.com/${repo}/issues`}
            target="_blank"
            rel="noreferrer noopener"
            className="shrink-0 whitespace-nowrap rounded-full bg-[#141414] px-3 py-1 font-mono text-[11px] text-[#888] transition-colors hover:text-white"
          >
            {repo} ↗
          </a>
        )}
      </div>

      {!connected ? (
        <div className={`${card} px-5 py-8 text-center`}>
          <p className="text-[13px] text-[#888]">No GitHub repository is connected.</p>
          <p className="mx-auto mt-1.5 max-w-md text-[12px] leading-relaxed text-[#666]">
            Connect one in the settings and polishd can verify the problems it finds against
            your source and file them as issues — which is what this tab lists.
          </p>
          <TabLink
            tab="settings"
            className="mt-4 inline-block rounded-md border border-[#2e2e2e] px-3 py-1.5 text-[12px] text-[#aaa] transition-colors hover:border-[#555] hover:text-white"
          >
            Open settings
          </TabLink>
        </div>
      ) : (
        <>
          <section className="mb-8">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Filed by polishd" value={issues.length} />
              <Stat label="Open" value={open} tone="text-emerald-400" />
              <Stat label="Closed" value={closed} />
              <Stat label="Verified against source" value={verified} />
            </div>
          </section>

          <section className="mb-8">
            <div className={`mb-3 ${label}`}>Filed issues</div>
            <div className={card}>
              {issues.length === 0 ? (
                <p className="px-5 py-8 text-center text-[13px] text-[#555]">
                  Nothing filed yet. Problems the summary finds on the Analytics tab carry a
                  &ldquo;File bug&rdquo; button — anything filed from there, or automatically,
                  lands here.
                </p>
              ) : (
                issues.map((issue) => (
                  <IssueRow key={issue.evidence} issue={issue} repo={repo} />
                ))
              )}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
