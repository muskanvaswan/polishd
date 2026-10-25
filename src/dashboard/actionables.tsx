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
 * note at the top says so.
 */
import type {
  PolishdAISettingsPublic,
  PolishdDesignReview,
  PolishdFiledIssue,
  PolishdFixSuggestion,
  PolishdSummary,
} from "../ai/types";
import ActionableList from "./actionable-list";
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

export default function ActionablesView({
  summary,
  review,
  filed,
  settings,
  suggestions,
}: {
  summary: PolishdSummary | null;
  review: PolishdDesignReview | null;
  /** Every issue polishd filed, joined to GitHub. Empty when not connected. */
  filed: PolishdFiledIssue[];
  settings: PolishdAISettingsPublic;
  /** Cached fix suggestions, keyed by issue number. */
  suggestions: Record<number, PolishdFixSuggestion>;
}) {
  const losses = summary?.losses ?? [];
  const designIssues = review?.issues ?? [];
  const connected = settings.hasGithubToken && !!settings.githubRepo;
  const repo = settings.githubRepo;

  const { open, tracked } = groupActionables(losses, designIssues, filed);
  const openOnGithub = tracked.filter((a) => a.filed?.detail?.state === "open").length;
  const closedOnGithub = tracked.filter((a) => a.filed?.detail?.state === "closed").length;
  const total = open.length + tracked.length;

  return (
    <main className="text-fg">
      <PageHeader
        title="Actionables"
        description={
          <>
            Everything the analytics summary and the design review found worth fixing, in one list.
            File one as a GitHub issue and it stays linked here with the state your tracker gives
            it; ignore one and no later review brings it back.
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

      {total > 0 && (
        <section className="mb-10">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="To act on" value={open.length} tone={open.length > 0 ? "warn" : undefined} />
            {connected ? (
              <>
                <Stat label="Filed on GitHub" value={tracked.length} />
                <Stat label="Open there" value={openOnGithub} tone="ok" />
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
            empty={
              <Empty hasApiKey={settings.hasApiKey} hasSummary={summary !== null} hasReview={review !== null} />
            }
          />
        </div>
      </Section>
    </main>
  );
}
