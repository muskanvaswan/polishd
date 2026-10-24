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
import {
  ArrowUpRightIcon,
  EmptyState,
  PageHeader,
  Section,
  card,
  ghostBtn,
  labelCls as label,
  toneDot,
  type Tone,
} from "./ui";

function Stat({
  label: labelText,
  value,
  tone,
}: {
  label: string;
  value: number;
  /** Status colour of the caption's dot; neutral when omitted. */
  tone?: Tone;
}) {
  return (
    <div className={`${card} px-4 py-4`}>
      <div className={`flex items-center gap-1.5 ${label}`}>
        <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone ? toneDot[tone] : "bg-fg-4"}`} />
        {labelText}
      </div>
      <div className="mt-2 text-[26px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-fg">
        {value.toLocaleString()}
      </div>
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
    <main className="text-fg">
      <PageHeader
        title="Issues"
        description={
          <>
            Bugs polishd filed from your analytics — each one traced back to the behavior that
            found it, and shown as your tracker has it now.
          </>
        }
        actions={
          repo && (
            <a
              href={`https://github.com/${repo}/issues`}
              target="_blank"
              rel="noreferrer noopener"
              className={`${ghostBtn} font-mono text-[12px]`}
            >
              {repo}
              <ArrowUpRightIcon />
            </a>
          )
        }
      />

      {!connected ? (
        <div className={`${card} px-5 py-10 text-center`}>
          <p className="text-[14px] font-medium text-fg">No GitHub repository is connected.</p>
          <p className="mx-auto mt-1.5 max-w-md text-[13px] leading-relaxed text-fg-3">
            Connect one in the settings and polishd can verify the problems it finds against
            your source and file them as issues — which is what this tab lists.
          </p>
          <TabLink tab="settings" className={`${ghostBtn} mt-5`}>
            Open settings
          </TabLink>
        </div>
      ) : (
        <>
          <section className="mb-10">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Filed by polishd" value={issues.length} />
              <Stat label="Open" value={open} tone="ok" />
              <Stat label="Closed" value={closed} tone="violet" />
              <Stat label="Verified against source" value={verified} />
            </div>
          </section>

          <Section title="Filed issues">
            <div className={`${card} overflow-hidden`}>
              {issues.length === 0 ? (
                <EmptyState>
                  Nothing filed yet. Problems the summary finds on the Analytics tab carry a
                  &ldquo;File bug&rdquo; button — anything filed from there, or automatically,
                  lands here.
                </EmptyState>
              ) : (
                <IssueList
                  issues={issues}
                  repo={repo}
                  suggestions={suggestions}
                  canSuggest={canSuggest}
                />
              )}
            </div>
          </Section>
        </>
      )}
    </main>
  );
}
