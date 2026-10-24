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
import {
  ArrowUpRightIcon,
  Badge,
  ChevronRightIcon,
  SpinnerIcon,
  XIcon,
  divider,
  eyebrowCls,
  ghostBtn,
  iconBtn,
  labelCls as label,
  microBtn,
  textLink,
} from "./ui";

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
  const pill = (tone: "neutral" | "ok" | "violet", dot: string, text: string) => (
    <Badge tone={tone} className="shrink-0 rounded-full px-2">
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {text}
    </Badge>
  );
  if (!detail) return pill("neutral", "border border-fg-3", "unreadable");
  if (detail.state === "open") return pill("ok", "bg-ok", "open");
  return detail.stateReason === "not_planned"
    ? pill("neutral", "bg-fg-3", "not planned")
    : pill("violet", "bg-violet", "closed");
}

function Chip({ children, tone = "text-fg-2" }: { children: ReactNode; tone?: string }) {
  return (
    <span
      className={`max-w-full break-all rounded-md border border-line-strong bg-raised px-1.5 py-0.5 text-[11px] font-medium ${tone}`}
    >
      {children}
    </span>
  );
}

/** Which class of bug the fix suggestion decided this is. */
function BugTypeChip({ type }: { type: PolishdFixSuggestion["bugType"] }) {
  return type === "interaction" ? (
    <Badge tone="info" className="shrink-0">
      interaction issue
    </Badge>
  ) : (
    <Badge tone="violet" className="shrink-0">
      design issue
    </Badge>
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
      className={`group cursor-pointer px-4 py-4 transition-colors hover:bg-raised/50 sm:px-5 ${divider} first:border-t-0`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <a
            href={issue.url}
            target="_blank"
            rel="noreferrer noopener"
            onClick={(e) => e.stopPropagation()}
            className="text-[14px] font-medium leading-snug text-fg underline-offset-2 hover:underline"
          >
            <span className="mr-1.5 font-mono text-[12.5px] tabular-nums text-fg-3">
              #{issue.number}
            </span>
            {title}
          </a>

          <p className="mt-1.5 text-[12px] leading-snug text-fg-3">{metaLine(issue)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatePill detail={detail} />
          <span className="text-fg-4 transition-[color,transform] group-hover:translate-x-0.5 group-hover:text-fg-2">
            <ChevronRightIcon size={15} />
          </span>
        </div>
      </div>

      {/* What polishd knows and GitHub doesn't: where this came from. */}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <Chip>
          <span className="text-fg-3">evidence</span>{" "}
          <span className="font-mono">{issue.evidence}</span>
        </Chip>
        {issue.verdict === "confirmed" && <Badge tone="ok">verified against source</Badge>}
        {issue.verdict === "inconclusive" && <Badge tone="warn">filed unverified</Badge>}
        {(detail?.labels ?? []).map((l) => (
          <Chip key={l}>{l}</Chip>
        ))}
      </div>

      {!detail && (
        <p className="mt-2.5 text-[12.5px] leading-relaxed text-fg-3">
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
    <div className="border-t border-line px-4 py-5 sm:px-5">
      <div className="mb-3 flex items-center gap-2">
        <div className={eyebrowCls}>Suggested fix</div>
        {suggestion && <BugTypeChip type={suggestion.bugType} />}
      </div>

      {suggestion ? (
        <>
          {suggestion.classification && (
            <p className="mb-3 text-[12.5px] leading-relaxed text-fg-2">
              {suggestion.classification}
            </p>
          )}

          <Markdown text={suggestion.approach} />

          {suggestion.steps.length > 0 && (
            <div className="mt-5">
              <div className={`mb-3 ${eyebrowCls}`}>Implementation path</div>
              <ol>
                {suggestion.steps.map((step, i) => (
                  <li key={i} className="relative flex gap-3">
                    <div className="relative flex w-5 shrink-0 justify-center">
                      <span className="z-10 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-raised text-[10.5px] font-semibold tabular-nums text-fg-2 ring-1 ring-inset ring-line-strong">
                        {i + 1}
                      </span>
                      {i < suggestion.steps.length - 1 && (
                        <span className="absolute top-5 h-full w-px bg-line-strong" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1 pb-4 pt-px">
                      {fileUrl(step.path) ? (
                        <a
                          href={fileUrl(step.path)}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="break-all font-mono text-[12px] text-accent hover:underline"
                        >
                          {step.path}
                        </a>
                      ) : (
                        <span className="break-all font-mono text-[12px] text-fg-2">
                          {step.path}
                        </span>
                      )}
                      <p className="mt-1 text-[12.5px] leading-relaxed text-fg-2">
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
              <span className="text-[12px] text-fg-3">grounded in</span>
              {suggestion.practices.map((p) => (
                <Chip key={p}>
                  {p}
                </Chip>
              ))}
            </div>
          )}

          <div className="mt-4 flex items-center gap-2.5">
            <button
              type="button"
              data-component="issue-suggest-fix"
              onClick={() => run(true)}
              disabled={pending}
              className={microBtn}
            >
              {pending ? "Rethinking…" : "Regenerate"}
            </button>
            <span className="text-[12px] text-fg-3">
              {suggestion.model} · {timeAgo(suggestion.generatedAt)}
            </span>
          </div>
        </>
      ) : canSuggest ? (
        <>
          <p className="mb-4 text-[12.5px] leading-relaxed text-fg-2">
            Ask the configured model to classify this bug — interaction or design — and propose
            a fix grounded in the repository&apos;s source, with the files to change.
          </p>
          <button
            type="button"
            data-component="issue-suggest-fix"
            onClick={() => run(false)}
            disabled={pending}
            className={ghostBtn}
          >
            {pending && <SpinnerIcon size={13} />}
            {pending ? "Reading the source…" : "Suggest a fix"}
          </button>
        </>
      ) : (
        <p className="text-[12.5px] leading-relaxed text-fg-3">
          Configure a model API key in the settings and polishd can propose a fix for this
          issue from your source code.
        </p>
      )}

      {error && <p className="mt-2.5 text-[12px] leading-relaxed text-bad">{error}</p>}
    </div>
  );
}

// ── Right-side detail drawer ──────────────────────────────────────────────────

function MetaCell({ label: labelText, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="border-t border-line px-4 py-3 odd:border-r sm:px-5">
      <div className={label}>{labelText}</div>
      <div className={`mt-1 break-words text-[13px] font-medium text-fg ${mono ? "font-mono text-[12px]" : ""}`}>
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
      {/* backdrop — a button, because clicking it closes the drawer. As a
          plain div with a React onClick, the click capture can't see the
          handler and logs every close as a dead click. Hidden from assistive
          tech and the tab order; Escape and the ✕ button are the ways out. */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onClick={onClose}
        className={`absolute inset-0 cursor-default bg-black/60 backdrop-blur-[2px] transition-opacity duration-200 ${
          open ? "opacity-100" : "opacity-0"
        }`}
      />
      {/* panel — a notch wider than the journey drawer; issue bodies are prose */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Filed issue detail"
        className={`absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l border-line-strong bg-surface shadow-pop transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] sm:max-w-xl ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {issue && (
          <>
            {/* header */}
            <div className="flex items-center gap-3 border-b border-line px-4 py-3.5 sm:px-5">
              <span className="font-mono text-[15px] font-semibold text-fg">#{issue.number}</span>
              <StatePill detail={detail} />
              <a
                href={issue.url}
                target="_blank"
                rel="noreferrer noopener"
                className={`${ghostBtn} ml-auto h-8 px-2.5 text-[12px]`}
              >
                GitHub
                <ArrowUpRightIcon />
              </a>
              <button
                type="button"
                data-component="issue-close"
                onClick={onClose}
                aria-label="Close"
                className={iconBtn}
              >
                <XIcon size={15} />
              </button>
            </div>

            {/* scrollable body */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <div className="px-4 pt-5 sm:px-5">
                <h2 className="text-[17px] font-semibold leading-snug text-fg">
                  {detail?.title ?? issue.claim ?? `Issue #${issue.number}`}
                </h2>
                {issue.claim && issue.claim !== (detail?.title ?? issue.claim) && (
                  <p className="mt-2 text-[12.5px] leading-relaxed text-fg-3">
                    <span className={label}>Reported as</span>{" "}
                    <span className="text-fg-2">{issue.claim}</span>
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
              <div className="border-t border-line px-4 py-5 sm:px-5">
                <div className={`mb-3 ${eyebrowCls}`}>Issue body</div>
                {detail ? (
                  detail.body.trim().length > 0 ? (
                    <Markdown text={detail.body} />
                  ) : (
                    <p className="text-[12.5px] italic text-fg-3">This issue has no body.</p>
                  )
                ) : (
                  <p className="text-[12.5px] leading-relaxed text-fg-3">
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
