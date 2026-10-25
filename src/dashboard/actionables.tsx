/**
 * Polishd — the Actionables tab (server-rendered shell).
 *
 * Everything the two reviews found worth fixing, in one list, with what has
 * become of each. The analytics summary's losses and the design review's
 * issues used to sit in a rail under their own card, and the issues filed
 * from them on a tab of their own; this tab is the one place for all three.
 * Each row is an actionable: the finding, its evidence, the picture of where
 * a design value renders, the issue filed for it — linked the moment it's
 * filed, and shown with the state the tracker gives it now — and the two
 * verdicts, file it or ignore it.
 *
 * The rows themselves live in `actionable-list.tsx` (client), so a click can
 * open the right-side drawer — the full finding, the rendered issue body and
 * the suggest-a-fix panel — without a page of its own. This file is the
 * server half: the header, the stat cards, the empty states and the
 * not-connected note.
 *
 * The tab is always there. Without a GitHub connection it still lists the
 * findings and lets them be ignored; filing needs the connection, and the
 * note at the top says so. With a coding agent ready, the note says how a
 * fix starts here — Create fix on a filed issue, File and fix as it's filed,
 * or on every filing — since that depends on the repo's workflow.
 */
import type {
  PolishdAISettingsPublic,
  PolishdDesignReview,
  PolishdFiledIssue,
  PolishdFixRun,
  PolishdFixSuggestion,
  PolishdIssueThread,
  PolishdSummary,
} from "../ai/types";
import { fixPulls } from "../ai/fix-status";
import ActionableList, { type FixContext } from "./actionable-list";
import { groupActionables } from "./actionable-model";
import { TabLink } from "./chrome";
import {
  ArrowUpRightIcon,
  Callout,
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

/** Why the list is empty, in the words that say what to do about it. */
function Empty({
  hasApiKey,
  hasSummary,
  hasReview,
}: {
  hasApiKey: boolean;
  hasSummary: boolean;
  hasReview: boolean;
}) {
  if (!hasApiKey) {
    return (
      <EmptyState>
        No model connected yet. Add a key in{" "}
        <TabLink tab="settings" className="text-fg-2 underline decoration-fg-4 underline-offset-2 hover:text-fg">
          Settings
        </TabLink>{" "}
        and whatever the analytics summary and the design review find worth fixing lands here.
      </EmptyState>
    );
  }
  if (!hasSummary && !hasReview) {
    return (
      <EmptyState>
        Nothing yet. Generate the analytics summary and the design review on the{" "}
        <TabLink tab="overview" className="text-fg-2 underline decoration-fg-4 underline-offset-2 hover:text-fg">
          Overview
        </TabLink>{" "}
        — every problem they find is an actionable here.
      </EmptyState>
    );
  }
  return (
    <EmptyState>
      Nothing to act on — {hasSummary && hasReview ? "neither review" : hasSummary ? "the analytics summary" : "the design review"}{" "}
      found a problem worth fixing{!hasSummary || !hasReview ? ", and the other hasn't run yet" : ""}.
    </EmptyState>
  );
}

/** How fixes start here, in a sentence the top of the tab can carry. */
function FixNote({ fix, repo }: { fix: FixContext; repo?: string }) {
  const agent = fix.agentName ?? "The agent";
  const settingsLink = (
    <TabLink tab="settings" className="text-fg underline decoration-fg-4 underline-offset-2">
      Settings → Fix dispatch
    </TabLink>
  );
  if (fix.paused) {
    return (
      <Callout tone="neutral" className="mb-8">
        Fix dispatch is paused, so nothing is sent to {agent === "The agent" ? "the agent" : agent}. Unpause it under{" "}
        {settingsLink}.
      </Callout>
    );
  }
  if (fix.trigger === "separate") {
    return (
      <Callout tone="neutral" className="mb-8">
        Filing never starts {fix.agentName ?? "the agent"} on its own. <strong className="font-medium text-fg">Create fix</strong>{" "}
        on a filed issue asks it to scope the issue, confirm it&apos;s real and fixable, and open a pull request
        linked to it — the row follows it from there, whoever ends up opening the pull request.
      </Callout>
    );
  }
  if (fix.trigger === "on-filing") {
    return (
      <Callout tone="warn" className="mb-8">
        Your workflow{repo ? ` in ${repo}` : ""} hears new issues but not comments, so a fix can only start as an
        issue is filed: <strong className="font-medium text-fg">File and fix</strong> puts the brief in its body.
        Add <code className="font-mono text-[12px]">issue_comment</code> to the workflow&apos;s{" "}
        <code className="font-mono text-[12px]">on:</code> block and fixes become a step of their own, on any filed
        issue. Details under {settingsLink}.
      </Callout>
    );
  }
  if (fix.trigger === "every-filing") {
    return (
      <Callout tone="warn" className="mb-8">
        Your workflow runs in automation mode on every new issue, so each issue polishd files starts{" "}
        {fix.agentName ?? "the agent"} — filing is fixing here, and there&apos;s no separate Create fix. Details
        under {settingsLink}.
      </Callout>
    );
  }
  return null;
}

export default function ActionablesView({
  summary,
  review,
  filed,
  settings,
  suggestions,
  dispatchReady,
  fix,
  runs,
  threads,
  threadError,
}: {
  summary: PolishdSummary | null;
  review: PolishdDesignReview | null;
  /** Every issue polishd filed, joined to GitHub. Empty when not connected. */
  filed: PolishdFiledIssue[];
  settings: PolishdAISettingsPublic;
  /** Cached fix suggestions, keyed by issue number. */
  suggestions: Record<number, PolishdFixSuggestion>;
  /**
   * True once the Settings tab's Fix dispatch card found a coding agent that
   * could take these. Until then the tab says where to set one up.
   */
  dispatchReady: boolean;
  /** How fixes reach the agent, once one is ready. */
  fix: FixContext;
  /** Fixes polishd asked for, by issue number. */
  runs: Record<number, PolishdFixRun>;
  /** What GitHub says about each filed issue, by number. */
  threads: Record<number, PolishdIssueThread>;
  /** Why the threads couldn't be read, when none could. */
  threadError?: string;
}) {
  const losses = summary?.losses ?? [];
  const designIssues = review?.issues ?? [];
  const connected = settings.hasGithubToken && !!settings.githubRepo;
  const repo = settings.githubRepo;

  const { open, tracked } = groupActionables(losses, designIssues, filed);
  const openOnGithub = tracked.filter((a) => a.filed?.detail?.state === "open").length;
  const closedOnGithub = tracked.filter((a) => a.filed?.detail?.state === "closed").length;
  // Filed issues with a pull request carrying a fix that's open now, whoever opened it.
  const withOpenPull = tracked.filter((a) => {
    const n = a.link?.number ?? 0;
    return n > 0 && fixPulls(threads[n], runs[n]).some((p) => p.state === "open");
  }).length;
  const total = open.length + tracked.length;

  return (
    <main className="text-fg">
      <PageHeader
        title="Actionables"
        description={
          <>
            Everything the analytics summary and the design review found worth fixing, in one list.
            File one as a GitHub issue and it stays linked here with the state your tracker gives
            it — and with the pull requests that fix it, whoever opens them. Ignore one and no later
            review brings it back.
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

      {!connected && total > 0 && (
        <Callout tone="neutral" className="mb-8">
          No GitHub repository is connected, so these can be ignored but not filed. Connect one in{" "}
          <TabLink tab="settings" className="text-fg underline decoration-fg-4 underline-offset-2">
            Settings
          </TabLink>{" "}
          and polishd verifies each actionable against your source before filing it as an issue —
          linked on the row from then on.
        </Callout>
      )}

      {connected && !dispatchReady && total > 0 && (
        <Callout tone="neutral" className="mb-8">
          Filed issues stop here — no coding agent takes them yet. Set one up and test it under{" "}
          <TabLink tab="settings" className="text-fg underline decoration-fg-4 underline-offset-2">
            Settings → Fix dispatch
          </TabLink>
          {" "}and each filed issue gets a Create fix.
        </Callout>
      )}

      {connected && dispatchReady && total > 0 && <FixNote fix={fix} repo={repo} />}

      {total > 0 && (
        <section className="mb-10">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="To act on" value={open.length} tone={open.length > 0 ? "warn" : undefined} />
            {connected ? (
              <>
                <Stat label="Filed on GitHub" value={tracked.length} />
                {withOpenPull > 0 ? (
                  <Stat label="Pull request open" value={withOpenPull} tone="ok" />
                ) : (
                  <Stat label="Open there" value={openOnGithub} tone="ok" />
                )}
                <Stat label="Closed" value={closedOnGithub} tone="violet" />
              </>
            ) : (
              <>
                <Stat label="From analytics" value={losses.length} tone="bad" />
                <Stat label="From the design review" value={designIssues.length} tone="warn" />
                <Stat label="Filed on GitHub" value={tracked.length} />
              </>
            )}
          </div>
        </section>
      )}

      <Section
        title="Actionables"
        description={
          total > 0
            ? "What still needs a decision first, then what's already in the tracker — open before closed. Click one for everything behind it."
            : undefined
        }
      >
        <div className={`${card} overflow-hidden`}>
          <ActionableList
            losses={losses}
            designIssues={designIssues}
            filed={filed}
            repo={repo}
            githubConnected={connected}
            suggestions={suggestions}
            canSuggest={settings.hasApiKey}
            fix={fix}
            runs={runs}
            threads={threads}
            threadError={threadError}
            empty={
              <Empty hasApiKey={settings.hasApiKey} hasSummary={summary !== null} hasReview={review !== null} />
            }
          />
        </div>
      </Section>
    </main>
  );
}
