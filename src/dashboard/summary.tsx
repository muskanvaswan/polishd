"use client";

/**
 * Polishd — AI summary card (client).
 *
 * Sits at the top of the Analytics tab, and is now only ever the story: the
 * summary text, its wins, when it was generated, and a refresh to force a
 * regenerate. Configuring the model — provider, key, site context, codebase
 * profile, GitHub — moved to the Settings tab, so the first thing you see on
 * the dashboard is what Polishd found rather than a form. The losses moved
 * too: they're actionables now, listed with the design review's issues and
 * the GitHub issues filed for either (actionable-list.tsx), and the card ends
 * with how many of its findings are waiting there.
 *
 * The card renders the cached summary handed down from the server on first
 * paint — no model call on load. A model is only hit on explicit actions or
 * the server-side cadence refresh.
 */
import { useState, useTransition } from "react";

import { generateSummaryAction } from "../ai/actions";
import { TabLink } from "./chrome";
import type {
  PolishdAISettingsPublic,
  PolishdProjectProfile,
  PolishdSummary,
} from "../ai/types";
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
  /**
   * Whether the losses pointer links to the Actionables tab. The Overview
   * passes false: its own Actionables section sits right below the card.
   */
  actionablesLink?: boolean;
}

export default function SummaryCard({
  initialSummary,
  initialSettings,
  initialStale,
  initialProfile,
  initialGaps,
  sourceAvailable,
  onSummaryChange,
  actionablesLink = true,
}: SummaryCardProps) {
  const [summary, setSummary] = useState<PolishdSummary | null>(initialSummary);
  const [stale, setStale] = useState(initialStale);
  const [error, setError] = useState<string | null>(null);
  const [pending, startGenerate] = useTransition();
  const settings = initialSettings;

  const generate = (force: boolean) => {
    setError(null);
    startGenerate(async () => {
      let res: Awaited<ReturnType<typeof generateSummaryAction>>;
      try {
        res = await generateSummaryAction(force);
      } catch {
        // The action threw rather than returning a result — an expired
        // dashboard session, a function timeout. Uncaught inside a transition
        // it takes the whole tab down.
        setError("Couldn't reach the server — reload the page and try again.");
        return;
      }
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
            <Wins wins={summary!.wins} />
            <ActionablesPointer
              count={summary!.losses?.length ?? 0}
              tone="bg-bad"
              from="the analytics"
              link={actionablesLink}
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

// ── Wins, and the handoff to the actionables ─────────────────────────────────

/** What's working, as the model listed it. */
function Wins({ wins }: { wins: PolishdSummary["wins"] }) {
  if (!wins?.length) return null;
  return (
    <div className="mt-5">
      <div className="mb-2.5 flex items-center gap-2 text-[13px] font-semibold text-fg">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-ok" />
        Wins
      </div>
      <ul className="space-y-2">
        {wins.map((w, i) => (
          <li key={i} className="flex gap-2.5 text-[13px] leading-snug text-fg-2">
            <span className="mt-px shrink-0 text-ok">
              <CheckIcon size={13} />
            </span>
            <span>{w}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The handoff from a review card to the actionables: how many of this
 * review's findings are waiting there. The findings themselves — evidence,
 * pictures, file-bug and ignore — live in one list for both reviews, so a
 * card is only ever the story and what's working. Shared with the design
 * review card.
 */
export function ActionablesPointer({
  count,
  tone,
  from,
  link = true,
}: {
  count: number;
  /** Colour of the marker dot — the finding's colour on the list. */
  tone: string;
  /** "the analytics", "the design review". */
  from: string;
  /** Whether to link to the Actionables tab; off when the list is right below. */
  link?: boolean;
}) {
  if (count === 0) return null;
  return (
    <div className="mt-5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-lg border border-line bg-sunken px-3 py-2">
      <span className="flex items-center gap-2 text-[12.5px] text-fg-2">
        <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone}`} />
        <span>
          <span className="font-semibold text-fg">{count}</span> {count === 1 ? "problem" : "problems"}{" "}
          from {from} to act on{link ? "" : " — below"}
        </span>
      </span>
      {link && (
        <TabLink
          tab="actionables"
          className="group inline-flex items-center gap-1 text-[12px] font-medium text-fg-3 transition-colors hover:text-fg"
        >
          Actionables
          <span className="transition-transform group-hover:translate-x-0.5">
            <ArrowRightIcon />
          </span>
        </TabLink>
      )}
    </div>
  );
}
