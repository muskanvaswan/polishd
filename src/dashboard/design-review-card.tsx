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

const border = "border-[#2e2e2e]";
const card = `border ${border} rounded-lg bg-[#0a0a0a]`;
const labelCls = "text-[11px] font-medium uppercase tracking-[0.08em] text-[#666]";
const iconBtn =
  "flex h-7 w-7 items-center justify-center rounded-md border border-[#2e2e2e] text-[#aaa] transition-colors hover:border-[#555] hover:text-white disabled:cursor-not-allowed disabled:opacity-40";
const primaryBtn =
  "rounded-md bg-white px-3 py-1.5 text-[12px] font-medium text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40";

function relTime(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={spinning ? "animate-spin" : undefined}
      aria-hidden
    >
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}

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
              ? "Connect a model first (Analytics tab → summary card settings)"
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
            <p className="text-[14px] leading-relaxed text-[#e4e4e4]">{review.text}</p>
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
                ? "No model connected. Configure one in the Analytics tab's summary card — the design review uses the same provider and key."
                : scannedPages === 0
                  ? "No pages scanned yet — browse the site and the design metrics will appear here."
                  : "No review yet — ask the model how coherent this design system reads, and what would sharpen it."}
            </p>
            <button
              type="button"
              onClick={() => generate(false)}
              disabled={pending || !canGenerate}
              className={primaryBtn}
            >
              {pending ? "Reviewing…" : "Generate review"}
            </button>
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
                <span>{s}</span>
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
                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    <code className="rounded bg-[#1a1a1a] px-1.5 py-0.5 font-mono text-[10px] text-[#888]">
                      {iss.evidence}
                    </code>
                    {iss.suggestion && (
                      <span className="rounded bg-[#101c14] px-1.5 py-0.5 text-[10px] text-emerald-500">
                        → {iss.suggestion}
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
