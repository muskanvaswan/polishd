"use client";

/**
 * Polishd — the Overview's summary: both reviews as one story (client).
 *
 * The Analytics tab tells how visitors use the site; the Design tab tells how
 * the rendered design holds together. Each has its own card with its own
 * findings, buttons and refresh. The Overview wants the reading, not the
 * paperwork: the two narratives one after the other, what's working under
 * them, and when they were written — the same shape as the fix prompt, minus
 * the instructions to an agent and minus the problems themselves, which stay
 * on their tabs with the controls that act on them.
 *
 * One refresh regenerates both, in parallel — a single story has a single
 * clock. Each half still fails on its own, so a model error on the design
 * side never costs the analytics summary that came back fine. Nothing is sent
 * to a model until a button is pressed.
 */
import { useState, useTransition } from "react";

import { generateDesignReviewAction, generateSummaryAction } from "../ai/actions";
import type { PolishdAISettingsPublic, PolishdDesignReview, PolishdSummary } from "../ai/types";
import { TabLink } from "./chrome";
import { Annotated } from "./design-tokens";
import Section from "./overview-section";
import { RefreshIcon, card, iconBtn, labelCls, microBtn, primaryBtn, relTime } from "./ui";

export interface OverviewSummaryProps {
  initialSummary: PolishdSummary | null;
  initialSummaryStale: boolean;
  initialReview: PolishdDesignReview | null;
  initialReviewStale: boolean;
  settings: PolishdAISettingsPublic;
  /** Pages with a design scan — the review can't run without one. */
  scannedPages: number;
  /** Told when a regenerate lands — the Overview builds its fix prompt from these. */
  onSummaryChange?: (summary: PolishdSummary) => void;
  onReviewChange?: (review: PolishdDesignReview) => void;
}

type Half = "summary" | "review";

export default function OverviewSummary({
  initialSummary,
  initialSummaryStale,
  initialReview,
  initialReviewStale,
  settings,
  scannedPages,
  onSummaryChange,
  onReviewChange,
}: OverviewSummaryProps) {
  const [summary, setSummary] = useState(initialSummary);
  const [review, setReview] = useState(initialReview);
  const [summaryStale, setSummaryStale] = useState(initialSummaryStale);
  const [reviewStale, setReviewStale] = useState(initialReviewStale);
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, startGenerate] = useTransition();

  const canSummary = settings.hasApiKey;
  const canReview = settings.hasApiKey && scannedPages > 0;

  /** Run the halves asked for; each reports its own failure. */
  const generate = (halves: Half[], force: boolean) => {
    setErrors([]);
    startGenerate(async () => {
      const jobs: Promise<string | null>[] = [];
      if (halves.includes("summary") && canSummary) {
        jobs.push(
          generateSummaryAction(force).then((res) => {
            if (!res.ok) return `Analytics: ${res.message}`;
            setSummary(res.summary);
            setSummaryStale(false);
            onSummaryChange?.(res.summary);
            return null;
          }),
        );
      }
      if (halves.includes("review") && canReview) {
        jobs.push(
          generateDesignReviewAction(force).then((res) => {
            if (!res.ok) return `Design: ${res.message}`;
            setReview(res.review);
            setReviewStale(false);
            onReviewChange?.(res.review);
            return null;
          }),
        );
      }
      const failed = (await Promise.all(jobs)).filter((m): m is string => m !== null);
      setErrors(failed);
    });
  };

  const hasAny = summary !== null || review !== null;
  const stale = (summary !== null && summaryStale) || (review !== null && reviewStale);
  const working = [
    ...(summary?.wins ?? []).map((text) => ({ text, cited: false })),
    ...(review?.strengths ?? []).map((text) => ({ text, cited: true })),
  ];
  const context = settings.context?.trim();
  const audience = settings.audience?.trim();

  const refresh = (
    <button
      type="button"
      data-component="overview-summary-refresh"
      onClick={() => generate(["summary", "review"], true)}
      disabled={pending || !canSummary}
      title={
        canSummary
          ? canReview
            ? "Regenerate the analytics summary and the design review now"
            : "Regenerate the analytics summary now"
          : "Connect a model first — Settings tab"
      }
      aria-label="Refresh summary"
      className={iconBtn}
    >
      <RefreshIcon spinning={pending} />
    </button>
  );

  return (
    <Section
      title="Summary"
      action={
        <>
          {settings.hasApiKey && (
            <span className="hidden rounded-full bg-[#1a1a1a] px-2 py-0.5 text-[10px] font-medium text-[#888] sm:inline">
              {settings.provider} · {settings.model}
            </span>
          )}
          {refresh}
        </>
      }
      links={[
        { tab: "analytics", label: "Analytics" },
        { tab: "design", label: "Design" },
      ]}
    >
      {/* data-component names feed polishd's own dashboard telemetry; inert for host apps. */}
      <div data-component="overview-summary" className={`${card} overflow-hidden`}>
        <div className="px-4 py-4 sm:px-5 sm:py-5">
          {errors.map((message) => (
            <div
              key={message}
              className="mb-3 rounded-md border border-red-900/50 bg-red-950/30 px-3 py-2 text-[12px] text-red-400"
            >
              {message}
            </div>
          ))}

          {!hasAny ? (
            <Empty
              hasApiKey={settings.hasApiKey}
              pending={pending}
              onGenerate={() => generate(["summary", "review"], false)}
            />
          ) : (
            <>
              {(context || audience) && (
                <p className="mb-4 text-[12px] leading-relaxed text-[#777]">
                  {context}
                  {context && audience && <span className="text-[#444]"> · </span>}
                  {audience && <>For {audience}</>}
                </p>
              )}

              <Half label="Visitors">
                {summary ? (
                  <Narrative>{summary.text}</Narrative>
                ) : (
                  <Missing
                    text={
                      canSummary
                        ? "No analytics summary yet."
                        : "No analytics summary yet — connect a model in Settings."
                    }
                    pending={pending}
                    onGenerate={canSummary ? () => generate(["summary"], false) : null}
                  />
                )}
              </Half>

              <Half label="Design">
                {review ? (
                  <Narrative>
                    <Annotated text={review.text} />
                  </Narrative>
                ) : (
                  <Missing
                    text={
                      scannedPages === 0
                        ? "No design review yet — browse a few pages of the site and the design scan will have something to review."
                        : canReview
                          ? "No design review yet."
                          : "No design review yet — connect a model in Settings."
                    }
                    pending={pending}
                    onGenerate={canReview ? () => generate(["review"], false) : null}
                  />
                )}
              </Half>

              {working.length > 0 && (
                <div className="mt-5">
                  <div className={`${labelCls} mb-2 text-emerald-500`}>Working</div>
                  <ul className="space-y-1.5">
                    {working.map((w, i) => (
                      <li key={i} className="flex gap-2 text-[13px] leading-snug text-[#bbb]">
                        <span className="mt-px shrink-0 text-emerald-500">✓</span>
                        <span>{w.cited ? <Annotated text={w.text} /> : w.text}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#555]">
                <span>
                  <Provenance summary={summary} review={review} />
                </span>
                {stale && (
                  <span className="rounded-full bg-amber-950/50 px-2 py-0.5 text-amber-400">
                    Something&rsquo;s changed since this summary — refresh to update
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </Section>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────────

/** One half of the story: a small-caps eyebrow and whatever stands under it. */
function Half({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 first:mt-0">
      <div className={`${labelCls} mb-1.5`}>{label}</div>
      {children}
    </div>
  );
}

function Narrative({ children }: { children: React.ReactNode }) {
  return <p className="text-[14px] leading-relaxed text-[#e4e4e4]">{children}</p>;
}

/** A half that hasn't been written yet, and the one click that writes it. */
function Missing({
  text,
  pending,
  onGenerate,
}: {
  text: string;
  pending: boolean;
  onGenerate: (() => void) | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-[13px] text-[#777]">
      <span>{text}</span>
      {onGenerate && (
        <button
          type="button"
          data-component="overview-summary-generate-half"
          onClick={onGenerate}
          disabled={pending}
          className={microBtn}
        >
          {pending ? "Thinking…" : "Generate"}
        </button>
      )}
    </div>
  );
}

function Empty({
  hasApiKey,
  pending,
  onGenerate,
}: {
  hasApiKey: boolean;
  pending: boolean;
  onGenerate: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-[13px] leading-relaxed text-[#888]">
        {hasApiKey
          ? "No summary yet — generate the story of how visitors use this site and how its design holds together."
          : "No model connected yet. Add a key in Settings and Polishd will read the numbers and the design back to you in plain English."}
      </p>
      {hasApiKey ? (
        <button
          type="button"
          data-component="overview-summary-generate"
          onClick={onGenerate}
          disabled={pending}
          className={primaryBtn}
        >
          {pending ? "Thinking…" : "Generate summary"}
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

/** When each half was written, and by what — folded into one line when they agree. */
function Provenance({
  summary,
  review,
}: {
  summary: PolishdSummary | null;
  review: PolishdDesignReview | null;
}) {
  const model = (x: PolishdSummary | PolishdDesignReview) => `${x.provider}/${x.model}`;
  if (summary && review) {
    const same = model(summary) === model(review);
    return (
      <>
        Visitors reviewed {relTime(summary.generatedAt)}
        {same ? "" : ` by ${model(summary)}`} · design reviewed {relTime(review.generatedAt)}
        {same ? ` · ${model(summary)}` : ` by ${model(review)}`}
      </>
    );
  }
  const only = summary ?? review;
  if (!only) return null;
  return (
    <>
      Generated {relTime(only.generatedAt)} · {model(only)}
    </>
  );
}
