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
 *
 * Generating runs a review capture first (snapshot-capture.ts, purpose
 * "review"): the first screen of the three most-visited pages, desktop, light
 * and dark, with the flagged values pictured in place. Its pictures go to the
 * model with the metrics. Where it can't run — snapshots off here, the
 * service not yet allowed, a capture that failed — the review is made from
 * the metrics alone and the card says so. The server decides what can run;
 * this card only skips the attempt when the section already knows it's off.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { generateDesignReviewAction } from "../ai/actions";
import { setSnapshotBlockAction } from "./snapshot-actions";
import { runSnapshotCapture } from "./snapshot-capture";
import { useSnapshotsOptional } from "./snapshots";
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
  /** Whether the issues pointer links to the Actionables tab. */
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
  /** Why the last review went without screenshots, when it did. */
  const [unpictured, setUnpictured] = useState<string | null>(null);
  const [capturing, setCapturing] = useState<{ done: number; total: number } | null>(null);
  const [pending, startGenerate] = useTransition();
  const snapshots = useSnapshotsOptional();

  /**
   * Shoot the first screens and value pictures for this review, or say why
   * not. Never throws: a capture that fails still leaves a review to make.
   */
  const captureForReview = async (): Promise<string | undefined> => {
    const mode = snapshots?.availability.mode;
    if (mode?.kind === "disabled") {
      setUnpictured("Reviewed from the metrics alone — site snapshots are off here.");
      return undefined;
    }
    setCapturing({ done: 0, total: 0 });
    snapshots?.setReviewCapturing(true);
    try {
      const outcome = await runSnapshotCapture(
        {
          onPlan: (plan) => setCapturing({ done: 0, total: plan.routes.length * plan.renderings.length }),
          onShot: () => {},
          onProgress: (done, total) => setCapturing({ done, total }),
        },
        "review",
      );
      if (outcome.block) {
        const saved = await setSnapshotBlockAction(outcome.block).catch(() => null);
        snapshots?.noteBlock(saved?.ok && saved.block ? saved.block : { ...outcome.block, at: Date.now() });
      }
      if (outcome.consentRequired) {
        snapshots?.openConsent();
        setUnpictured(
          "Reviewed from the metrics alone — decide whether snapshots may use Polishd's screenshot service, then generate again to include screenshots.",
        );
        return undefined;
      }
      if (outcome.snapshot) {
        if (outcome.error) setUnpictured(`Some screenshots are missing: ${outcome.error}`);
        return outcome.snapshot.id;
      }
      setUnpictured(
        `Reviewed from the metrics alone — ${outcome.block?.message ?? outcome.error ?? "the screenshots couldn't be captured."}`,
      );
    } catch {
      setUnpictured("Reviewed from the metrics alone — the screenshot capture failed before a result came back.");
    } finally {
      snapshots?.setReviewCapturing(false);
      setCapturing(null);
    }
    return undefined;
  };

  const generate = (force: boolean) => {
    setError(null);
    setUnpictured(null);
    startGenerate(async () => {
      const captureId = await captureForReview();
      let res: GenerateDesignReviewResult;
      try {
        res = await generateDesignReviewAction(force, captureId);
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

  const canGenerate = hasApiKey && scannedPages > 0 && !snapshots?.capturing;
  const busyLabel = capturing
    ? `Capturing screenshots${capturing.total ? ` ${capturing.done}/${capturing.total}` : ""}…`
    : "Reviewing…";

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
                : pending
                  ? busyLabel
                  : snapshots?.capturing
                    ? "Wait for the snapshot capture to finish"
                    : "Regenerate the design review now — screenshots of the top pages are taken first"
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
        {pending && (
          <p className="mb-4 text-[12px] text-fg-3" aria-live="polite">
            {busyLabel}
          </p>
        )}
        {!pending && unpictured && (
          <p className="mb-4 text-[12px] leading-relaxed text-fg-3" data-component="design-review-unpictured">
            {unpictured}
          </p>
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
                {!!review.screenshots?.pages.length && (
                  <span
                    title={
                      "Shown to the model beside the metrics: the first screen of each page, light and dark where the site has both" +
                      (review.screenshots.values.length
                        ? `, and these values pictured in place — ${review.screenshots.values.join("; ")}`
                        : "")
                    }
                  >
                    {" "}· with screenshots of {review.screenshots.pages.join(", ")}
                    {review.screenshots.values.length > 0 &&
                      ` and ${review.screenshots.values.length} flagged value${review.screenshots.values.length === 1 ? "" : "s"}`}
                  </span>
                )}
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
                {pending ? busyLabel : (
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
