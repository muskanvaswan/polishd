"use client";

/**
 * Polishd — the filed-issue list and its right-side drawer (client).
 *
 * The Issues tab's rows live here so a click can do something: each row opens
 * a drawer with the full issue — the body rendered as the markdown it is
 * (see `markdown.tsx`), not the raw text — plus the metadata GitHub reports
 * and the analytics context polishd kept. Same drawer pattern as the sampled
 * user journeys: the dashboard stays in view while you drill into one issue.
 *
 * The drawer also carries the "Suggest a fix" panel. With the GitHub codebase
 * connected, one click asks the configured model to classify the bug — an
 * interaction issue or a design issue — and propose a fix grounded in the
 * repository's source and in published practice (NN/g heuristics, the ARIA
 * Authoring Practices, WCAG 2.2), with the file-by-file implementation path.
 * Suggestions arrive pre-loaded from the server cache; generating a new one
 * goes through `suggestIssueFixAction`.
 */
import { useEffect, useState, useTransition, type ReactNode } from "react";

import { suggestIssueFixAction } from "../ai/actions";
import type {
  PolishdFiledIssue,
  PolishdFixSuggestion,
  PolishdGithubIssue,
} from "../ai/types";
import { Markdown } from "./markdown";
import { border, divider, labelCls as label, SpinnerIcon } from "./ui";

// ── Formatting helpers ────────────────────────────────────────────────────────

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

/** Which class of bug the fix suggestion decided this is. */
function BugTypeChip({ type }: { type: PolishdFixSuggestion["bugType"] }) {
  return type === "interaction" ? (
    <span className="shrink-0 rounded-full bg-blue-950 px-2 py-0.5 text-[10px] font-medium text-blue-400">
      interaction issue
    </span>
  ) : (
    <span className="shrink-0 rounded-full bg-purple-950 px-2 py-0.5 text-[10px] font-medium text-purple-300">
      design issue
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

// ── One clickable row ─────────────────────────────────────────────────────────

function IssueRow({
  issue,
  repo,
  onOpen,
}: {
  issue: PolishdFiledIssue;
  repo?: string;
  onOpen: () => void;
}) {
  const { detail } = issue;
  const title = detail?.title ?? issue.claim ?? `Issue #${issue.number}`;

  return (
    <div
      role="button"
      tabIndex={0}
      data-component="issue-open"
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={`group cursor-pointer px-4 py-4 transition-colors hover:bg-[#111] sm:px-5 ${divider} first:border-t-0`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <a
            href={issue.url}
            target="_blank"
            rel="noreferrer noopener"
            onClick={(e) => e.stopPropagation()}
            className="text-[14px] font-medium leading-snug text-white hover:text-[#8ab4f8]"
          >
            <span className="mr-1.5 font-mono text-[12px] tabular-nums text-[#666]">
              #{issue.number}
            </span>
            {title}
          </a>

          <p className="mt-1.5 text-[11px] leading-snug text-[#666]">{metaLine(issue)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatePill detail={detail} />
          <span className="text-[#555] transition-colors group-hover:text-[#999]">›</span>
        </div>
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

      {!detail && (
        <p className="mt-2.5 text-[12px] leading-relaxed text-[#777]">
          Polishd filed this issue{issue.filedAt ? ` on ${shortDate(issue.filedAt)}` : ""}, but
          GitHub won&apos;t return it now — it was deleted or transferred, or the access token
          no longer covers{repo ? ` ${repo}` : " the repository"}.
        </p>
      )}
    </div>
  );
}

// ── The suggest-a-fix panel (inside the drawer) ───────────────────────────────

function FixPanel({
  issueNumber,
  repo,
  suggestion,
  canSuggest,
  onSuggested,
}: {
  issueNumber: number;
  repo?: string;
  suggestion?: PolishdFixSuggestion;
  /** True when a model API key is configured — the button needs one. */
  canSuggest: boolean;
  onSuggested: (s: PolishdFixSuggestion) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (force: boolean) => {
    setError(null);
    startTransition(async () => {
      const res = await suggestIssueFixAction(issueNumber, force);
      if (res.ok) onSuggested(res.suggestion);
      else setError(res.message);
    });
  };

  const fileUrl = (path: string) =>
    repo ? `https://github.com/${repo}/blob/HEAD/${path}` : undefined;

  return (
    <div className={`border-t ${border} px-4 py-4 sm:px-5`}>
      <div className="mb-3 flex items-center gap-2">
        <div className="text-[10px] uppercase tracking-[0.08em] text-[#666]">Suggested fix</div>
        {suggestion && <BugTypeChip type={suggestion.bugType} />}
      </div>

      {suggestion ? (
        <>
          {suggestion.classification && (
            <p className="mb-3 text-[12px] leading-relaxed text-[#888]">
              {suggestion.classification}
            </p>
          )}

          <Markdown text={suggestion.approach} />

          {suggestion.steps.length > 0 && (
            <div className="mt-4">
              <div className="mb-2 text-[10px] uppercase tracking-[0.08em] text-[#666]">
                Implementation path
              </div>
              <ol>
                {suggestion.steps.map((step, i) => (
                  <li key={i} className="relative flex gap-3">
                    <div className="relative flex w-2.5 shrink-0 justify-center">
                      <span className="z-10 mt-[5px] h-2.5 w-2.5 shrink-0 rounded-full bg-[#555]" />
                      {i < suggestion.steps.length - 1 && (
                        <span className="absolute top-[5px] h-full w-px bg-[#2e2e2e]" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1 pb-3">
                      {fileUrl(step.path) ? (
                        <a
                          href={fileUrl(step.path)}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="break-all font-mono text-[12px] text-[#8ab4f8] hover:underline"
                        >
                          {step.path}
                        </a>
                      ) : (
                        <span className="break-all font-mono text-[12px] text-[#ccc]">
                          {step.path}
                        </span>
                      )}
                      <p className="mt-0.5 text-[12px] leading-relaxed text-[#aaa]">
                        {step.change}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {suggestion.practices.length > 0 && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] text-[#666]">grounded in</span>
              {suggestion.practices.map((p) => (
                <Chip key={p} tone="text-[#aaa]">
                  {p}
                </Chip>
              ))}
            </div>
          )}

          <div className="mt-3 flex items-center gap-2.5">
            <button
              type="button"
              data-component="issue-suggest-fix"
              onClick={() => run(true)}
              disabled={pending}
              className="rounded-md border border-[#2e2e2e] px-2.5 py-1 text-[11px] text-[#888] transition-colors hover:border-[#555] hover:text-white disabled:opacity-50"
            >
              {pending ? "Rethinking…" : "Regenerate"}
            </button>
            <span className="text-[10px] text-[#555]">
              {suggestion.model} · {timeAgo(suggestion.generatedAt)}
            </span>
          </div>
        </>
      ) : canSuggest ? (
        <>
          <p className="mb-3 text-[12px] leading-relaxed text-[#777]">
            Ask the configured model to classify this bug — interaction or design — and propose
            a fix grounded in the repository&apos;s source, with the files to change.
          </p>
          <button
            type="button"
            data-component="issue-suggest-fix"
            onClick={() => run(false)}
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-md border border-[#2e2e2e] px-3 py-1.5 text-[12px] text-[#aaa] transition-colors hover:border-[#555] hover:text-white disabled:opacity-50"
          >
            {pending && <SpinnerIcon />}
            {pending ? "Reading the source…" : "Suggest a fix"}
          </button>
        </>
      ) : (
        <p className="text-[12px] leading-relaxed text-[#777]">
          Configure a model API key in the settings and polishd can propose a fix for this
          issue from your source code.
        </p>
      )}

      {error && <p className="mt-2.5 text-[12px] leading-relaxed text-red-400">{error}</p>}
    </div>
  );
}

// ── Right-side detail drawer ──────────────────────────────────────────────────

function MetaCell({ label: labelText, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className={`px-4 py-3 ${border} border-t`}>
      <div className="text-[10px] uppercase tracking-[0.08em] text-[#666]">{labelText}</div>
      <div className={`mt-1 break-words text-[13px] text-white ${mono ? "font-mono text-[12px]" : ""}`}>
        {value}
      </div>
    </div>
  );
}

function IssueDrawer({
  issue,
  repo,
  suggestion,
  canSuggest,
  onClose,
  onSuggested,
}: {
  issue: PolishdFiledIssue | null;
  repo?: string;
  suggestion?: PolishdFixSuggestion;
  canSuggest: boolean;
  onClose: () => void;
  onSuggested: (s: PolishdFixSuggestion) => void;
}) {
  // Esc to close + lock background scroll while the drawer is open.
  useEffect(() => {
    if (!issue) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [issue, onClose]);

  const open = issue !== null;
  const detail = issue?.detail ?? null;

  return (
    <div className={`fixed inset-0 z-50 ${open ? "" : "pointer-events-none"}`} aria-hidden={!open}>
      {/* backdrop */}
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-black/60 transition-opacity duration-200 ${
          open ? "opacity-100" : "opacity-0"
        }`}
      />
      {/* panel — a notch wider than the journey drawer; issue bodies are prose */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Filed issue detail"
        className={`absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l ${border} bg-[#0a0a0a] shadow-2xl transition-transform duration-200 ease-out sm:max-w-xl ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {issue && (
          <>
            {/* header */}
            <div className={`flex items-center gap-3 border-b ${border} px-4 py-4 sm:px-5`}>
              <span className="font-mono text-[14px] font-semibold text-white">
                #{issue.number}
              </span>
              <StatePill detail={detail} />
              <a
                href={issue.url}
                target="_blank"
                rel="noreferrer noopener"
                className="ml-auto whitespace-nowrap text-[11px] text-[#888] transition-colors hover:text-white"
              >
                GitHub ↗
              </a>
              <button
                type="button"
                data-component="issue-close"
                onClick={onClose}
                aria-label="Close"
                className="flex h-7 w-7 items-center justify-center rounded-md border border-[#2e2e2e] text-[#888] transition-colors hover:bg-[#111] hover:text-white"
              >
                ✕
              </button>
            </div>

            {/* scrollable body */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <div className="px-4 pt-4 sm:px-5">
                <h2 className="text-[15px] font-semibold leading-snug text-white">
                  {detail?.title ?? issue.claim ?? `Issue #${issue.number}`}
                </h2>
                {issue.claim && issue.claim !== (detail?.title ?? issue.claim) && (
                  <p className="mt-2 text-[12px] leading-relaxed text-[#888]">
                    <span className={label}>Reported as</span>{" "}
                    <span className="text-[#aaa]">{issue.claim}</span>
                  </p>
                )}
                {(detail?.labels.length ?? 0) > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5 pb-1">
                    {detail?.labels.map((l) => <Chip key={l}>{l}</Chip>)}
                  </div>
                )}
                <div className="pb-4" />
              </div>

              {/* metadata grid */}
              <div className="grid grid-cols-2">
                <MetaCell
                  label="Opened"
                  value={
                    detail?.createdAt
                      ? shortDate(detail.createdAt)
                      : issue.filedAt
                        ? shortDate(issue.filedAt)
                        : "—"
                  }
                />
                <MetaCell label="Author" value={detail?.author ?? "—"} />
                <MetaCell label="Evidence" value={issue.evidence} mono />
                <MetaCell
                  label="Verification"
                  value={
                    issue.verdict === "confirmed"
                      ? "verified against source"
                      : issue.verdict === "inconclusive"
                        ? "filed unverified"
                        : "—"
                  }
                />
              </div>

              {/* the issue body, as the markdown it is */}
              <div className={`border-t ${border} px-4 py-4 sm:px-5`}>
                <div className="mb-3 text-[10px] uppercase tracking-[0.08em] text-[#666]">
                  Issue body
                </div>
                {detail ? (
                  detail.body.trim().length > 0 ? (
                    <Markdown text={detail.body} />
                  ) : (
                    <p className="text-[12px] italic text-[#555]">This issue has no body.</p>
                  )
                ) : (
                  <p className="text-[12px] leading-relaxed text-[#777]">
                    GitHub won&apos;t return this issue any more — it was deleted or
                    transferred, or the access token no longer covers
                    {repo ? ` ${repo}` : " the repository"}.
                  </p>
                )}
              </div>

              <FixPanel
                issueNumber={issue.number}
                repo={repo}
                suggestion={suggestion}
                canSuggest={canSuggest}
                onSuggested={onSuggested}
              />
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

// ── Exported list + drawer ────────────────────────────────────────────────────

export default function IssueList({
  issues,
  repo,
  suggestions: initialSuggestions,
  canSuggest,
}: {
  issues: PolishdFiledIssue[];
  /** The connected repository, "owner/repo". */
  repo?: string;
  /** Cached fix suggestions, keyed by issue number. */
  suggestions: Record<number, PolishdFixSuggestion>;
  /** True when a model API key is configured (fix suggestions need one). */
  canSuggest: boolean;
}) {
  const [selected, setSelected] = useState<PolishdFiledIssue | null>(null);
  const [suggestions, setSuggestions] = useState(initialSuggestions);

  return (
    <>
      {issues.map((issue) => (
        <IssueRow
          key={issue.evidence}
          issue={issue}
          repo={repo}
          onOpen={() => setSelected(issue)}
        />
      ))}
      <IssueDrawer
        issue={selected}
        repo={repo}
        suggestion={selected ? suggestions[selected.number] : undefined}
        canSuggest={canSuggest}
        onClose={() => setSelected(null)}
        onSuggested={(s) =>
          setSuggestions((prev) => ({ ...prev, [s.issueNumber]: s }))
        }
      />
    </>
  );
}
