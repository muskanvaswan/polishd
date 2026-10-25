"use client";

/**
 * Polishd — the Overview tab (client).
 *
 * The dashboard's front page, laid out as a board: the site as it last
 * rendered, in a gallery of its snapshots; its brand, the colors and
 * typefaces the pages actually ship; who's using it, every headline number;
 * and the story both reviews tell, as one summary. Then the step after
 * reading — a prompt that hands every problem to the coding agent working in
 * the repo, copied by the button in the header.
 *
 * The problems themselves aren't on this page. The losses and the design
 * issues live on the Analytics and Design tabs with the controls that act on
 * them (ignore, file a bug); the prompt still carries all of them, built at
 * the moment of the click from the latest summary and review this page has —
 * a regenerate from the summary card is in the very next copy.
 */
import { useEffect, useState } from "react";

import type {
  PolishdAISettingsPublic,
  PolishdDesignReview,
  PolishdSummary,
} from "../ai/types";
import type { DeviceBucket, MetricTrends, OverviewStats } from "../server/queries";
import type { PolishdSnapshot } from "../server/snapshots";
import type { BrandKit } from "../shared/brand-kit";
import BrandBoard from "./brand-board";
import BrandKitButton from "./brand-kit-button";
import { TabLink } from "./chrome";
import { copyText } from "./color-chip";
import { buildFixPrompt, fixableCounts, type FixPromptInput } from "./fix-prompt";
import OverviewTiles from "./metric-trends";
import Section from "./overview-section";
import OverviewSummary from "./overview-summary";
import SnapshotGallery from "./snapshot-gallery";
import {
  CheckIcon,
  CopyIcon,
  InfoTip,
  border,
  card,
  inputCls,
  labelCls,
  primaryBtn,
} from "./ui";

export interface OverviewPanelProps {
  overview: OverviewStats;
  trends: MetricTrends;
  devices: DeviceBucket[];
  settings: PolishdAISettingsPublic;
  summary: PolishdSummary | null;
  summaryStale: boolean;
  review: PolishdDesignReview | null;
  reviewStale: boolean;
  /** Pages with a design scan — the review needs at least one. */
  scannedPages: number;
  /** The newest snapshot with any pictures in it, or null. */
  snapshot: PolishdSnapshot | null;
  /** The brand kit curated from the design scans; null before the first scan. */
  kit: BrandKit | null;
}

export default function OverviewPanel({
  overview,
  trends,
  devices,
  settings,
  summary: initialSummary,
  summaryStale,
  review: initialReview,
  reviewStale,
  scannedPages,
  snapshot,
  kit,
}: OverviewPanelProps) {
  // The summary card owns what it displays; these mirror it for the prompt.
  const [summary, setSummary] = useState(initialSummary);
  const [review, setReview] = useState(initialReview);
  /** Set when the clipboard refused a copy: the prompt, to copy by hand. */
  const [manual, setManual] = useState<string | null>(null);

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
    summary,
    review,
  };
  const counts = fixableCounts(input);

  return (
    <main className="text-white">
      {/* Header */}
      <div
        className={`mb-8 flex flex-col gap-4 border-b ${border} pb-6 sm:flex-row sm:items-start sm:justify-between sm:gap-3`}
      >
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-white">Overview</h1>
          <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-[#666]">
            The site as it last rendered, its brand, who&apos;s using it and what both reviews
            make of it — with a prompt that hands every problem to your coding agent.
          </p>
        </div>
        <div className="shrink-0">
          <CopyPromptButton
            count={counts.analytics + counts.design}
            emptyTitle={
              summary === null && review === null
                ? "Generate the summary first"
                : "Neither review found anything to fix"
            }
            build={() => buildFixPrompt(input, "all")}
            onCopied={() => setManual(null)}
            onFailed={setManual}
          />
        </div>
      </div>

      {manual !== null && <ManualCopy text={manual} onClose={() => setManual(null)} />}

      {!overview.ready && (
        <div className="mb-8 rounded-lg border border-amber-900/50 bg-amber-950/30 px-4 py-3 text-[13px] text-amber-400">
          The analytics store isn&apos;t writable in this environment. Run locally or configure a
          database — see the <span className="font-mono text-amber-300">@polishd/next</span>{" "}
          DATABASE.md guide.
        </div>
      )}

      <Section
        title="Site snapshots"
        links={[{ tab: "design", label: snapshot ? "All snapshots" : "Capture one" }]}
      >
        {snapshot ? (
          <SnapshotGallery snapshot={snapshot} />
        ) : (
          <Hint>
            No snapshots yet. Capture one on the{" "}
            <TabLink tab="design" className="text-[#aaa] underline decoration-[#444] underline-offset-2 hover:text-white">
              Design tab
            </TabLink>{" "}
            to see every page of the site as it renders right now.
          </Hint>
        )}
      </Section>

      <Section
        title="Brand"
        action={kit && <BrandKitButton kit={kit} />}
        links={[{ tab: "design", label: "Design" }]}
      >
        {kit ? (
          <BrandBoard kit={kit} />
        ) : (
          <Hint>
            No design scans yet. Each page measures its own colors and type once per visitor
            session — browse a few pages of the site and the brand board appears here.
          </Hint>
        )}
      </Section>

      <Section title="Visitors" links={[{ tab: "analytics", label: "All metrics" }]}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <OverviewTiles
            overview={overview}
            trends={trends}
            metrics={["sessions", "pageViews"]}
            gridClassName="contents"
          />
          <DepthTile overview={overview} />
          <MobileTile devices={devices} />
          <OverviewTiles
            overview={overview}
            trends={trends}
            metrics={["rageClicks", "deadClicks", "jsErrors", "totalEvents"]}
            gridClassName="contents"
          />
        </div>
      </Section>

      <OverviewSummary
        initialSummary={initialSummary}
        initialSummaryStale={summaryStale}
        initialReview={initialReview}
        initialReviewStale={reviewStale}
        settings={settings}
        scannedPages={scannedPages}
        onSummaryChange={setSummary}
        onReviewChange={setReview}
      />
    </main>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────────

/** A section with nothing to show yet: one line on how it fills. */
function Hint({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${card} px-4 py-3 text-[12px] leading-relaxed text-[#777] sm:px-5`}>
      {children}
    </div>
  );
}

/**
 * Copies the fix prompt. The label and "Copied" share a grid cell, so the
 * button holds its width when the confirmation swaps in.
 */
function CopyPromptButton({
  count,
  emptyTitle: disabledTitle,
  build,
  onCopied,
  onFailed,
}: {
  /** Problems the prompt carries; 0 disables the button. */
  count: number;
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
        data-component="overview-copy-prompt"
        onClick={copy}
        disabled={count === 0}
        title={count === 0 ? disabledTitle : `Copy a prompt that hands ${problems} to a coding agent`}
        aria-label={count === 0 ? "Copy fix prompt" : `Copy fix prompt (${problems})`}
        className={primaryBtn}
      >
        <span className="flex items-center gap-1.5">
          <span className={copied ? "text-emerald-700" : ""}>
            {copied ? <CheckIcon /> : <CopyIcon />}
          </span>
          <span className="grid">
            <span className={`col-start-1 row-start-1 ${copied ? "invisible" : ""}`}>
              Copy fix prompt
            </span>
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
              className="rounded bg-black/10 px-1 text-[10px] font-semibold tabular-nums text-black/60"
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
      <div className="mt-3 h-[18px] truncate text-[11px] leading-[18px] text-[#555]">{note}</div>
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
