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
import { useState, useTransition, type ReactNode } from "react";

import { generateDesignReviewAction, generateSummaryAction } from "../ai/actions";
import type { PolishdAISettingsPublic, PolishdDesignReview, PolishdSummary } from "../ai/types";
import { TabLink } from "./chrome";
import { Annotated } from "./design-tokens";
import { UNREACHABLE } from "./dismissable";
import Section from "./overview-section";
import {
  Badge,
  Callout,
  RefreshIcon,
  SparkIcon,
  card,
  eyebrowCls,
  iconBtn,
  microBtn,
  primaryBtn,
  relTime,
} from "./ui";

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

  /**
   * Run the halves asked for; each reports its own failure. An action that
   * throws (an expired dashboard session, a function timeout) is caught here:
   * uncaught inside a transition it would take the whole tab down.
   */
  const generate = (halves: Half[], force: boolean) => {
    setErrors([]);
    startGenerate(async () => {
      const jobs: Promise<string | null>[] = [];
      if (halves.includes("summary") && canSummary) {
        jobs.push(
          generateSummaryAction(force)
            .then((res) => {
              if (!res.ok) return `Analytics: ${res.message}`;
              setSummary(res.summary);
              setSummaryStale(false);
              onSummaryChange?.(res.summary);
              return null;
            })
            .catch(() => `Analytics: ${UNREACHABLE}`),
        );
      }
      if (halves.includes("review") && canReview) {
        jobs.push(
          generateDesignReviewAction(force)
            .then((res) => {
              if (!res.ok) return `Design: ${res.message}`;
              setReview(res.review);
              setReviewStale(false);
              onReviewChange?.(res.review);
              return null;
            })
            .catch(() => `Design: ${UNREACHABLE}`),
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

  return (
    <Section
      title="Summary"
      action={
        <>
          {settings.hasApiKey && (
            <span className="hidden min-w-0 sm:flex">
              <Badge mono className="truncate">
                {settings.provider} · {settings.model}
              </Badge>
            </span>
          )}
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
        </>
      }
      links={[
        { tab: "analytics", label: "Analytics" },
        { tab: "design", label: "Design" },
      ]}
    >
      {/* data-component names feed polishd's own dashboard telemetry; inert for host apps. */}
      <div data-component="overview-summary" className={`${card} overflow-hidden`}>
        <div className="px-4 py-5 sm:px-5">
          {errors.map((message) => (
            <Callout key={message} tone="bad" className="mb-4">
              {message}
            </Callout>
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
                <p className="mb-5 max-w-[72ch] text-[12.5px] leading-relaxed text-fg-3">
                  {context}
                  {context && audience && <span className="text-fg-4"> · </span>}
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
                <div className="mt-6">
                  <div className={`${eyebrowCls} mb-2.5 !text-ok`}>Working</div>
                  <ul className="space-y-2">
                    {working.map((w, i) => (
                      <li key={i} className="flex gap-2.5 text-[13px] leading-snug text-fg-2">
                        <span className="mt-px shrink-0 text-ok">✓</span>
                        <span>{w.cited ? <Annotated text={w.text} /> : w.text}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-fg-3">
                <span>
                  <Provenance summary={summary} review={review} />
                </span>
                {stale && <Badge tone="warn">Something&rsquo;s changed since this summary — refresh to update</Badge>}
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
function Half({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-5 first:mt-0">
      <div className={`${eyebrowCls} mb-2 flex items-center gap-1.5`}>
        <span className="text-accent">
          <SparkIcon size={12} />
        </span>
        {label}
      </div>
      {children}
    </div>
  );
}

function Narrative({ children }: { children: ReactNode }) {
  return <p className="max-w-[72ch] text-[15px] leading-[1.7] text-fg">{children}</p>;
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
    <div className="flex flex-wrap items-center gap-2.5 text-[13px] leading-relaxed text-fg-3">
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
    <div className="flex flex-wrap items-center justify-between gap-4">
      <p className="max-w-2xl text-[13px] leading-relaxed text-fg-2">
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
