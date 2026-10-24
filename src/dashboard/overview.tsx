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
 *
 * The prompt asks the agent to end with a verdict block, and "Paste verdicts"
 * reads it back: the findings the agent showed aren't real, or are
 * deliberate, are ignored with its reasons, exactly as if the owner had
 * clicked Ignore on each card. Verdict ids are matched against the prompt as
 * it was last copied, since an ignore or a regenerate since then renumbers it.
 */
import { useCallback, useEffect, useMemo, useState, useTransition, type ReactNode } from "react";

import { recordVerdictsAction } from "../ai/actions";
import type {
  PolishdAISettingsPublic,
  PolishdDesignReview,
  PolishdIgnoredLoss,
  PolishdProjectProfile,
  PolishdSummary,
} from "../ai/types";
import type { DeviceBucket, MetricTrends, OverviewStats } from "../server/queries";
import type { PolishdSnapshot } from "../server/snapshots";
import { TabLink, type PolishdDashboardTab } from "./chrome";
import { copyText } from "./color-chip";
import DesignReviewCard from "./design-review-card";
import { UNREACHABLE } from "./dismissable";
import {
  buildFixPrompt,
  fixableCounts,
  fixPromptFindings,
  type FixPromptFinding,
  type FixPromptInput,
  type FixPromptScope,
} from "./fix-prompt";
import OverviewTiles from "./metric-trends";
import { SnapshotStrip } from "./snapshots";
import SummaryCard, { type LossChange } from "./summary";
import {
  CheckIcon,
  CopyIcon,
  InfoTip,
  border,
  card,
  ghostBtn,
  inputCls,
  labelCls,
  primaryBtn,
} from "./ui";
import { parseVerdicts, planVerdicts, type VerdictKind } from "./verdicts";

type Filed = { url: string; number: number };
type Dismissals = ReadonlyMap<string, PolishdIgnoredLoss>;

/** A set with one key added or removed — state updates stay immutable. */
function toggled(prev: ReadonlySet<string>, key: string, on: boolean): ReadonlySet<string> {
  const next = new Set(prev);
  if (on) next.add(key);
  else next.delete(key);
  return next;
}

/** A map with one key removed. */
function without<V>(prev: ReadonlyMap<string, V>, key: string): ReadonlyMap<string, V> {
  if (!prev.has(key)) return prev;
  const next = new Map(prev);
  next.delete(key);
  return next;
}

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
  /** Whether the design measurements themselves changed since the review; null when unknown. */
  reviewMetricsChanged: boolean | null;
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
  reviewMetricsChanged,
  scannedPages,
  snapshot,
}: OverviewPanelProps) {
  // The cards own what they display; these mirror it for the prompt.
  const [summary, setSummary] = useState(initialSummary);
  const [review, setReview] = useState(initialReview);
  const [summaryIsStale, setSummaryIsStale] = useState(summaryStale);
  const [reviewIsStale, setReviewIsStale] = useState(reviewStale);
  const [metricsChanged, setMetricsChanged] = useState(reviewMetricsChanged);
  const [ignored, setIgnored] = useState<ReadonlySet<string>>(() => new Set());
  const [ignoredDesign, setIgnoredDesign] = useState<ReadonlySet<string>>(() => new Set());
  const [filedLosses, setFiledLosses] = useState<ReadonlyMap<string, Filed>>(() => new Map());
  const [filedDesign, setFiledDesign] = useState<ReadonlyMap<string, Filed>>(() => new Map());
  // Dismissals from a pasted verdict block, handed to the cards to show.
  const [importedLosses, setImportedLosses] = useState<Dismissals>(() => new Map());
  const [importedDesign, setImportedDesign] = useState<Dismissals>(() => new Map());
  /** The findings as the agent saw them: each copied prompt's numbering, by id. */
  const [copied, setCopied] = useState<ReadonlyMap<string, FixPromptFinding>>(() => new Map());
  /** Set when the clipboard refused a copy: the prompt, to copy by hand. */
  const [manual, setManual] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);

  const onSummaryChange = useCallback((next: PolishdSummary) => {
    setSummary(next);
    setSummaryIsStale(false);
  }, []);

  const onReviewChange = useCallback((next: PolishdDesignReview) => {
    setReview(next);
    setReviewIsStale(false);
    setMetricsChanged(false);
  }, []);

  const onLossChange = useCallback((evidence: string, change: LossChange) => {
    if ("filed" in change) {
      setFiledLosses((prev) => new Map(prev).set(evidence, change.filed));
      return;
    }
    setIgnored((prev) => toggled(prev, evidence, change.ignored));
    if (!change.ignored) setImportedLosses((prev) => without(prev, evidence));
  }, []);

  const onIssueChange = useCallback((evidence: string, change: LossChange) => {
    if ("filed" in change) {
      setFiledDesign((prev) => new Map(prev).set(evidence, change.filed));
      return;
    }
    setIgnoredDesign((prev) => toggled(prev, evidence, change.ignored));
    if (!change.ignored) setImportedDesign((prev) => without(prev, evidence));
  }, []);

  const onVerdictsRecorded = useCallback(
    (recorded: { finding: FixPromptFinding; ignored: PolishdIgnoredLoss }[]) => {
      for (const { finding, ignored: entry } of recorded) {
        const add = (prev: Dismissals) => new Map(prev).set(finding.evidence, entry);
        if (finding.source === "design") {
          setIgnoredDesign((prev) => toggled(prev, finding.evidence, true));
          setImportedDesign(add);
        } else {
          setIgnored((prev) => toggled(prev, finding.evidence, true));
          setImportedLosses(add);
        }
      }
    },
    [],
  );

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
      issues: review.issues
        ?.filter((iss) => !ignoredDesign.has(iss.evidence))
        .map((iss) => withFiled(iss, filedDesign.get(iss.evidence))),
    },
    summaryStale: summaryIsStale,
    reviewStale: reviewIsStale,
    reviewMetricsChanged: metricsChanged,
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
        build={() => {
          const built = { ...input, now: Date.now() };
          const text = buildFixPrompt(built, scope);
          // Remember the numbering the agent is about to see, for its verdicts.
          if (text) {
            setCopied((prev) => {
              const next = new Map(prev);
              for (const f of fixPromptFindings(built, scope)) next.set(f.id, f);
              return next;
            });
          }
          return text;
        }}
        onCopied={() => setManual(null)}
        onFailed={setManual}
      />
    );
  };

  return (
    <main className="text-white">
      {/* Header */}
      <div
        className={`mb-8 flex flex-col gap-4 border-b ${border} pb-6 sm:flex-row sm:items-start sm:justify-between sm:gap-3`}
      >
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-white">Overview</h1>
          <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-[#888]">
            Who&apos;s using the site, what the analytics and design reviews found, and the site
            as it last rendered — with a prompt that hands every problem to your coding agent.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            data-component="overview-paste-verdicts"
            onClick={() => setPasting((v) => !v)}
            aria-expanded={pasting}
            title="Paste the verdict block your coding agent ended with — findings it showed aren't real, or are deliberate, stop being reported"
            className={ghostBtn}
          >
            Paste verdicts
          </button>
          {copyButton("all", "Copy fix prompt", true)}
        </div>
      </div>

      {manual !== null && <ManualCopy text={manual} onClose={() => setManual(null)} />}

      {pasting && (
        <VerdictImport
          findings={copied.size > 0 ? [...copied.values()] : fixPromptFindings(input, "all")}
          current={fixPromptFindings(input, "all")}
          fromCopy={copied.size > 0}
          onRecorded={onVerdictsRecorded}
          onClose={() => setPasting(false)}
        />
      )}

      {!overview.ready && (
        <div className="mb-8 rounded-lg border border-amber-900/50 bg-amber-950/30 px-4 py-3 text-[13px] text-amber-400">
          The analytics store isn&apos;t writable in this environment. Run locally or configure a
          database — see the <span className="font-mono text-amber-300">@polishd/next</span>{" "}
          DATABASE.md guide.
        </div>
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
          onSummaryChange={onSummaryChange}
          onLossChange={onLossChange}
          dismissed={importedLosses}
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
          onReviewChange={onReviewChange}
          onIssueChange={onIssueChange}
          dismissed={importedDesign}
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
    <section className="mb-8">
      <div className="mb-3 flex min-h-7 items-center justify-between gap-3">
        <span className={labelCls}>{title}</span>
        <div className="flex items-center gap-3">
          {action}
          <TabLink
            tab={link.tab}
            className="whitespace-nowrap text-[11px] text-[#888] transition-colors hover:text-white"
          >
            {link.label} →
          </TabLink>
        </div>
      </div>
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
        <span className="flex items-center gap-1.5">
          <span className={copied ? (primary ? "text-emerald-700" : "text-emerald-400") : ""}>
            {copied ? <CheckIcon /> : <CopyIcon />}
          </span>
          <span className="grid">
            <span className={`col-start-1 row-start-1 ${copied ? "invisible" : ""}`}>{label}</span>
            <span
              aria-hidden
              className={`col-start-1 row-start-1 ${copied ? "" : "invisible"}`}
            >
              Copied
            </span>
          </span>
          {count > 0 && (
            <span
              aria-hidden
              className={`rounded px-1 text-[10px] font-semibold tabular-nums ${
                primary ? "bg-black/10 text-black/60" : "bg-[#1a1a1a] text-[#888]"
              }`}
            >
              {count}
            </span>
          )}
        </span>
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
    <div className="mb-8 rounded-lg border border-red-900/50 bg-red-950/20 px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-[12px] text-red-400">
          This browser wouldn&apos;t let the dashboard write to the clipboard. The prompt is
          selected below — copy it with ⌘C or Ctrl+C.
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-[12px] text-[#888] transition-colors hover:text-white"
        >
          ✕
        </button>
      </div>
      <textarea
        readOnly
        autoFocus
        value={text}
        onFocus={(e) => e.currentTarget.select()}
        aria-label="Fix prompt"
        className={`${inputCls} h-56 resize-y font-mono text-[11px] leading-relaxed`}
      />
    </div>
  );
}

const VERDICT_LABEL: Record<VerdictKind, string> = {
  fixed: "fixed",
  not_real: "not real",
  deliberate: "deliberate",
};

/**
 * Where the agent's verdict block comes back in. The paste is read as it's
 * typed, and every verdict is shown against the finding it matched before
 * anything is recorded — so a block from an older prompt, whose ids now mean
 * different findings, is caught by eye rather than recorded blind.
 */
function VerdictImport({
  findings,
  current,
  fromCopy,
  onRecorded,
  onClose,
}: {
  /** The findings the verdict ids refer to. */
  findings: FixPromptFinding[];
  /** The findings the cards hold now; a verdict for anything else is skipped. */
  current: FixPromptFinding[];
  /** True when they're the prompt as last copied, not as it would read now. */
  fromCopy: boolean;
  onRecorded: (recorded: { finding: FixPromptFinding; ignored: PolishdIgnoredLoss }[]) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const parsed = useMemo(() => parseVerdicts(text), [text]);
  const plans = useMemo(
    () => planVerdicts(parsed.verdicts, findings, current),
    [parsed, findings, current],
  );
  const toRecord = plans.filter((p) => p.action === "dismiss");

  const record = () =>
    start(async () => {
      setError(null);
      // Only the citation, verdict and reason travel; the server looks the
      // finding up itself and writes the stored reason. A throw (expired
      // token, dropped network) would crash the page from inside a
      // transition, so it's caught and shown here.
      let res: Awaited<ReturnType<typeof recordVerdictsAction>>;
      try {
        res = await recordVerdictsAction(
          toRecord.map((p) => ({
            source: p.finding.source,
            id: p.currentId,
            evidence: p.finding.evidence,
            verdict: p.verdict.verdict as "not_real" | "deliberate",
            reason: p.verdict.reason,
          })),
        );
      } catch {
        setError(UNREACHABLE);
        return;
      }
      if (!res.ok) {
        setError(res.message);
        return;
      }
      onRecorded(
        res.recorded.flatMap((r) => {
          const plan = toRecord.find((p) => p.currentId === r.id);
          return plan ? [{ finding: plan.finding, ignored: r.ignored }] : [];
        }),
      );
      const missed = toRecord.length - res.recorded.length;
      setDone(
        `Ignored ${res.recorded.length} ${res.recorded.length === 1 ? "finding" : "findings"} with the agent's reasons — they're out of the next prompt and won't be reported again.` +
          (missed > 0 ? ` ${missed} weren't saved: no longer in the current review, or the store refused the write.` : ""),
      );
      setText("");
    });

  return (
    <div data-component="overview-verdicts" className={`mb-8 ${card} px-4 py-3`}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-[12px] leading-relaxed text-[#888]">
          Paste the agent&apos;s reply, or just its verdict block. Findings it marked{" "}
          <span className="text-[#bbb]">not real</span> or <span className="text-[#bbb]">deliberate</span>{" "}
          are ignored with its reasons, so the next review doesn&apos;t report them again.
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-[12px] text-[#888] transition-colors hover:text-white"
        >
          ✕
        </button>
      </div>
      <textarea
        autoFocus
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setDone(null);
          setError(null);
        }}
        placeholder={'[{ "id": "A1", "verdict": "deliberate", "reason": "…", "files": [] }]'}
        aria-label="The coding agent's verdicts"
        className={`${inputCls} h-32 resize-y font-mono text-[11px] leading-relaxed`}
      />

      {plans.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {plans.map((p) => (
            <li key={p.verdict.id} className="flex gap-2 text-[12px] leading-snug text-[#bbb]">
              <span className="w-7 shrink-0 font-mono text-[11px] text-[#888]">{p.verdict.id}</span>
              <span className="w-[4.5rem] shrink-0 text-[#888]">{VERDICT_LABEL[p.verdict.verdict]}</span>
              <span className="min-w-0">
                {p.action === "unknown" ? (
                  <span className="text-amber-400">No finding with this id in the prompt — skipped.</span>
                ) : p.action === "gone" ? (
                  <>
                    {p.finding.issue}
                    <span className="block text-[11px] text-amber-400">
                      No longer in the current review (ignored, or regenerated away) — skipped.
                    </span>
                  </>
                ) : (
                  <>
                    {p.finding.issue}
                    <span className="block text-[11px] text-[#666]">
                      {p.action === "dismiss"
                        ? `Will be ignored — “${p.reason}”`
                        : "Nothing to record — the next review shows whether the fix held."}
                    </span>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {parsed.problems.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[11px] text-amber-400">
          {parsed.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          data-component="overview-record-verdicts"
          onClick={record}
          disabled={pending || toRecord.length === 0}
          className={primaryBtn}
        >
          {pending
            ? "Recording…"
            : `Ignore ${toRecord.length} ${toRecord.length === 1 ? "finding" : "findings"}`}
        </button>
        {!fromCopy && plans.length > 0 && (
          <span className="text-[11px] text-[#666]">
            Matched against the findings shown now — no prompt was copied in this visit, so check
            each is the one the agent saw.
          </span>
        )}
        {done && <span className="text-[11px] text-emerald-400">{done}</span>}
        {error && <span className="text-[11px] text-red-400">{error}</span>}
      </div>
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
    <div className={`${card} px-4 py-4`}>
      <div className="text-[28px] font-semibold tabular-nums leading-none text-white">{value}</div>
      <div className={`mt-2 flex items-center ${labelCls}`}>
        {label}
        <InfoTip text={tip} />
      </div>
      <div className="mt-3 h-[18px] truncate text-[11px] leading-[18px] text-[#888]">{note}</div>
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
