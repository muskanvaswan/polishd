"use client";

/**
 * Polishd — the Overview's paragraph, and the numbers under it (client).
 *
 * The Analytics tab tells how visitors use the site; the Design tab tells how
 * the rendered design holds together. Each has its own card with its own
 * findings, buttons and refresh. The Overview wants one story, so the model
 * is asked to fold the two into a single paragraph (ai/overview.ts), and that
 * paragraph is all this card shows — not the two texts one after the other,
 * and not the problems, which stay on their tabs with the controls that act
 * on them. The card carries its own caption and refresh; the headline numbers
 * sit under it in the same column.
 *
 * The paragraph is written from the two reviews, so it follows them: one
 * refresh regenerates the summary, the review and then the paragraph, and a
 * paragraph that's missing or that either review has outrun is rewritten
 * when the page opens — the reviews it's made from were already asked for,
 * and folding them is the one call the Overview owes for itself. Nothing
 * else here calls a model unprompted.
 */
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";

import {
  generateDesignReviewAction,
  generateOverviewAction,
  generateSummaryAction,
} from "../ai/actions";
import type {
  PolishdAISettingsPublic,
  PolishdDesignReview,
  PolishdOverview,
  PolishdSummary,
} from "../ai/types";
import { TabLink } from "./chrome";
import { UNREACHABLE } from "./dismissable";
import { Badge, Callout, RefreshIcon, SparkIcon, card, eyebrowCls, iconBtn, primaryBtn, relTime } from "./ui";

export interface OverviewSummaryProps {
  initialStory: PolishdOverview | null;
  /** True when a review has changed since the paragraph was written. */
  initialStale: boolean;
  /** The reviews as the page holds them now — what the paragraph is written from. */
  summary: PolishdSummary | null;
  review: PolishdDesignReview | null;
  settings: PolishdAISettingsPublic;
  /** Pages with a design scan — the design review can't run without one. */
  scannedPages: number;
  /** Told when a regenerate lands — the Overview builds its fix prompt from these. */
  onSummaryChange?: (summary: PolishdSummary) => void;
  onReviewChange?: (review: PolishdDesignReview) => void;
  /** What sits under the card in the same column — the headline numbers. */
  children?: ReactNode;
}

export default function OverviewSummary({
  initialStory,
  initialStale,
  summary,
  review,
  settings,
  scannedPages,
  onSummaryChange,
  onReviewChange,
  children,
}: OverviewSummaryProps) {
  const [story, setStory] = useState(initialStory);
  const [stale, setStale] = useState(initialStale);
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const autoStarted = useRef(false);

  const hasKey = settings.hasApiKey;
  const hasSources = summary !== null || review !== null;
  const canSummary = hasKey;
  const canReview = hasKey && scannedPages > 0;

  /**
   * Fold the reviews as they stand into the paragraph. Not forced: the
   * server returns the cached paragraph when nothing has changed, so this is
   * free to call whenever the paragraph might be behind.
   */
  const write = async (force: boolean): Promise<string | null> => {
    try {
      const res = await generateOverviewAction(force);
      if (!res.ok) return res.message;
      setStory(res.overview);
      setStale(false);
      return null;
    } catch {
      // The action threw rather than returning — an expired dashboard
      // session, a function timeout. Uncaught inside a transition it would
      // take the whole tab down.
      return UNREACHABLE;
    }
  };

  /** The whole story, fresh: both reviews again, then the paragraph from them. */
  const refresh = () => {
    setErrors([]);
    start(async () => {
      const jobs: Promise<string | null>[] = [];
      if (canSummary) {
        jobs.push(
          generateSummaryAction(true)
            .then((res) => {
              if (!res.ok) return `Analytics: ${res.message}`;
              onSummaryChange?.(res.summary);
              return null;
            })
            .catch(() => `Analytics: ${UNREACHABLE}`),
        );
      }
      if (canReview) {
        jobs.push(
          generateDesignReviewAction(true)
            .then((res) => {
              if (!res.ok) return `Design: ${res.message}`;
              onReviewChange?.(res.review);
              return null;
            })
            .catch(() => `Design: ${UNREACHABLE}`),
        );
      }
      const failed = (await Promise.all(jobs)).filter((m): m is string => m !== null);
      // Whatever came back, the paragraph is rewritten from what's stored now.
      const wrote = await write(true);
      if (wrote) failed.push(wrote);
      setErrors(failed);
    });
  };

  // A paragraph that's missing or behind its reviews is written on open.
  useEffect(() => {
    if (autoStarted.current || !hasKey || !hasSources || (story !== null && !stale)) return;
    autoStarted.current = true;
    start(async () => {
      const wrote = await write(false);
      if (wrote) setErrors([wrote]);
    });
    // Once per mount, by design — a failure is shown, not retried in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const writing = pending && story === null;

  return (
    <>
      {/* data-component names feed polishd's own dashboard telemetry; inert for host apps. */}
      <section
        data-component="overview-summary"
        aria-label="Overview"
        className={`${card} overflow-hidden`}
      >
        <div className="px-4 pb-5 pt-4 sm:px-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className={eyebrowCls}>Overview</span>
            <button
              type="button"
              data-component="overview-summary-refresh"
              onClick={refresh}
              disabled={pending || !hasKey}
              title={
                hasKey
                  ? "Regenerate the analytics summary and the design review, then this paragraph from them"
                  : "Connect a model first — Settings tab"
              }
              aria-label="Refresh overview"
              className={iconBtn}
            >
              <RefreshIcon spinning={pending} />
            </button>
          </div>

          {errors.map((message) => (
            <Callout key={message} tone="bad" className="mb-4">
              {message}
            </Callout>
          ))}

          {story ? (
            <>
              <p className="max-w-[80ch] text-[15px] leading-[1.7] text-fg">{story.text}</p>
              <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-fg-3">
                <span className="inline-flex items-center gap-1.5">
                  <span className="text-accent">
                    <SparkIcon size={12} />
                  </span>
                  Written {relTime(story.generatedAt)} from{" "}
                  {story.sources.length === 2
                    ? "the analytics summary and the design review"
                    : story.sources[0] === "review"
                      ? "the design review"
                      : "the analytics summary"}{" "}
                  · {story.provider}/{story.model}
                </span>
                {pending ? (
                  <Badge tone="neutral">Updating…</Badge>
                ) : (
                  stale && <Badge tone="warn">A review has changed since this was written — refresh to update</Badge>
                )}
              </div>
            </>
          ) : writing ? (
            <p className="text-[13px] text-fg-3 motion-safe:animate-pulse">Writing the overview…</p>
          ) : (
            <Empty
              hasKey={hasKey}
              hasSources={hasSources}
              pending={pending}
              onGenerate={refresh}
            />
          )}
        </div>
      </section>
      {children}
    </>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function Empty({
  hasKey,
  hasSources,
  pending,
  onGenerate,
}: {
  hasKey: boolean;
  hasSources: boolean;
  pending: boolean;
  onGenerate: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <p className="max-w-2xl text-[13px] leading-relaxed text-fg-2">
        {!hasKey
          ? "No model connected yet. Add a key in Settings and Polishd will read the numbers and the design back to you in one paragraph."
          : hasSources
            ? "The overview couldn't be written — try again."
            : "No overview yet — generate the story of how visitors use this site and how its design holds together."}
      </p>
      {hasKey ? (
        <button
          type="button"
          data-component="overview-summary-generate"
          onClick={onGenerate}
          disabled={pending}
          className={primaryBtn}
        >
          {pending ? "Thinking…" : hasSources ? "Try again" : "Generate overview"}
        </button>
      ) : (
        <span data-component="ai-connect-model" className="contents">
          <TabLink tab="settings" className={primaryBtn}>
            Connect a model
          </TabLink>
        </span>
      )}
    </div>
  );
}
