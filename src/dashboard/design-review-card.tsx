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
 *    owner configured for the analytics summary.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { generateDesignReviewAction } from "../ai/actions";
import type { PolishdDesignIssue, PolishdDesignReview } from "../ai/types";
import { TabLink } from "./chrome";
import { Annotated } from "./design-tokens";
import { RefreshIcon, border, card, iconBtn, labelCls, primaryBtn, relTime } from "./ui";

/** Re-run the deterministic metrics: refresh the server render in place. */
export function RefreshMetricsButton() {
  const router = useRouter();
  const [pending, startRefresh] = useTransition();
  return (
    <button
      type="button"
      onClick={() => startRefresh(() => router.refresh())}
      disabled={pending}
      title="Recompute the design metrics from the latest page scans"
      className="flex items-center gap-1.5 rounded-md border border-[#2e2e2e] px-2.5 py-1.5 text-[12px] text-[#aaa] transition-colors hover:border-[#555] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
    >
      <RefreshIcon spinning={pending} />
      {pending ? "Refreshing…" : "Refresh metrics"}
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
}

/** The model's aesthetic read of the measured design system. */
export default function DesignReviewCard({
  initialReview,
  initialStale,
  hasApiKey,
  provider,
  model,
  scannedPages,
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
      } else {
        setError(res.message);
      }
    });
  };

  const canGenerate = hasApiKey && scannedPages > 0;

  return (
    <section className={`mb-8 ${card} overflow-hidden`}>
      <div className={`flex items-center justify-between gap-3 border-b ${border} px-4 py-3 sm:px-5`}>
        <div className="flex items-center gap-2">
          <span className={labelCls}>Aesthetic review</span>
          {hasApiKey && (
            <span className="hidden rounded-full bg-[#1a1a1a] px-2 py-0.5 text-[10px] font-medium text-[#888] sm:inline">
              {provider} · {model}
            </span>
          )}
        </div>
        <button
          type="button"
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

      <div className="px-4 py-4 sm:px-5 sm:py-5">
        {error && (
          <div className="mb-3 rounded-md border border-red-900/50 bg-red-950/30 px-3 py-2 text-[12px] text-red-400">
            {error}
          </div>
        )}

        {review ? (
          <>
            <p className="text-[14px] leading-relaxed text-[#e4e4e4]">
              <Annotated text={review.text} />
            </p>
            <StrengthsIssues strengths={review.strengths} issues={review.issues} />
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#555]">
              <span>
                Generated {relTime(review.generatedAt)} · {review.provider}/{review.model}
              </span>
              {stale && (
                <span className="rounded-full bg-amber-950/50 px-2 py-0.5 text-amber-400">
                  Metrics changed since this review — refresh to update
                </span>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[13px] leading-relaxed text-[#888]">
              {!hasApiKey
                ? "No model connected. The design review uses the same provider and key as the analytics summary — add one in Settings."
                : scannedPages === 0
                  ? "No pages scanned yet — browse the site and the design metrics will appear here."
                  : "No review yet — ask the model how coherent this design system reads, and what would sharpen it."}
            </p>
            {hasApiKey ? (
              <button
                type="button"
                onClick={() => generate(false)}
                disabled={pending || !canGenerate}
                className={primaryBtn}
              >
                {pending ? "Reviewing…" : "Generate review"}
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
}: {
  strengths: PolishdDesignReview["strengths"];
  issues: PolishdDesignReview["issues"];
}) {
  const hasStrengths = !!strengths?.length;
  const hasIssues = !!issues?.length;
  if (!hasStrengths && !hasIssues) return null;
  return (
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      {hasStrengths && (
        <div>
          <div className={`${labelCls} mb-2 text-emerald-500`}>Working</div>
          <ul className="space-y-1.5">
            {strengths!.map((s, i) => (
              <li key={i} className="flex gap-2 text-[13px] leading-snug text-[#bbb]">
                <span className="mt-px shrink-0 text-emerald-500">✓</span>
                <span>
                  <Annotated text={s} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {hasIssues && (
        <div>
          <div className={`${labelCls} mb-2 text-amber-400`}>Breaking the system</div>
          <ul className="space-y-2.5">
            {issues!.map((iss: PolishdDesignIssue, i) => (
              <li key={i} className="flex gap-2 text-[13px] leading-snug text-[#bbb]">
                <span className="mt-px shrink-0 text-amber-400">✕</span>
                <span>
                  {iss.issue}
                  <span className="mt-1.5 flex flex-col items-start gap-1">
                    <span className="rounded bg-[#161616] px-2 py-1 text-[12px] leading-relaxed text-[#aaa]">
                      <Annotated text={iss.evidence} />
                    </span>
                    {iss.suggestion && (
                      <span className="rounded bg-[#101c14] px-2 py-1 text-[12px] leading-relaxed text-emerald-400">
                        → <Annotated text={iss.suggestion} />
                      </span>
                    )}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
