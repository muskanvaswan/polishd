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
 *    owner configured for the analytics summary. Each issue carries the same
 *    controls as the summary's losses: "Ignore", and "File bug" when GitHub is
 *    connected.
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

import {
  createIssueFromDesignIssueAction,
  generateDesignReviewAction,
  ignoreDesignIssueAction,
  unignoreDesignIssueAction,
} from "../ai/actions";
import { setSnapshotBlockAction } from "./snapshot-actions";
import { runSnapshotCapture } from "./snapshot-capture";
import { useSnapshotsOptional } from "./snapshots";
import type {
  GenerateDesignReviewResult,
  PolishdDesignIssue,
  PolishdDesignReview,
  PolishdIgnoredDesignIssue,
} from "../ai/types";
import CardRail, { railCard } from "./card-rail";
import { TabLink } from "./chrome";
import { Annotated } from "./design-tokens";
import { DismissedCard, IgnoreButton, useDismissal } from "./dismissable";
import { FileBugButton } from "./file-bug-button";
import { findingKey } from "./fix-prompt";
import type { LossChange } from "./summary";
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
  /** Told when an issue is ignored, restored or filed, keyed by `findingKey`. */
  onIssueChange?: (key: string, change: LossChange) => void;
  /** Dismissals recorded elsewhere (a pasted verdict block), keyed by `findingKey`. */
  dismissed?: ReadonlyMap<string, PolishdIgnoredDesignIssue>;
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
  onIssueChange,
  dismissed,
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
            <StrengthsIssues
              strengths={review.strengths}
              issues={review.issues}
              githubConnected={githubConnected}
              onIssueChange={onIssueChange}
              dismissed={dismissed}
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

function StrengthsIssues({
  strengths,
  issues,
  githubConnected,
  onIssueChange,
  dismissed,
}: {
  strengths: PolishdDesignReview["strengths"];
  issues: PolishdDesignReview["issues"];
  githubConnected: boolean;
  onIssueChange?: (key: string, change: LossChange) => void;
  dismissed?: ReadonlyMap<string, PolishdIgnoredDesignIssue>;
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
          {issues!.map((iss, i) => (
            <IssueCard
              key={`${i}:${findingKey(iss)}`}
              iss={iss}
              githubConnected={githubConnected}
              onChange={onIssueChange && ((change) => onIssueChange(findingKey(iss), change))}
              adopted={dismissed?.get(findingKey(iss))}
            />
          ))}
        </CardRail>
      )}
    </>
  );
}

/**
 * One issue: the problem, its evidence, the fix — or why the fix was withheld
 * (it contradicted the review's own strengths, or redesigned the system) —
 * and the same two verdicts a loss has, file it or ignore it. An ignored issue
 * leaves every later review, and its reason is replayed to the model.
 */
function IssueCard({
  iss,
  githubConnected,
  onChange,
  adopted,
}: {
  iss: PolishdDesignIssue;
  githubConnected: boolean;
  onChange?: (change: LossChange) => void;
  adopted?: PolishdIgnoredDesignIssue;
}) {
  const dismissal = useDismissal({
    dismiss: (reason) => ignoreDesignIssueAction({ issue: iss.issue, evidence: iss.evidence }, reason),
    restore: () => unignoreDesignIssueAction({ issue: iss.issue, evidence: iss.evidence }),
    onChange: (ignored) => onChange?.({ ignored }),
    adopted,
  });

  if (dismissal.ignored) {
    return (
      <DismissedCard
        issue={iss.issue}
        state={dismissal}
        componentPrefix="design"
        readBy="review"
        noun="issue"
      />
    );
  }

  return (
    <li className={`${railCard} text-fg-2`}>
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
        {iss.suggestion && !!iss.newValues?.length && (
          <Badge
            className="self-start"
            title="The suggestion names a value the site doesn't render anywhere yet"
          >
            New to the site: {iss.newValues.join(", ")}
          </Badge>
        )}
        {iss.suggestionWithheld && (
          <span
            className="rounded-lg border border-line bg-raised px-2.5 py-1.5 text-[11.5px] leading-relaxed text-fg-3"
            title="Polishd dropped the model's suggested fix — the problem may still be real"
          >
            Suggestion withheld: {iss.suggestionWithheld}
          </span>
        )}
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-3">
        {(githubConnected || !!iss.issueUrl) && (
          <FileBugButton
            dataComponent="design-file-bug"
            onFiled={(filed) => onChange?.({ filed })}
            filed={iss.issueUrl ? { url: iss.issueUrl, number: iss.issueNumber ?? 0 } : null}
            file={() =>
              createIssueFromDesignIssueAction({
                issue: iss.issue,
                evidence: iss.evidence,
                suggestion: iss.suggestion,
              })
            }
          />
        )}
        <IgnoreButton
          state={dismissal}
          dataComponent="design-ignore"
          title="Not a problem — drop it from this review and stop the model reporting it again"
        />
      </div>
    </li>
  );
}
