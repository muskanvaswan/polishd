"use client";

/**
 * Polishd — the Overview tab (client).
 *
 * The dashboard's front page, laid out as a board. One card: the site as it
 * last rendered, in a bento of its top pages' heroes, beside its brand — the
 * colors and type the pages actually ship — with no headings over either;
 * the pictures and the type carry it. Under it, a second row: the story both
 * reviews tell, written as a single paragraph by the model, with the headline
 * audience numbers beside it. Then the step after reading — a prompt that
 * hands every problem to the coding agent working in the repo, copied by the
 * button in the header.
 *
 * On a phone the board reads the other way up — numbers, story, brand,
 * snapshots — so the quickest read comes first and the pictures, which take
 * the most scrolling, last. The DOM order stays the desktop's; CSS order
 * flips it below `lg`.
 *
 * The problems themselves aren't on this page. The losses and the design
 * issues are actionables, listed on the Actionables tab with the controls
 * that act on them (ignore, file a bug); the prompt still carries all of
 * them, built at the moment of the click from the latest summary and review
 * this page has — a regenerate from the summary card is in the very next copy.
 *
 * The prompt asks the agent to end with a verdict block, and "Paste verdicts"
 * reads it back: the findings the agent showed aren't real, or are
 * deliberate, are ignored with its reasons, exactly as if the owner had
 * clicked Ignore on each card — and they're out of the next prompt copied
 * here. Verdict ids are matched against the prompt as it was last copied,
 * since a regenerate since then renumbers it.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";

import { recordVerdictsAction } from "../ai/actions";
import type {
  PolishdAISettingsPublic,
  PolishdDesignReview,
  PolishdIgnoredLoss,
  PolishdOverview,
  PolishdSummary,
} from "../ai/types";
import type { DeviceBucket, MetricTrends, OverviewStats } from "../server/queries";
import type { PolishdSnapshot } from "../server/snapshots";
import type { BrandKit } from "../shared/brand-kit";
import BrandBoard from "./brand-board";
import { TabLink } from "./chrome";
import { copyText } from "./color-chip";
import { UNREACHABLE } from "./dismissable";
import {
  buildFixPrompt,
  findingKey,
  fixableCounts,
  fixPromptFindings,
  type FixPromptFinding,
  type FixPromptInput,
} from "./fix-prompt";
import OverviewTiles from "./metric-trends";
import OverviewSummary from "./overview-summary";
import SnapshotGallery from "./snapshot-gallery";
import {
  Callout,
  CheckIcon,
  ChevronDownIcon,
  Code,
  CopyIcon,
  InfoTip,
  PageHeader,
  XIcon,
  card,
  ghostBtn,
  inputCls,
  labelCls,
  primaryBtn,
  textLink,
} from "./ui";
import { parseVerdicts, planVerdicts, type VerdictKind } from "./verdicts";

/** A set with one key added — state updates stay immutable. */
function added(prev: ReadonlySet<string>, key: string): ReadonlySet<string> {
  if (prev.has(key)) return prev;
  const next = new Set(prev);
  next.add(key);
  return next;
}

export interface OverviewPanelProps {
  overview: OverviewStats;
  trends: MetricTrends;
  devices: DeviceBucket[];
  settings: PolishdAISettingsPublic;
  /** The model's one-paragraph story of both reviews, or null before the first. */
  story: PolishdOverview | null;
  /** True when a review has changed since the story was written. */
  storyStale: boolean;
  summary: PolishdSummary | null;
  summaryStale: boolean;
  review: PolishdDesignReview | null;
  reviewStale: boolean;
  /** Whether the design measurements themselves changed since the review; null when unknown. */
  reviewMetricsChanged: boolean | null;
  /** Pages with a design scan — the review needs at least one. */
  scannedPages: number;
  /** The newest snapshot with any pictures in it, or null. */
  snapshot: PolishdSnapshot | null;
  /** The brand kit curated from the design scans; null before the first scan. */
  kit: BrandKit | null;
  /** Routes by traffic, most visited first — the order the gallery picks pages in. */
  topPages: string[];
}

export default function OverviewPanel({
  overview,
  trends,
  devices,
  settings,
  story,
  storyStale,
  summary: initialSummary,
  summaryStale,
  review: initialReview,
  reviewStale,
  reviewMetricsChanged,
  scannedPages,
  snapshot,
  kit,
  topPages,
}: OverviewPanelProps) {
  // The summary card owns what it displays; these mirror it for the prompt.
  const [summary, setSummary] = useState(initialSummary);
  const [review, setReview] = useState(initialReview);
  const [summaryIsStale, setSummaryIsStale] = useState(summaryStale);
  const [reviewIsStale, setReviewIsStale] = useState(reviewStale);
  const [metricsChanged, setMetricsChanged] = useState(reviewMetricsChanged);
  // Findings a pasted verdict ignored this visit: out of the next prompt.
  const [ignored, setIgnored] = useState<ReadonlySet<string>>(() => new Set());
  const [ignoredDesign, setIgnoredDesign] = useState<ReadonlySet<string>>(() => new Set());
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

  const onVerdictsRecorded = useCallback(
    (recorded: { finding: FixPromptFinding; ignored: PolishdIgnoredLoss }[]) => {
      for (const { finding } of recorded) {
        // Design issues are tracked by findingKey, not evidence: two can cite the same.
        if (finding.source === "design") setIgnoredDesign((prev) => added(prev, findingKey(finding)));
        else setIgnored((prev) => added(prev, finding.evidence));
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
      losses: summary.losses?.filter((l) => !ignored.has(l.evidence)),
    },
    review: review && {
      ...review,
      issues: review.issues?.filter((iss) => !ignoredDesign.has(findingKey(iss))),
    },
    summaryStale: summaryIsStale,
    reviewStale: reviewIsStale,
    reviewMetricsChanged: metricsChanged,
  };
  const counts = fixableCounts(input);
  // The prompt hands over a model's findings and the verdicts answer them, so
  // the whole loop waits for a connected model.
  const connected = settings.hasApiKey;

  return (
    <main className="text-fg">
      <PageHeader
        title="Overview"
        description={
          <>
            The site as it last rendered, its brand, who&apos;s using it and what both reviews
            make of it — with a prompt that hands every problem to your coding agent.
          </>
        }
        actions={
          <FixLoopMenu
            copy={
              <CopyPromptButton
                count={counts.analytics + counts.design}
                disabled={!connected}
                emptyTitle={
                  !connected
                    ? NOT_CONNECTED
                    : summary === null && review === null
                      ? "Generate the summary first"
                      : "Neither review found anything to fix"
                }
                build={() => {
                  const built = { ...input, now: Date.now() };
                  const text = buildFixPrompt(built, "all");
                  // Remember the numbering the agent is about to see, for its verdicts.
                  if (text) {
                    setCopied((prev) => {
                      const next = new Map(prev);
                      for (const f of fixPromptFindings(built, "all")) next.set(f.id, f);
                      return next;
                    });
                  }
                  return text;
                }}
                onCopied={() => setManual(null)}
                onFailed={setManual}
              />
            }
            connected={connected}
            onPaste={() => setPasting(true)}
          />
        }
      />

      {manual !== null && <ManualCopy text={manual} onClose={() => setManual(null)} />}

      {pasting && connected && (
        <VerdictImport
          findings={copied.size > 0 ? [...copied.values()] : fixPromptFindings(input, "all")}
          current={fixPromptFindings(input, "all")}
          fromCopy={copied.size > 0}
          onRecorded={onVerdictsRecorded}
          onClose={() => setPasting(false)}
        />
      )}

      {!overview.ready && (
        <Callout tone="warn" className="mb-8">
          The analytics store isn&apos;t writable in this environment. Run locally or configure a
          database — see the <Code>@polishd/next</Code> DATABASE.md guide.
        </Callout>
      )}

      <div className="flex flex-col gap-6">
        {/* One card: the site as it renders, beside the system it renders with.
            On a phone the brand comes first and the pictures last. */}
        <div className={`order-2 grid overflow-hidden lg:order-1 lg:grid-cols-2 ${card}`}>
        <div className="order-2 flex flex-col border-t border-line p-4 sm:p-5 lg:order-1 lg:border-t-0">
          {snapshot ? (
            <SnapshotGallery snapshot={snapshot} topPages={topPages} />
          ) : (
            <Callout tone="neutral">
              No snapshots yet. Capture one on the{" "}
              <TabLink tab="design" className={textLink}>
                Design tab
              </TabLink>{" "}
              to see every page of the site as it renders right now.
            </Callout>
          )}
        </div>
        <div className="order-1 p-4 sm:p-5 lg:order-2 lg:border-l lg:border-line">
          {kit ? (
            <BrandBoard kit={kit} />
          ) : (
            <Callout tone="neutral">
              No design scans yet. Each page measures its own colors and type once per visitor
              session — browse a few pages of the site and the brand board appears here.
            </Callout>
          )}
        </div>
      </div>

      {/* The story, with the numbers it's told about in a narrow column beside
          it. Neither side is stretched to the other: a paragraph padded out to
          three tiles' height, or tiles padded out to a paragraph's, reads as a
          mistake. On a phone the numbers lead. */}
      <div className="order-1 grid gap-3 lg:order-2 lg:grid-cols-[minmax(0,1fr)_11rem] lg:items-start">
        <div className="order-2 min-w-0 lg:order-1">
          <OverviewSummary
            initialStory={story}
            initialStale={storyStale}
            summary={summary}
            review={review}
            settings={settings}
            scannedPages={scannedPages}
            onSummaryChange={onSummaryChange}
            onReviewChange={onReviewChange}
          />
        </div>
        {/* One row of three on small screens; one column beside the paragraph from lg. */}
        <div className="order-1 grid grid-cols-3 gap-3 lg:order-2 lg:grid-cols-1">
          <OverviewTiles
            overview={overview}
            trends={trends}
            metrics={["sessions", "pageViews"]}
            gridClassName="contents"
            dot={false}
          />
          <MobileTile devices={devices} />
        </div>
      </div>
      </div>
    </main>
  );
}

/** Why the fix loop is off altogether. */
const NOT_CONNECTED =
  "Connect a model in Settings first — its reviews are what this hands to your coding agent";

// ── Pieces ───────────────────────────────────────────────────────────────────

/**
 * The Overview's one action, as a split button: copy the fix prompt, with the
 * rest of the loop behind the chevron. For now that's reading the agent's
 * verdicts back; running the fix itself is meant to join it. All of it hands
 * over a model's findings, so it's off until a model is connected.
 */
function FixLoopMenu({
  copy,
  connected,
  onPaste,
}: {
  /** The copy button, its right edge squared to meet the chevron. */
  copy: ReactNode;
  connected: boolean;
  onPaste: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);

  // Focus moves into the menu; Escape or a click outside closes it.
  useEffect(() => {
    if (!open) return;
    firstItemRef.current?.focus();
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative inline-flex">
      {copy}
      <button
        ref={triggerRef}
        type="button"
        data-component="overview-fix-menu"
        onClick={() => setOpen((o) => !o)}
        disabled={!connected}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More of the fix loop"
        title={connected ? "More of the fix loop" : NOT_CONNECTED}
        className={`${primaryBtn} rounded-l-none border-l border-accent-fg/15 px-2`}
      >
        <ChevronDownIcon size={13} />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Fix loop"
          className="absolute right-0 top-full z-30 mt-1.5 w-64 rounded-lg border border-line-strong bg-overlay p-1 shadow-pop"
        >
          <button
            ref={firstItemRef}
            type="button"
            role="menuitem"
            data-component="overview-paste-verdicts"
            onClick={() => {
              setOpen(false);
              onPaste();
            }}
            className="flex w-full flex-col items-start gap-0.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-raised focus-visible:bg-raised"
          >
            <span className="text-[13px] font-medium text-fg">Paste verdicts</span>
            <span className="text-[12px] leading-snug text-fg-3">
              Read back the agent&apos;s verdicts, so findings it ruled out stop being reported.
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Copies the fix prompt. The label and "Copied" share a grid cell, so the
 * button holds its width when the confirmation swaps in; its right edge is
 * squared to meet the menu's chevron.
 */
function CopyPromptButton({
  count,
  disabled = false,
  emptyTitle: disabledTitle,
  build,
  onCopied,
  onFailed,
}: {
  /** Problems the prompt carries; 0 disables the button. */
  count: number;
  /** Off whatever the count — no model connected. `emptyTitle` says why. */
  disabled?: boolean;
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
  const off = disabled || count === 0;
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
        data-component="overview-copy-prompt"
        onClick={copy}
        disabled={off}
        title={off ? disabledTitle : `Copy a prompt that hands ${problems} to a coding agent`}
        aria-label={off ? "Copy fix prompt" : `Copy fix prompt (${problems})`}
        className={`${primaryBtn} rounded-r-none`}
      >
        <span className={copied ? "text-accent-fg" : ""}>
          {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
        </span>
        {/* Label and "Copied" share one cell, so the button holds its width. */}
        <span className="inline-grid">
          <span className={`col-start-1 row-start-1 ${copied ? "invisible" : ""}`}>Copy fix prompt</span>
          <span aria-hidden className={`col-start-1 row-start-1 ${copied ? "" : "invisible"}`}>
            Copied
          </span>
        </span>
        {!off && (
          <span
            aria-hidden
            className="ml-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] bg-accent-fg/12 px-1 text-[11px] font-semibold tabular-nums text-accent-fg/75"
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
  /** The findings the page holds now; a verdict for anything else is skipped. */
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
    <div data-component="overview-verdicts" className={`mb-8 ${card} p-4`}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <p className="text-[13px] leading-relaxed text-fg-3">
          Paste the agent&apos;s reply, or just its verdict block. Findings it marked{" "}
          <span className="text-fg-2">not real</span> or <span className="text-fg-2">deliberate</span>{" "}
          are ignored with its reasons, so the next review doesn&apos;t report them again.
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
        autoFocus
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setDone(null);
          setError(null);
        }}
        placeholder={'[{ "id": "A1", "verdict": "deliberate", "reason": "…", "files": [] }]'}
        aria-label="The coding agent's verdicts"
        className={`${inputCls} h-32 resize-y font-mono text-[12px] leading-relaxed sm:text-[12px]`}
      />

      {plans.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {plans.map((p) => (
            <li key={p.verdict.id} className="flex gap-2 text-[12.5px] leading-snug text-fg-2">
              <span className="w-7 shrink-0 font-mono text-[12px] text-fg-3">{p.verdict.id}</span>
              <span className="w-[4.5rem] shrink-0 text-fg-3">{VERDICT_LABEL[p.verdict.verdict]}</span>
              <span className="min-w-0">
                {p.action === "unknown" ? (
                  <span className="text-warn">No finding with this id in the prompt — skipped.</span>
                ) : p.action === "gone" ? (
                  <>
                    {p.finding.issue}
                    <span className="mt-0.5 block text-[12px] text-warn">
                      No longer in the current review (ignored, or regenerated away) — skipped.
                    </span>
                  </>
                ) : (
                  <>
                    {p.finding.issue}
                    <span className="mt-0.5 block text-[12px] text-fg-3">
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
        <ul className="mt-2 space-y-0.5 text-[12px] text-warn">
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
          <span className="text-[12px] text-fg-3">
            Matched against the findings as they stand now — no prompt was copied in this visit, so
            check each is the one the agent saw.
          </span>
        )}
        {done && <span className="text-[12px] text-ok">{done}</span>}
        {error && <span className="text-[12px] text-bad">{error}</span>}
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
    <div className={`${card} px-4 pb-3 pt-4`}>
      {/* The label wraps rather than truncates: three tiles share a phone's width. */}
      <div className={`flex items-center gap-1.5 ${labelCls}`}>
        <span className="min-w-0 leading-tight">{label}</span>
        <InfoTip text={tip} />
      </div>
      <div className="mt-2 text-[26px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-fg">
        {value}
      </div>
      <div className="mt-3 flex min-h-7 items-end pb-0.5 text-[12px] leading-snug text-fg-3">{note}</div>
    </div>
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
