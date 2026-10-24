"use client";

/**
 * Polishd — Design tab client pieces.
 *
 * Two interactive controls sit on the otherwise server-rendered Design tab:
 *
 *  • `RefreshMetricsButton` — re-runs the deterministic metrics by refreshing
 *    the server render (new scans land in the store as visitors browse; this
 *    pulls them in without a full reload).
 *  • `DesignReviewCard` — the AI's aesthetic read of those metrics. Rendered
 *    from the cached review handed down by the server; a model is only called
 *    on the explicit refresh action. Uses the same provider/model/key the
 *    owner configured for the analytics summary. When GitHub is connected,
 *    each issue carries the same "file bug" button as the summary's losses.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createIssueFromDesignIssueAction, generateDesignReviewAction } from "../ai/actions";
import type { PolishdDesignIssue, PolishdDesignReview } from "../ai/types";
import CardRail, { railCard } from "./card-rail";
import { TabLink } from "./chrome";
import { Annotated } from "./design-tokens";
import { FileBugButton } from "./file-bug-button";
import {
  ArrowRightIcon,
  Badge,
  Callout,
  CheckIcon,
  RefreshIcon,
  SparkIcon,
  card,
  cardHeader,
  cardTitleCls,
  iconBtn,
  primaryBtn,
  relTime,
} from "./ui";

/** Re-run the deterministic metrics: refresh the server render in place. */
export function RefreshMetricsButton() {
  const router = useRouter();
  const [pending, startRefresh] = useTransition();
  return (
    <button
      type="button"
      data-component="design-metrics-refresh"
      onClick={() => startRefresh(() => router.refresh())}
      disabled={pending}
      title={pending ? "Refreshing…" : "Recompute the design metrics from the latest page scans"}
      aria-label="Refresh metrics"
      className={iconBtn}
    >
      <RefreshIcon spinning={pending} />
    </button>
  );
}

export interface DesignReviewCardProps {
  initialReview: PolishdDesignReview | null;
  initialStale: boolean;
  hasApiKey: boolean;
  provider: string;
  model: string;
  /** Pages with a design scan — 0 disables generation with a hint. */
  scannedPages: number;
  /** True when a GitHub repo + token are configured — enables "File bug". */
  githubConnected: boolean;
  /** Told when a regenerate lands — the Overview builds its fix prompt from it. */
  onReviewChange?: (review: PolishdDesignReview) => void;
  /** Told when an issue is filed from one of the review's problems, keyed by its evidence. */
  onIssueFiled?: (evidence: string, filed: { url: string; number: number }) => void;
}

/** The model's aesthetic read of the measured design system. */
export default function DesignReviewCard({
  initialReview,
  initialStale,
  hasApiKey,
  provider,
  model,
  scannedPages,
  githubConnected,
  onReviewChange,
  onIssueFiled,
}: DesignReviewCardProps) {
  const [review, setReview] = useState<PolishdDesignReview | null>(initialReview);
  const [stale, setStale] = useState(initialStale);
  const [error, setError] = useState<string | null>(null);
  const [pending, startGenerate] = useTransition();

  const generate = (force: boolean) => {
    setError(null);
    startGenerate(async () => {
      const res = await generateDesignReviewAction(force);
      if (res.ok) {
        setReview(res.review);
        setStale(false);
        onReviewChange?.(res.review);
      } else {
        setError(res.message);
      }
    });
  };

  const canGenerate = hasApiKey && scannedPages > 0;

  return (
    <section className={`mb-10 ${card} overflow-hidden`}>
      <div className={cardHeader}>
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="text-accent">
            <SparkIcon size={15} />
          </span>
          <span className={cardTitleCls}>Aesthetic review</span>
          {hasApiKey && (
            <span className="hidden min-w-0 sm:flex">
              <Badge mono className="truncate">
                {provider} · {model}
              </Badge>
            </span>
          )}
        </div>
        <button
          type="button"
          data-component="design-review-refresh"
          onClick={() => generate(review !== null)}
          disabled={pending || !canGenerate}
          title={
            !hasApiKey
              ? "Connect a model first — Settings tab"
              : scannedPages === 0
                ? "No pages scanned yet"
                : "Regenerate the design review now"
          }
          aria-label="Refresh design review"
          className={iconBtn}
        >
          <RefreshIcon spinning={pending} />
        </button>
      </div>

      <div className="px-4 py-5 sm:px-5">
        {error && (
          <Callout tone="bad" className="mb-4">
            {error}
          </Callout>
        )}

        {review ? (
          <>
            <p className="max-w-[72ch] text-[15px] leading-[1.7] text-fg">
              <Annotated text={review.text} />
            </p>
            <StrengthsIssues
              strengths={review.strengths}
              issues={review.issues}
              githubConnected={githubConnected}
              onIssueFiled={onIssueFiled}
            />
            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-fg-3">
              <span>
                Generated {relTime(review.generatedAt)} · {review.provider}/{review.model}
              </span>
              {stale && <Badge tone="warn">Metrics changed since this review — refresh to update</Badge>}
            </div>
          </>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="max-w-2xl text-[13px] leading-relaxed text-fg-2">
              {!hasApiKey
                ? "No model connected. The design review uses the same provider and key as the analytics summary — add one in Settings."
                : scannedPages === 0
                  ? "No pages scanned yet — browse the site and the design metrics will appear here."
                  : "No review yet — ask the model how coherent this design system reads, and what would sharpen it."}
            </p>
            {hasApiKey ? (
              <button
                type="button"
                data-component="design-review-generate"
                onClick={() => generate(false)}
                disabled={pending || !canGenerate}
                className={primaryBtn}
              >
                {pending ? "Reviewing…" : (
                  <>
                    <SparkIcon size={13} />
                    Generate review
                  </>
                )}
              </button>
            ) : (
              <TabLink tab="settings" className={primaryBtn}>
                Connect a model
              </TabLink>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function StrengthsIssues({
  strengths,
  issues,
  githubConnected,
  onIssueFiled,
}: {
  strengths: PolishdDesignReview["strengths"];
  issues: PolishdDesignReview["issues"];
  githubConnected: boolean;
  onIssueFiled?: (evidence: string, filed: { url: string; number: number }) => void;
}) {
  const hasStrengths = !!strengths?.length;
  const hasIssues = !!issues?.length;
  if (!hasStrengths && !hasIssues) return null;
  return (
    <>
      {hasStrengths && (
        <div className="mt-5">
          <div className="mb-2.5 flex items-center gap-2 text-[13px] font-semibold text-fg">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-ok" />
            Working
          </div>
          <ul className="space-y-2">
            {strengths!.map((s, i) => (
              <li key={i} className="flex gap-2.5 text-[13px] leading-snug text-fg-2">
                <span className="mt-px shrink-0 text-ok">
                  <CheckIcon size={13} />
                </span>
                <span>
                  <Annotated text={s} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {hasIssues && (
        <CardRail label="Breaking the system" tone="bg-warn" count={issues!.length}>
          {issues!.map((iss: PolishdDesignIssue, i) => (
            <li key={i} className={`${railCard} text-fg-2`}>
              <div className="flex gap-2">
                <span className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-warn" aria-hidden />
                <span className="text-fg">{iss.issue}</span>
              </div>
              <div className="mt-2.5 flex flex-col items-stretch gap-1.5">
                <span className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12px] leading-relaxed text-fg-2">
                  <Annotated text={iss.evidence} />
                </span>
                {iss.suggestion && (
                  <span className="flex gap-1.5 rounded-lg border border-ok/20 bg-ok/[0.06] px-2.5 py-1.5 text-[12px] leading-relaxed text-fg-2">
                    <span className="mt-[3px] shrink-0 text-ok">
                      <ArrowRightIcon size={11} />
                    </span>
                    <span>
                      <Annotated text={iss.suggestion} />
                    </span>
                  </span>
                )}
              </div>
              {(githubConnected || !!iss.issueUrl) && (
                <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-3">
                  <FileBugButton
                    dataComponent="design-file-bug"
                    onFiled={(filed) => onIssueFiled?.(iss.evidence, filed)}
                    filed={iss.issueUrl ? { url: iss.issueUrl, number: iss.issueNumber ?? 0 } : null}
                    file={() =>
                      createIssueFromDesignIssueAction({
                        issue: iss.issue,
                        evidence: iss.evidence,
                        suggestion: iss.suggestion,
                      })
                    }
                  />
                </div>
              )}
            </li>
          ))}
        </CardRail>
      )}
    </>
  );
}
