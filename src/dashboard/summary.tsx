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
import { FileBugButton } from "./file-bug-button";
import {
  ArrowRightIcon,
  Badge,
  Callout,
  CheckIcon,
  GearIcon,
  RefreshIcon,
  SparkIcon,
  XIcon,
  card,
  cardHeader,
  cardTitleCls,
  iconBtn,
  microBtn,
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
            />
            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-fg-3">
              <span>
                Generated {relTime(summary!.generatedAt)} · {summary!.provider}/{summary!.model}
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

/** The verdict buttons on a loss share their style with the shared microBtn. */
const microLink =
  "text-[11px] font-medium text-fg-3 underline decoration-fg-4 underline-offset-2 transition-colors hover:text-fg disabled:cursor-not-allowed disabled:opacity-40";

/**
 * One loss, and the two things you can do with it: file it as a bug, or ignore
 * it. Ignoring takes one click and no explanation — a reason is offered
 * afterwards, because the fast path is "this isn't a problem, stop showing me
 * it" and typing shouldn't be the toll for that. A reason is worth giving
 * though: it's replayed to the model on every later summary, so "the second CTA
 * is deliberate" stops the same finding coming back in different words.
 *
 * The dismissal is stored server-side immediately; the card stays put, struck
 * through with an undo, and only disappears on the next render. Ignored losses
 * never reappear — not from the cached summary, and not from a regenerate.
 */
function LossCard({
  loss,
  githubConnected,
  onChange,
}: {
  loss: PolishdLossItem;
  githubConnected: boolean;
  onChange?: (change: LossChange) => void;
}) {
  const [ignored, setIgnored] = useState<PolishdIgnoredLoss | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startIgnore] = useTransition();

  const ignore = (reason?: string) =>
    startIgnore(async () => {
      setError(null);
      const res = await ignoreLossAction(
        { issue: loss.issue, evidence: loss.evidence },
        reason,
      );
      if (res.ok) {
        setIgnored(res.ignored);
        setEditing(false);
        onChange?.({ ignored: true });
      } else setError(res.message);
    });

  const undo = () =>
    startIgnore(async () => {
      setError(null);
      const res = await unignoreLossAction(loss.evidence);
      if (res.ok) {
        setIgnored(null);
        setEditing(false);
        setDraft("");
        onChange?.({ ignored: false });
      } else setError(res.message);
    });

  if (ignored) {
    return (
      <li className={`${railCard} text-fg-3`}>
        <div className="flex gap-2">
          <span className="mt-0.5 shrink-0 text-fg-4">
            <XIcon size={13} />
          </span>
          <span className="line-through decoration-fg-4">{loss.issue}</span>
        </div>
        <Badge className="mt-2.5 self-start">
          Ignored{ignored.reason ? ` — ${ignored.reason}` : ""}
        </Badge>
        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-3">
          {editing ? (
            <ReasonForm
              draft={draft}
              setDraft={setDraft}
              pending={pending}
              onSubmit={() => ignore(draft.trim() || undefined)}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <>
              <button
                type="button"
                data-component="loss-ignore-reason"
                onClick={() => {
                  setDraft(ignored.reason ?? "");
                  setEditing(true);
                }}
                disabled={pending}
                title="Tell the model why this isn't a problem — it reads this on every later summary"
                className={microLink}
              >
                {ignored.reason ? "Edit reason" : "Add a reason"}
              </button>
              <button
                type="button"
                data-component="loss-ignore-undo"
                onClick={undo}
                disabled={pending}
                title="Put this back — the model can report it again"
                className={microLink}
              >
                {pending ? "Undoing…" : "Undo"}
              </button>
            </>
          )}
          {error && <span className="text-[11px] text-bad">{error}</span>}
        </div>
      </li>
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
        {loss.location ? (
          <Badge tone="ok" mono className="break-all">
            {loss.location}
          </Badge>
        ) : (
          <Badge title="The citation is real analytics data, but no matching file was found on disk (dynamic content, or source not available here).">
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
        <button
          type="button"
          data-component="loss-ignore"
          onClick={() => ignore()}
          disabled={pending}
          title="Not a problem — drop it from this summary and stop the model reporting it again"
          className={microBtn}
        >
          {pending ? "Ignoring…" : "Ignore"}
        </button>
        {error && <span className="text-[11px] text-bad">{error}</span>}
      </div>
    </li>
  );
}

/** The optional half of ignoring: why it isn't a problem, in the owner's words. */
function ReasonForm({
  draft,
  setDraft,
  pending,
  onSubmit,
  onCancel,
}: {
  draft: string;
  setDraft: (v: string) => void;
  pending: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="flex w-full flex-wrap items-center gap-1.5"
    >
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
        }}
        maxLength={240}
        placeholder="Why isn't this a problem?"
        aria-label="Reason for ignoring this loss"
        className="h-7 w-full rounded-md border border-line-strong bg-canvas px-2 text-[12px] text-fg placeholder:text-fg-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
      />
      <button type="submit" disabled={pending} className={microBtn}>
        {pending ? "Saving…" : "Save"}
      </button>
      <button type="button" onClick={onCancel} disabled={pending} className={microLink}>
        Cancel
      </button>
    </form>
  );
}

function WinsLosses({
  wins,
  losses,
  githubConnected,
  onLossChange,
}: {
  wins: PolishdSummary["wins"];
  losses: PolishdSummary["losses"];
  /** True when a GitHub repo + token are configured — enables "File bug". */
  githubConnected: boolean;
  onLossChange?: (evidence: string, change: LossChange) => void;
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
            />
          ))}
        </CardRail>
      )}
    </>
  );
}
