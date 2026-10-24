"use client";

/**
 * Polishd — AI summary card (client).
 *
 * Sits at the top of the Analytics tab, and is now only ever the story: the
 * summary text, its wins and losses, when it was generated, and a refresh to
 * force a regenerate. Configuring the model — provider, key, site context,
 * codebase profile, GitHub — moved to the Settings tab, so the first thing you
 * see on the dashboard is what Polishd found rather than a form.
 *
 * The card renders the cached summary handed down from the server on first
 * paint — no model call on load. A model is only hit on explicit actions or
 * the server-side cadence refresh.
 */
import { useState, useTransition } from "react";

import {
  createIssueFromLossAction,
  generateSummaryAction,
  ignoreLossAction,
  unignoreLossAction,
} from "../ai/actions";
import CardRail, { railCard } from "./card-rail";
import { TabLink } from "./chrome";
import type {
  PolishdAISettingsPublic,
  PolishdIgnoredLoss,
  PolishdLossItem,
  PolishdProjectProfile,
  PolishdSummary,
} from "../ai/types";
import { DismissedCard, IgnoreButton, useDismissal } from "./dismissable";
import { FileBugButton } from "./file-bug-button";
import {
  ArrowRightIcon,
  Badge,
  Callout,
  CheckIcon,
  GearIcon,
  RefreshIcon,
  SparkIcon,
  card,
  cardHeader,
  cardTitleCls,
  iconBtn,
  primaryBtn,
  relTime,
} from "./ui";

export interface SummaryCardProps {
  initialSummary: PolishdSummary | null;
  initialSettings: PolishdAISettingsPublic;
  initialStale: boolean;
  initialProfile: PolishdProjectProfile | null;
  /** Component identifiers in the analytics that the profile doesn't cover. */
  initialGaps: string[];
  /** Whether the app's source tree is on disk here. A scan can also read the connected repo. */
  sourceAvailable: boolean;
  /** Told when a regenerate lands — the Overview builds its fix prompt from it. */
  onSummaryChange?: (summary: PolishdSummary) => void;
  /** Told when a loss is ignored, restored or filed, keyed by its evidence. */
  onLossChange?: (evidence: string, change: LossChange) => void;
  /** Dismissals recorded elsewhere (a pasted verdict block), keyed by evidence. */
  dismissed?: ReadonlyMap<string, PolishdIgnoredLoss>;
}

/** What can happen to a loss after it renders. */
export type LossChange = { ignored: boolean } | { filed: { url: string; number: number } };

export default function SummaryCard({
  initialSummary,
  initialSettings,
  initialStale,
  initialProfile,
  initialGaps,
  sourceAvailable,
  onSummaryChange,
  onLossChange,
  dismissed,
}: SummaryCardProps) {
  const [summary, setSummary] = useState<PolishdSummary | null>(initialSummary);
  const [stale, setStale] = useState(initialStale);
  const [error, setError] = useState<string | null>(null);
  const [pending, startGenerate] = useTransition();
  const settings = initialSettings;

  const generate = (force: boolean) => {
    setError(null);
    startGenerate(async () => {
      const res = await generateSummaryAction(force);
      if (res.ok) {
        setSummary(res.summary);
        setStale(false);
        onSummaryChange?.(res.summary);
      } else {
        setError(res.message);
      }
    });
  };

  const hasSummary = summary !== null;
  const cadence = settings.refreshCadence ?? "manual";

  return (
    // data-component names on this card (and the finer ones on its buttons)
    // exist for polishd's own dashboard telemetry: clicks captured by the
    // emitter group under these names on the collecting side, so "how often
    // is the summary refreshed?" is answerable. Inert for host apps.
    <section data-component="ai-summary" className={`mb-10 ${card} overflow-hidden`}>
      {/* Header */}
      <div className={cardHeader}>
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="text-accent">
            <SparkIcon size={15} />
          </span>
          <span className={cardTitleCls}>All you need to know</span>
          {settings.hasApiKey && (
            <span className="hidden min-w-0 sm:flex">
              <Badge mono className="truncate">
                {settings.provider} · {settings.model}
              </Badge>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-component="ai-summary-refresh"
            onClick={() => generate(hasSummary)}
            disabled={pending || !settings.hasApiKey}
            title={settings.hasApiKey ? "Regenerate the summary now" : "Connect a model first"}
            aria-label="Refresh summary"
            className={iconBtn}
          >
            <RefreshIcon spinning={pending} />
          </button>
          <TabLink
            tab="settings"
            title="Model, site context and GitHub settings"
            aria-label="Open settings"
            className={iconBtn}
          >
            <GearIcon />
          </TabLink>
        </div>
      </div>

      {/* Body */}
      <div className="px-4 py-5 sm:px-5">
        {error && (
          <Callout tone="bad" className="mb-4">
            {error}
          </Callout>
        )}

        {hasSummary ? (
          <>
            <p className="max-w-[72ch] text-[15px] leading-[1.7] text-fg">{summary!.text}</p>
            <WinsLosses
              wins={summary!.wins}
              losses={summary!.losses}
              githubConnected={settings.hasGithubToken && !!settings.githubRepo}
              onLossChange={onLossChange}
              dismissed={dismissed}
            />
            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-fg-3">
              <span>
                {/* Server and hydration can straddle a minute ("4m" vs "5m ago"),
                    same as the snapshot strip's timestamp. */}
                Generated <span suppressHydrationWarning>{relTime(summary!.generatedAt)}</span> ·{" "}
                {summary!.provider}/{summary!.model}
                {cadence !== "manual" && ` · refreshes ${cadence}`}
              </span>
              {stale && (
                <Badge tone="warn">Something&apos;s changed since this summary — refresh to update</Badge>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="max-w-2xl text-[13px] leading-relaxed text-fg-2">
              {settings.hasApiKey
                ? "No summary yet — generate the story of how visitors are using this site from the signals below."
                : "No model connected yet. Add a key in Settings and Polishd will read these numbers back to you in plain English."}
            </p>
            {settings.hasApiKey ? (
              <button
                type="button"
                data-component="ai-summary-generate"
                onClick={() => generate(false)}
                disabled={pending}
                className={primaryBtn}
              >
                {pending ? "Thinking…" : (
                  <>
                    <SparkIcon size={13} />
                    Generate summary
                  </>
                )}
              </button>
            ) : (
              <span data-component="ai-connect-model" className="contents">
                <TabLink tab="settings" className={primaryBtn}>
                  Connect a model
                </TabLink>
              </span>
            )}
          </div>
        )}
      </div>

      <ProfileNudge
        profile={initialProfile}
        gaps={initialGaps}
        canScan={sourceAvailable || (settings.hasGithubToken && !!settings.githubRepo)}
        hasApiKey={settings.hasApiKey}
      />
    </section>
  );
}

/**
 * The one piece of setup worth surfacing next to a summary: whether the model
 * has actually read the codebase this summary is describing. The controls live
 * in Settings; this only says why you'd want to go there.
 */
function ProfileNudge({
  profile,
  gaps,
  canScan,
  hasApiKey,
}: {
  profile: PolishdProjectProfile | null;
  gaps: string[];
  /** Whether there's source to scan: on disk here, or a connected repo. */
  canScan: boolean;
  hasApiKey: boolean;
}) {
  let message: string | null = null;
  let action = profile ? "Re-scan in Settings" : "Scan in Settings";
  if (!profile && canScan) {
    message =
      "The model hasn't read your codebase yet — one scan lets every summary name real components instead of selectors.";
  } else if (!profile && hasApiKey) {
    // Nothing on disk to read here — the repo is the way in.
    message =
      "The model hasn't read your codebase — connect your GitHub repo and one scan lets every summary name real components instead of selectors.";
    action = "Connect in Settings";
  } else if (gaps.length > 0) {
    message = `${gaps.length} ${gaps.length === 1 ? "component has" : "components have"} appeared since the last codebase scan.`;
  }
  if (!message) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-sunken px-4 py-2.5 sm:px-5">
      <span className="text-[12px] text-fg-3">{message}</span>
      <TabLink
        tab="settings"
        className="inline-flex items-center gap-1 text-[12px] font-medium text-fg-2 transition-colors hover:text-fg"
      >
        {action}
        <ArrowRightIcon />
      </TabLink>
    </div>
  );
}

// ── Wins & losses ────────────────────────────────────────────────────────────

/**
 * One loss, and the two things you can do with it: file it as a bug, or ignore
 * it (see dismissable.tsx). Ignored losses never reappear — not from the
 * cached summary, and not from a regenerate.
 */
function LossCard({
  loss,
  githubConnected,
  onChange,
  adopted,
}: {
  loss: PolishdLossItem;
  githubConnected: boolean;
  onChange?: (change: LossChange) => void;
  adopted?: PolishdIgnoredLoss;
}) {
  const dismissal = useDismissal({
    dismiss: (reason) => ignoreLossAction({ issue: loss.issue, evidence: loss.evidence }, reason),
    restore: () => unignoreLossAction(loss.evidence),
    onChange: (ignored) => onChange?.({ ignored }),
    adopted,
  });

  if (dismissal.ignored) {
    return (
      <DismissedCard
        issue={loss.issue}
        state={dismissal}
        componentPrefix="loss"
        readBy="summary"
        noun="loss"
      />
    );
  }

  return (
    <li className={`${railCard} text-fg-2`}>
      <div className="flex gap-2">
        <span className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-bad" aria-hidden />
        <span className="text-fg">{loss.issue}</span>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <Badge mono className="break-all">
          {loss.evidence}
        </Badge>
        {loss.signal && loss.signal.count > 0 && (
          <Badge
            title={`From the captured analytics${loss.signal.pages.length ? `, on ${loss.signal.pages.join(", ")}` : ""}`}
          >
            {loss.signal.count} {loss.signal.kind.replace(/_/g, " ")}
            {loss.signal.count === 1 ? "" : "s"} · {loss.signal.sessions} session
            {loss.signal.sessions === 1 ? "" : "s"}
          </Badge>
        )}
        {loss.location ? (
          <Badge tone="ok" mono className="break-all">
            {loss.location}
          </Badge>
        ) : loss.candidates?.length ? (
          <Badge
            title={`Not verified — the citation could be in any of these, so none was picked:\n${loss.candidates.join("\n")}`}
          >
            {loss.candidates.length} possible file{loss.candidates.length === 1 ? "" : "s"}
          </Badge>
        ) : (
          <Badge title="The citation is real analytics data, but nothing specific in it (a component name, page route, id or visible label) was found in the source — on disk, or in the connected GitHub repo where the source isn't on disk.">
            <span className="text-fg-3">not matched to source</span>
          </Badge>
        )}
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-3">
        {(githubConnected || !!loss.issueUrl) && (
          <FileBugButton
            dataComponent="loss-file-bug"
            onFiled={(filed) => onChange?.({ filed })}
            filed={loss.issueUrl ? { url: loss.issueUrl, number: loss.issueNumber ?? 0 } : null}
            file={() =>
              createIssueFromLossAction({
                issue: loss.issue,
                evidence: loss.evidence,
                location: loss.location,
              })
            }
          />
        )}
        <IgnoreButton
          state={dismissal}
          dataComponent="loss-ignore"
          title="Not a problem — drop it from this summary and stop the model reporting it again"
        />
      </div>
    </li>
  );
}

function WinsLosses({
  wins,
  losses,
  githubConnected,
  onLossChange,
  dismissed,
}: {
  wins: PolishdSummary["wins"];
  losses: PolishdSummary["losses"];
  /** True when a GitHub repo + token are configured — enables "File bug". */
  githubConnected: boolean;
  onLossChange?: (evidence: string, change: LossChange) => void;
  dismissed?: ReadonlyMap<string, PolishdIgnoredLoss>;
}) {
  const hasWins = !!wins?.length;
  const hasLosses = !!losses?.length;
  if (!hasWins && !hasLosses) return null;
  return (
    <>
      {hasWins && (
        <div className="mt-5">
          <div className="mb-2.5 flex items-center gap-2 text-[13px] font-semibold text-fg">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-ok" />
            Wins
          </div>
          <ul className="space-y-2">
            {wins!.map((w, i) => (
              <li key={i} className="flex gap-2.5 text-[13px] leading-snug text-fg-2">
                <span className="mt-px shrink-0 text-ok">
                  <CheckIcon size={13} />
                </span>
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {hasLosses && (
        <CardRail label="Losses" tone="bg-bad" count={losses!.length}>
          {losses!.map((l, i) => (
            <LossCard
              key={l.evidence || i}
              loss={l}
              githubConnected={githubConnected}
              onChange={onLossChange && ((change) => onLossChange(l.evidence, change))}
              adopted={dismissed?.get(l.evidence)}
            />
          ))}
        </CardRail>
      )}
    </>
  );
}
