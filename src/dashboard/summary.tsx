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
import { TabLink } from "./chrome";
import type {
  PolishdAISettingsPublic,
  PolishdIgnoredLoss,
  PolishdLossItem,
  PolishdProjectProfile,
  PolishdSummary,
} from "../ai/types";
import { GearIcon, RefreshIcon, border, card, iconBtn, labelCls, primaryBtn, relTime } from "./ui";

export interface SummaryCardProps {
  initialSummary: PolishdSummary | null;
  initialSettings: PolishdAISettingsPublic;
  initialStale: boolean;
  initialProfile: PolishdProjectProfile | null;
  /** Component identifiers in the analytics that the profile doesn't cover. */
  initialGaps: string[];
  /** Whether the app's source tree is on disk here (scan possible). */
  sourceAvailable: boolean;
}

export default function SummaryCard({
  initialSummary,
  initialSettings,
  initialStale,
  initialProfile,
  initialGaps,
  sourceAvailable,
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
      } else {
        setError(res.message);
      }
    });
  };

  const hasSummary = summary !== null;
  const cadence = settings.refreshCadence ?? "manual";

  return (
    <section className={`mb-8 ${card} overflow-hidden`}>
      {/* Header */}
      <div
        className={`flex items-center justify-between gap-3 border-b ${border} px-4 py-3 sm:px-5`}
      >
        <div className="flex items-center gap-2">
          <span className={labelCls}>All you need to know</span>
          {settings.hasApiKey && (
            <span className="hidden rounded-full bg-[#1a1a1a] px-2 py-0.5 text-[10px] font-medium text-[#888] sm:inline">
              {settings.provider} · {settings.model}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
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
      <div className="px-4 py-4 sm:px-5 sm:py-5">
        {error && (
          <div className="mb-3 rounded-md border border-red-900/50 bg-red-950/30 px-3 py-2 text-[12px] text-red-400">
            {error}
          </div>
        )}

        {hasSummary ? (
          <>
            <p className="text-[14px] leading-relaxed text-[#e4e4e4]">{summary!.text}</p>
            <WinsLosses
              wins={summary!.wins}
              losses={summary!.losses}
              githubConnected={settings.hasGithubToken && !!settings.githubRepo}
            />
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#555]">
              <span>
                Generated {relTime(summary!.generatedAt)} · {summary!.provider}/{summary!.model}
                {cadence !== "manual" && ` · refreshes ${cadence}`}
              </span>
              {stale && (
                <span className="rounded-full bg-amber-950/50 px-2 py-0.5 text-amber-400">
                  Something's changed since this summary — refresh to update
                </span>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[13px] leading-relaxed text-[#888]">
              {settings.hasApiKey
                ? "No summary yet — generate the story of how visitors are using this site from the signals below."
                : "No model connected yet. Add a key in Settings and Polishd will read these numbers back to you in plain English."}
            </p>
            {settings.hasApiKey ? (
              <button
                type="button"
                onClick={() => generate(false)}
                disabled={pending}
                className={primaryBtn}
              >
                {pending ? "Thinking…" : "Generate summary"}
              </button>
            ) : (
              <TabLink tab="settings" className={primaryBtn}>
                Connect a model
              </TabLink>
            )}
          </div>
        )}
      </div>

      <ProfileNudge profile={initialProfile} gaps={initialGaps} sourceAvailable={sourceAvailable} />
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
  sourceAvailable,
}: {
  profile: PolishdProjectProfile | null;
  gaps: string[];
  sourceAvailable: boolean;
}) {
  let message: string | null = null;
  if (!profile && sourceAvailable) {
    message =
      "The model hasn't read your codebase yet — one scan lets every summary name real components instead of selectors.";
  } else if (gaps.length > 0) {
    message = `${gaps.length} ${gaps.length === 1 ? "component has" : "components have"} appeared since the last codebase scan.`;
  }
  if (!message) return null;

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-2 border-t ${border} bg-[#080808] px-4 py-2.5 sm:px-5`}
    >
      <span className="text-[11px] text-[#666]">{message}</span>
      <TabLink
        tab="settings"
        className="text-[11px] text-[#888] underline decoration-[#444] underline-offset-2 hover:text-white"
      >
        {profile ? "Re-scan in Settings" : "Scan in Settings"} →
      </TabLink>
    </div>
  );
}

// ── Wins & losses ────────────────────────────────────────────────────────────

/** The two verdicts on a loss sit side by side, and share their button style. */
const microBtn =
  "rounded border border-[#2e2e2e] px-1.5 py-0.5 text-[10px] text-[#888] transition-colors hover:border-[#555] hover:text-white disabled:cursor-not-allowed disabled:opacity-40";
const microLink =
  "text-[10px] text-[#666] underline decoration-[#333] underline-offset-2 transition-colors hover:text-[#ccc] disabled:cursor-not-allowed disabled:opacity-40";

/**
 * One-click "loss → GitHub issue". The server action verifies the report
 * against the repository's source first: confirmed reports become issues with
 * the technical analysis and fix suggestions, disproved ones come back as
 * `not-a-bug` with the reasoning — shown here instead of a link. Losses whose
 * issue already exists (auto-filed, or filed on an earlier summary) render as
 * the link straight away.
 */
function FileBugButton({ loss }: { loss: PolishdLossItem }) {
  const [created, setCreated] = useState<{ url: string; number: number } | null>(
    loss.issueUrl ? { url: loss.issueUrl, number: loss.issueNumber ?? 0 } : null,
  );
  const [failed, setFailed] = useState<{ notABug: boolean; message: string } | null>(null);
  const [pending, startFile] = useTransition();

  if (created) {
    return (
      <a
        href={created.url}
        target="_blank"
        rel="noreferrer noopener"
        className="rounded bg-[#101c14] px-1.5 py-0.5 text-[10px] font-medium text-emerald-500 hover:text-emerald-400"
      >
        Issue #{created.number} ↗
      </a>
    );
  }

  if (failed?.notABug) {
    return (
      <span
        className="rounded bg-amber-950/50 px-1.5 py-0.5 text-[10px] text-amber-400"
        title={failed.message}
      >
        Checked the source — not an actual bug: {failed.message}
      </span>
    );
  }

  const file = () =>
    startFile(async () => {
      setFailed(null);
      const res = await createIssueFromLossAction({
        issue: loss.issue,
        evidence: loss.evidence,
        location: loss.location,
      });
      if (res.ok) setCreated({ url: res.url, number: res.number });
      else setFailed({ notABug: res.error === "not-a-bug", message: res.message });
    });

  return (
    <>
      <button
        type="button"
        onClick={file}
        disabled={pending}
        title="Verify this problem against the source code, then create a GitHub issue with the technical details"
        className={microBtn}
      >
        {pending ? "Verifying…" : "File bug"}
      </button>
      {failed && <span className="text-[10px] text-red-400">{failed.message}</span>}
    </>
  );
}

/**
 * One loss, and the two things you can do with it: file it as a bug, or ignore
 * it. Ignoring takes one click and no explanation — a reason is offered
 * afterwards, because the fast path is "this isn't a problem, stop showing me
 * it" and typing shouldn't be the toll for that. A reason is worth giving
 * though: it's replayed to the model on every later summary, so "the second CTA
 * is deliberate" stops the same finding coming back in different words.
 *
 * The dismissal is stored server-side immediately; the row stays put, struck
 * through with an undo, and only disappears on the next render. Ignored losses
 * never reappear — not from the cached summary, and not from a regenerate.
 */
function LossRow({ loss, githubConnected }: { loss: PolishdLossItem; githubConnected: boolean }) {
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
      } else setError(res.message);
    });

  if (ignored) {
    return (
      <li className="flex gap-2 text-[13px] leading-snug text-[#666]">
        <span className="mt-px shrink-0 text-[#444]">✕</span>
        <span>
          <span className="line-through decoration-[#3a3a3a]">{loss.issue}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <span className="rounded bg-[#1a1a1a] px-1.5 py-0.5 text-[10px] text-[#777]">
              Ignored{ignored.reason ? ` — ${ignored.reason}` : ""}
            </span>
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
                  onClick={undo}
                  disabled={pending}
                  title="Put this back — the model can report it again"
                  className={microLink}
                >
                  {pending ? "Undoing…" : "Undo"}
                </button>
              </>
            )}
            {error && <span className="text-[10px] text-red-400">{error}</span>}
          </span>
        </span>
      </li>
    );
  }

  return (
    <li className="flex gap-2 text-[13px] leading-snug text-[#bbb]">
      <span className="mt-px shrink-0 text-red-400">✕</span>
      <span>
        {loss.issue}
        <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
          <code className="rounded bg-[#1a1a1a] px-1.5 py-0.5 font-mono text-[10px] text-[#888]">
            {loss.evidence}
          </code>
          {loss.location ? (
            <code className="rounded bg-[#101c14] px-1.5 py-0.5 font-mono text-[10px] text-emerald-500">
              {loss.location}
            </code>
          ) : (
            <span
              className="rounded bg-[#1a1a1a] px-1.5 py-0.5 text-[10px] text-[#666]"
              title="The citation is real analytics data, but no matching file was found on disk (dynamic content, or source not available here)."
            >
              not matched to source
            </span>
          )}
          {(githubConnected || !!loss.issueUrl) && <FileBugButton loss={loss} />}
          <button
            type="button"
            onClick={() => ignore()}
            disabled={pending}
            title="Not a problem — drop it from this summary and stop the model reporting it again"
            className={microBtn}
          >
            {pending ? "Ignoring…" : "Ignore"}
          </button>
          {error && <span className="text-[10px] text-red-400">{error}</span>}
        </span>
      </span>
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
      className="flex flex-wrap items-center gap-1.5"
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
        className="w-56 rounded border border-[#2e2e2e] bg-[#0d0d0d] px-1.5 py-0.5 text-[10px] text-[#ddd] placeholder:text-[#555] focus:border-[#555] focus:outline-none"
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
}: {
  wins: PolishdSummary["wins"];
  losses: PolishdSummary["losses"];
  /** True when a GitHub repo + token are configured — enables "File bug". */
  githubConnected: boolean;
}) {
  const hasWins = !!wins?.length;
  const hasLosses = !!losses?.length;
  if (!hasWins && !hasLosses) return null;
  return (
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      {hasWins && (
        <div>
          <div className={`${labelCls} mb-2 text-emerald-500`}>Wins</div>
          <ul className="space-y-1.5">
            {wins!.map((w, i) => (
              <li key={i} className="flex gap-2 text-[13px] leading-snug text-[#bbb]">
                <span className="mt-px shrink-0 text-emerald-500">✓</span>
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {hasLosses && (
        <div>
          <div className={`${labelCls} mb-2 text-red-400`}>Losses</div>
          <ul className="space-y-2.5">
            {losses!.map((l, i) => (
              <LossRow key={l.evidence || i} loss={l} githubConnected={githubConnected} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
