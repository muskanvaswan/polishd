/**
 * Polishd — the Issues tab (server-rendered shell).
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
 * This file is the server half: the header, the stat cards, and the
 * not-connected prompt. The rows themselves live in `issue-list.tsx` (client)
 * so a click can open the right-side drawer — the rendered issue body and the
 * suggest-a-fix panel — without a page of its own.
 *
 * The tab only appears once GitHub is connected (see `chrome.tsx`); reaching
 * it by URL without a connection renders the prompt to go and connect one.
 */
import type { PolishdFiledIssue, PolishdFixSuggestion } from "../ai/types";
import { TabLink } from "./chrome";
import IssueList from "./issue-list";
import { border, card, labelCls as label } from "./ui";

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

export default function IssuesView({
  issues,
  repo,
  connected,
  suggestions,
  canSuggest,
}: {
  issues: PolishdFiledIssue[];
  /** The connected repository, "owner/repo". */
  repo?: string;
  /** False when the tab was reached by URL without a GitHub connection. */
  connected: boolean;
  /** Cached fix suggestions, keyed by issue number. */
  suggestions: Record<number, PolishdFixSuggestion>;
  /** True when a model API key is configured (fix suggestions need one). */
  canSuggest: boolean;
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
                <IssueList
                  issues={issues}
                  repo={repo}
                  suggestions={suggestions}
                  canSuggest={canSuggest}
                />
              )}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
