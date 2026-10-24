"use client";

/**
 * Polishd — the Overview tab (client).
 *
 * The dashboard's front page: how many people use the site, what the
 * analytics summary and the design review found, and the site as it last
 * rendered — then the step after reading, a prompt that hands every problem
 * to the coding agent working in the repo. One button copies all of it; each
 * review's own button copies just its half.
 *
 * The review cards are the very components the Analytics and Design tabs
 * render, so everything they do works here too: regenerate, ignore a loss,
 * file a bug. The panel listens to them and mirrors what they show, and the
 * prompt is built from that mirror at the moment of the click — an ignored
 * loss is already gone from it, a regenerated review already in it, a bug
 * filed a second ago already cited.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";

import type {
  PolishdAISettingsPublic,
  PolishdDesignReview,
  PolishdProjectProfile,
  PolishdSummary,
} from "../ai/types";
import type { DeviceBucket, MetricTrends, OverviewStats } from "../server/queries";
import type { PolishdSnapshot } from "../server/snapshots";
import { TabLink, type PolishdDashboardTab } from "./chrome";
import { copyText } from "./color-chip";
import DesignReviewCard from "./design-review-card";
import {
  buildFixPrompt,
  fixableCounts,
  type FixPromptInput,
  type FixPromptScope,
} from "./fix-prompt";
import OverviewTiles from "./metric-trends";
import { SnapshotStrip } from "./snapshots";
import SummaryCard, { type LossChange } from "./summary";
import {
  ArrowRightIcon,
  Callout,
  CheckIcon,
  Code,
  CopyIcon,
  InfoTip,
  PageHeader,
  SectionHeader,
  XIcon,
  card,
  ghostBtn,
  inputCls,
  labelCls,
  primaryBtn,
} from "./ui";

type Filed = { url: string; number: number };

export interface OverviewPanelProps {
  overview: OverviewStats;
  trends: MetricTrends;
  devices: DeviceBucket[];
  settings: PolishdAISettingsPublic;
  summary: PolishdSummary | null;
  summaryStale: boolean;
  profile: PolishdProjectProfile | null;
  /** Component identifiers in the analytics that the profile doesn't cover. */
  gaps: string[];
  /** Whether the app's source tree is on disk here. */
  sourceAvailable: boolean;
  review: PolishdDesignReview | null;
  reviewStale: boolean;
  /** Pages with a design scan — the review card needs at least one. */
  scannedPages: number;
  /** The newest snapshot with any pictures in it, or null. */
  snapshot: PolishdSnapshot | null;
}

export default function OverviewPanel({
  overview,
  trends,
  devices,
  settings,
  summary: initialSummary,
  summaryStale,
  profile,
  gaps,
  sourceAvailable,
  review: initialReview,
  reviewStale,
  scannedPages,
  snapshot,
}: OverviewPanelProps) {
  // The cards own what they display; these mirror it for the prompt.
  const [summary, setSummary] = useState(initialSummary);
  const [review, setReview] = useState(initialReview);
  const [ignored, setIgnored] = useState<ReadonlySet<string>>(() => new Set());
  const [filedLosses, setFiledLosses] = useState<ReadonlyMap<string, Filed>>(() => new Map());
  const [filedDesign, setFiledDesign] = useState<ReadonlyMap<string, Filed>>(() => new Map());
  /** Set when the clipboard refused a copy: the prompt, to copy by hand. */
  const [manual, setManual] = useState<string | null>(null);

  const onLossChange = useCallback((evidence: string, change: LossChange) => {
    if ("filed" in change) {
      setFiledLosses((prev) => new Map(prev).set(evidence, change.filed));
      return;
    }
    setIgnored((prev) => {
      const next = new Set(prev);
      if (change.ignored) next.add(evidence);
      else next.delete(evidence);
      return next;
    });
  }, []);

  const onIssueFiled = useCallback((evidence: string, filed: Filed) => {
    setFiledDesign((prev) => new Map(prev).set(evidence, filed));
  }, []);

  const input: FixPromptInput = {
    context: settings.context,
    audience: settings.audience,
    traffic: overview.ready
      ? {
          sessions: overview.sessions,
          pageViews: overview.pageViews,
          rageClicks: overview.rageClicks,
          deadClicks: overview.deadClicks,
          jsErrors: overview.jsErrors,
          devices: devices.map((d) => ({ category: d.category, pct: d.pct })),
        }
      : null,
    summary: summary && {
      ...summary,
      losses: summary.losses
        ?.filter((l) => !ignored.has(l.evidence))
        .map((l) => withFiled(l, filedLosses.get(l.evidence))),
    },
    review: review && {
      ...review,
      issues: review.issues?.map((iss) => withFiled(iss, filedDesign.get(iss.evidence))),
    },
  };
  const counts = fixableCounts(input);
  const githubConnected = settings.hasGithubToken && !!settings.githubRepo;

  const copyButton = (scope: FixPromptScope, label: string, primary = false) => {
    const count =
      scope === "all" ? counts.analytics + counts.design : counts[scope];
    return (
      <CopyPromptButton
        label={label}
        count={count}
        primary={primary}
        component={scope === "all" ? "overview-copy-prompt" : `overview-copy-prompt-${scope}`}
        emptyTitle={emptyTitle(scope, summary !== null, review !== null)}
        build={() => buildFixPrompt(input, scope)}
        onCopied={() => setManual(null)}
        onFailed={setManual}
      />
    );
  };

  return (
    <main className="text-fg">
      <PageHeader
        title="Overview"
        description={
          <>
            Who&apos;s using the site, what the analytics and design reviews found, and the site
            as it last rendered — with a prompt that hands every problem to your coding agent.
          </>
        }
        actions={copyButton("all", "Copy fix prompt", true)}
      />

      {manual !== null && <ManualCopy text={manual} onClose={() => setManual(null)} />}

      {!overview.ready && (
        <Callout tone="warn" className="mb-8">
          The analytics store isn&apos;t writable in this environment. Run locally or configure a
          database — see the <Code>@polishd/next</Code> DATABASE.md guide.
        </Callout>
      )}

      <Section title="Visitors" link={{ tab: "analytics", label: "All metrics" }}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <OverviewTiles
            overview={overview}
            trends={trends}
            metrics={["sessions", "pageViews"]}
            gridClassName="contents"
          />
          <DepthTile overview={overview} />
          <MobileTile devices={devices} />
        </div>
      </Section>

      <Section
        title="Analytics review"
        action={copyButton("analytics", "Copy prompt")}
        link={{ tab: "analytics", label: "Analytics" }}
      >
        <SummaryCard
          initialSummary={initialSummary}
          initialSettings={settings}
          initialStale={summaryStale}
          initialProfile={profile}
          initialGaps={gaps}
          sourceAvailable={sourceAvailable}
          onSummaryChange={setSummary}
          onLossChange={onLossChange}
        />
      </Section>

      <Section
        title="Design review"
        action={copyButton("design", "Copy prompt")}
        link={{ tab: "design", label: "Design" }}
      >
        <DesignReviewCard
          initialReview={initialReview}
          initialStale={reviewStale}
          hasApiKey={settings.hasApiKey}
          provider={settings.provider}
          model={settings.model}
          scannedPages={scannedPages}
          githubConnected={githubConnected}
          onReviewChange={setReview}
          onIssueFiled={onIssueFiled}
        />
      </Section>

      {snapshot && (
        <Section title="Site snapshots" link={{ tab: "design", label: "All snapshots" }}>
          <SnapshotStrip snapshot={snapshot} />
        </Section>
      )}
    </main>
  );
}

/** A finding with the issue filed for it this session, if one was. */
function withFiled<T extends { issueUrl?: string; issueNumber?: number }>(
  item: T,
  filed: Filed | undefined,
): T {
  return filed ? { ...item, issueUrl: filed.url, issueNumber: filed.number } : item;
}

/** Why a copy button is off — what's missing before it has anything to copy. */
function emptyTitle(scope: FixPromptScope, hasSummary: boolean, hasReview: boolean): string {
  if (scope === "analytics") {
    return hasSummary
      ? "The analytics summary found nothing to fix"
      : "Generate the analytics summary first";
  }
  if (scope === "design") {
    return hasReview ? "The design review found nothing to fix" : "Generate the design review first";
  }
  if (!hasSummary && !hasReview) return "Generate the analytics summary and design review first";
  return "Neither review found anything to fix";
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function Section({
  title,
  action,
  link,
  children,
}: {
  title: string;
  action?: ReactNode;
  link: { tab: PolishdDashboardTab; label: string };
  children: ReactNode;
}) {
  return (
    <section className="mb-10">
      <SectionHeader
        title={title}
        actions={
          <>
            {action}
            <TabLink
              tab={link.tab}
              className="group inline-flex items-center gap-1 whitespace-nowrap text-[12px] font-medium text-fg-3 transition-colors hover:text-fg"
            >
              {link.label}
              <span className="transition-transform group-hover:translate-x-0.5">
                <ArrowRightIcon />
              </span>
            </TabLink>
          </>
        }
      />
      {children}
    </section>
  );
}

/**
 * Copies one scope's prompt. The label and "Copied" share a grid cell, so
 * the button holds its width when the confirmation swaps in.
 */
function CopyPromptButton({
  label,
  count,
  primary,
  component,
  emptyTitle: disabledTitle,
  build,
  onCopied,
  onFailed,
}: {
  label: string;
  /** Problems the prompt carries; 0 disables the button. */
  count: number;
  primary: boolean;
  /** `data-component` name for the dashboard's own telemetry. */
  component: string;
  emptyTitle: string;
  build: () => string | null;
  onCopied: () => void;
  onFailed: (text: string) => void;
}) {
  // When the last copy landed, so a second click restarts the confirmation.
  const [copiedAt, setCopiedAt] = useState(0);
  useEffect(() => {
    if (!copiedAt) return;
    const t = setTimeout(() => setCopiedAt(0), 1800);
    return () => clearTimeout(t);
  }, [copiedAt]);

  const copied = copiedAt > 0;
  const problems = `${count} ${count === 1 ? "problem" : "problems"}`;
  const copy = () => {
    const text = build();
    if (!text) return;
    void copyText(text).then((ok) => {
      if (ok) {
        setCopiedAt(Date.now());
        onCopied();
      } else onFailed(text);
    });
  };

  return (
    <>
      <button
        type="button"
        data-component={component}
        onClick={copy}
        disabled={count === 0}
        title={count === 0 ? disabledTitle : `Copy a prompt that hands ${problems} to a coding agent`}
        aria-label={count === 0 ? label : `${label} (${problems})`}
        className={primary ? primaryBtn : ghostBtn}
      >
        <span className={copied ? (primary ? "text-accent-fg" : "text-ok") : ""}>
          {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
        </span>
        {/* Label and "Copied" share one cell, so the button holds its width. */}
        <span className="inline-grid">
          <span className={`col-start-1 row-start-1 ${copied ? "invisible" : ""}`}>{label}</span>
          <span aria-hidden className={`col-start-1 row-start-1 ${copied ? "" : "invisible"}`}>
            Copied
          </span>
        </span>
        {count > 0 && (
          <span
            aria-hidden
            className={`ml-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] px-1 text-[11px] font-semibold tabular-nums ${
              primary ? "bg-accent-fg/12 text-accent-fg/75" : "bg-overlay text-fg-3"
            }`}
          >
            {count}
          </span>
        )}
      </button>
      <span role="status" className="sr-only">
        {copied ? "Prompt copied to the clipboard" : ""}
      </span>
    </>
  );
}

/**
 * Shown when the browser refused the clipboard — a locked-down profile, or a
 * permission prompt dismissed. The prompt is right there, selected, to copy
 * by hand.
 */
function ManualCopy({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <div className="mb-8 rounded-xl border border-bad/25 bg-bad/[0.06] p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <p className="text-[13px] leading-relaxed text-bad">
          This browser wouldn&apos;t let the dashboard write to the clipboard. The prompt is
          selected below — copy it with ⌘C or Ctrl+C.
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-m-1 rounded-md p-1 text-fg-3 transition-colors hover:text-fg"
        >
          <XIcon size={15} />
        </button>
      </div>
      <textarea
        readOnly
        autoFocus
        value={text}
        onFocus={(e) => e.currentTarget.select()}
        aria-label="Fix prompt"
        className={`${inputCls} h-56 resize-y font-mono text-[12px] leading-relaxed sm:text-[12px]`}
      />
    </div>
  );
}

/** Same frame as the clickable stat tiles beside it, for a number with no chart. */
function PlainTile({
  value,
  label,
  tip,
  note,
}: {
  value: string;
  label: string;
  tip: string;
  /** One quiet line where the stat tiles draw their sparkline. */
  note?: string;
}) {
  return (
    <div className={`${card} px-4 pb-3 pt-4`}>
      <div className={`flex items-center gap-1.5 ${labelCls}`}>
        <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-fg-4" />
        <span className="truncate">{label}</span>
        <InfoTip text={tip} />
      </div>
      <div className="mt-2 text-[26px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-fg">
        {value}
      </div>
      <div className="mt-3 flex min-h-7 items-end pb-0.5 text-[12px] leading-snug text-fg-3">{note}</div>
    </div>
  );
}

function DepthTile({ overview }: { overview: OverviewStats }) {
  const depth = overview.sessions > 0 ? overview.pageViews / overview.sessions : null;
  return (
    <PlainTile
      value={depth === null ? "—" : depth.toFixed(1)}
      label="Views / session"
      tip="Page views divided by sessions, all time — how far the average visit goes before it ends."
    />
  );
}

function MobileTile({ devices }: { devices: DeviceBucket[] }) {
  const mobile = devices.find((d) => d.category === "mobile");
  const others = devices
    .filter((d) => d.category !== "mobile" && d.pct > 0)
    .map((d) => `${d.pct}% ${d.category}`)
    .join(" · ");
  return (
    <PlainTile
      value={devices.length === 0 ? "—" : `${mobile?.pct ?? 0}%`}
      label="On mobile"
      tip="Share of sessions on a phone-sized viewport (under 640px), from one viewport sample per session. The rest of the split is beneath the number."
      note={devices.length === 0 ? "No viewport data yet" : others}
    />
  );
}
