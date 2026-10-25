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
 *    owner configured for the analytics summary. The card is the assessment
 *    and what's working; the issues it raises are actionables, listed with
 *    the summary's losses (actionable-list.tsx), and the card ends with how
 *    many are waiting there.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { generateDesignReviewAction } from "../ai/actions";
import type { GenerateDesignReviewResult, PolishdDesignReview } from "../ai/types";
import { TabLink } from "./chrome";
import { Annotated } from "./design-tokens";
import { ActionablesPointer } from "./summary";
import {
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
  /** Told when a regenerate lands — the Overview builds its fix prompt from it. */
  onReviewChange?: (review: PolishdDesignReview) => void;
  /**
   * Whether the issues pointer links to the Actionables tab. The Overview
   * passes false: its own Actionables section sits right below the card.
   */
  actionablesLink?: boolean;
}

/** The model's aesthetic read of the measured design system. */
export default function DesignReviewCard({
  initialReview,
  initialStale,
  hasApiKey,
  provider,
  model,
  scannedPages,
  onReviewChange,
  actionablesLink = true,
}: DesignReviewCardProps) {
  const [review, setReview] = useState<PolishdDesignReview | null>(initialReview);
  const [stale, setStale] = useState(initialStale);
  const [error, setError] = useState<string | null>(null);
  const [pending, startGenerate] = useTransition();

  const generate = (force: boolean) => {
    setError(null);
    startGenerate(async () => {
      let res: GenerateDesignReviewResult;
      try {
        res = await generateDesignReviewAction(force);
      } catch {
        // The action threw rather than returning a result — an expired
        // dashboard session, a function timeout. In production that arrives as
        // Next's redacted "error occurred in the Server Components render", and
        // uncaught inside a transition it takes the whole tab down.
        setError("Couldn't reach the server — reload the page and try again.");
        return;
      }
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
            <Strengths strengths={review.strengths} />
            <ActionablesPointer
              count={review.issues?.length ?? 0}
              tone="bg-warn"
              from="the design review"
              link={actionablesLink}
            />
            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-fg-3">
              <span>
                Generated {relTime(review.generatedAt)} · {review.provider}/{review.model}
              </span>
              {stale && <Badge tone="warn">Something&apos;s changed since this review — refresh to update</Badge>}
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

/** What the system gets right, as the model listed it. */
function Strengths({ strengths }: { strengths: PolishdDesignReview["strengths"] }) {
  if (!strengths?.length) return null;
  return (
    <div className="mt-5">
      <div className="mb-2.5 flex items-center gap-2 text-[13px] font-semibold text-fg">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-ok" />
        Working
      </div>
      <ul className="space-y-2">
        {strengths.map((s, i) => (
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
  );
}
