"use client";

/**
 * Polishd — the actionable list and its right-side drawer (client).
 *
 * One list for everything worth acting on: the analytics summary's losses,
 * the design review's issues, and the GitHub issues already filed for any of
 * them — with the ones closed on GitHub, or that GitHub no longer returns,
 * in a separate Closed list under the main one, collapsed until opened. The
 * list draws its own cards, so the two can sit apart. Each row is one actionable (actionable-model.ts); clicking it opens a
 * drawer with everything behind it, so the dashboard stays in view while you
 * decide what to do with one.
 *
 * The two verdicts live here now rather than on the review cards. **File bug**
 * runs the verify-and-file server action: the server checks the finding
 * against the repository's source first, and a confirmed finding becomes an
 * issue with the technical analysis — linked on the row from that moment,
 * and shown with the tracker's live state on the next load. A disproved one
 * comes back as *not a bug* with the reasoning, shown in place of a link.
 * **Ignore** asks once, in a dialog with an optional reason, and on its
 * second Ignore drops the finding from every later review and replays the
 * reason to the model (dismissable.tsx). **Mark fixed** is the same verdict
 * with a different reason — done, the site changed — stored and replayed the
 * same way, flagged as a fix. All three are driven from list-level state, so
 * the row and the drawer always agree about one finding.
 *
 * A design actionable shows where its cited values render: the facts behind
 * each color, size or padding, and the picture of the element carrying it
 * when a snapshot took one — a thumbnail on the row, the full picture in the
 * drawer. The same pictures go into the issue when it's filed.
 *
 * A filed actionable's drawer also carries the issue as GitHub has it (the
 * body rendered as the markdown it is), and — where no coding agent can be
 * asked to fix it and no pull request already carries a fix — the **Suggest
 * a fix** panel (`offersSuggestFix`): one click asks the
 * configured model to classify the bug and propose a fix grounded in the
 * repository's source, with the file-by-file path. Where an agent can be
 * asked, Create fix does that job with the whole repository in hand, and its
 * brief carries the same practice guidance (ai/fix-practice.ts).
 *
 * And the fix itself. Where the repo's coding agent can be reached on an
 * issue already filed, a filed actionable offers **Create fix**: the agent
 * is asked to scope the issue, prove it real and feasible, and open a pull
 * request linked to it (ai/fix-dispatch.ts). Where the workflow only hears
 * new issues, filing is the one moment a fix can start, so File bug comes
 * with **File and fix** beside it. Either way the row says where the fix
 * stands, and the drawer shows what GitHub says has happened on the issue —
 * pull requests and activity, whoever they're from, read again whenever the
 * issue is opened. The agent works on GitHub with or without this tab; when
 * it has left a fix on a branch with no pull request (the Action's default),
 * Create fix gives way to **Create PR**, which opens the pull request linked
 * to the issue — or **Link PR**, for an agent's pull request missing its
 * `Fixes #N`. polishd writes nothing to a pull request without that click.
 */
import { useEffect, useState, useTransition, type ReactNode } from "react";

import {
  createIssueFromDesignIssueAction,
  createIssueFromLossAction,
  dispatchFixAction,
  ignoreDesignIssueAction,
  closeFixedIssueAction,
  ignoreLossAction,
  createFixPullAction,
  readFixesAction,
  suggestIssueFixAction,
  unignoreDesignIssueAction,
  unignoreLossAction,
} from "../ai/actions";
import { createPrAction, fixStatus, isFixActive, offersSuggestFix } from "../ai/fix-status";
import type {
  PolishdAgentVerdictKind,
  PolishdDesignIssue,
  PolishdDesignUsage,
  PolishdDesignUsagePreview,
  PolishdFiledIssue,
  PolishdFixRun,
  PolishdFixStatus,
  PolishdFixSuggestion,
  PolishdFixTrigger,
  PolishdGithubIssue,
  PolishdIgnoredLoss,
  PolishdIssueEvent,
  PolishdIssueThread,
  PolishdLinkedPull,
  PolishdLossItem,
} from "../ai/types";
import { previewCaption, usageFacts } from "../shared/design-evidence";
import {
  actionableTitle,
  buildActionables,
  findingKey,
  splitClosed,
  type Actionable,
  type ActionableLink,
} from "./actionable-model";
import { TabLink } from "./chrome";
import { Annotated } from "./design-tokens";
import { DismissedCard, IgnoreButton, UNREACHABLE, type Dismissal } from "./dismissable";
import { Markdown } from "./markdown";
import {
  ArrowRightIcon,
  ArrowUpRightIcon,
  Badge,
  ChartIcon,
  CheckIcon,
  ChevronRightIcon,
  DropletIcon,
  IssueIcon,
  SectionHeader,
  SpinnerIcon,
  XIcon,
  card,
  divider,
  eyebrowCls,
  ghostBtn,
  iconBtn,
  labelCls as label,
  microBtn,
  primaryBtn,
  relTime,
  type Tone,
} from "./ui";
import { loadSnapshotImage } from "./value-preview";

/** What can happen to a finding after it renders — what the Overview mirrors for its prompt. */
export type FindingChange = { ignored: boolean } | { filed: ActionableLink };

// ── Formatting helpers ────────────────────────────────────────────────────────

/** "3 Aug", or "3 Aug 2024" once it's from another year. */
function shortDate(ms: number): string {
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** Coarse relative age — "2d ago" — for the meta line. */
function timeAgo(ms: number): string {
  const delta = Date.now() - ms;
  if (delta < 60_000) return "just now";
  const mins = Math.floor(delta / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return shortDate(ms);
}

/** A set with one key added or removed — state updates stay immutable. */
function toggled<T>(prev: ReadonlySet<T>, key: T, on: boolean): ReadonlySet<T> {
  const next = new Set(prev);
  if (on) next.add(key);
  else next.delete(key);
  return next;
}

function without<K, V>(prev: ReadonlyMap<K, V>, key: K): ReadonlyMap<K, V> {
  if (!prev.has(key)) return prev;
  const next = new Map(prev);
  next.delete(key);
  return next;
}

/**
 * Where an actionable came from, as the tab it came from is drawn in the
 * rail: the Analytics chart in red, the Design droplet in blue, or — for an
 * issue filed from a finding no current review holds — the Actionables mark
 * itself, muted. Colour is part of the mark, so it travels with it.
 */
function SourceIcon({ a, size = 13, className = "" }: { a: Actionable; size?: number; className?: string }) {
  if (!a.finding) {
    return (
      <span className={`inline-flex text-fg-3 ${className}`}>
        <IssueIcon size={size} />
      </span>
    );
  }
  return a.finding.source === "analytics" ? (
    <span className={`inline-flex text-bad ${className}`}>
      <ChartIcon size={size} />
    </span>
  ) : (
    <span className={`inline-flex text-blue ${className}`}>
      <DropletIcon size={size} />
    </span>
  );
}

/** The source, in words, for the drawer's header. */
function sourceName(a: Actionable): string {
  if (!a.finding) return "Filed earlier";
  return a.finding.source === "analytics" ? "Analytics" : "Design";
}

/** Where an actionable stands — the one tag its row carries. */
interface Status {
  text: string;
  tone: Tone;
  title?: string;
}

/** An agent's verdict, in the words a tag has room for. */
const VERDICT_WORDS: Record<PolishdAgentVerdictKind, string> = {
  fixed: "fixed",
  not_real: "not real",
  deliberate: "deliberate",
  infeasible: "too big for one PR",
  needs_info: "needs info",
};

/** Where a fix stands, as the tag on its row says it. */
function fixTag(fix: PolishdFixStatus, agent: string): Status {
  const pr = fix.pull ? `#${fix.pull.number}` : "";
  switch (fix.stage) {
    case "requested":
      return { text: "fix requested", tone: "info", title: `Asked ${agent} for a fix — waiting for it to answer` };
    case "working":
      return { text: "agent working", tone: "info", title: `${agent} is working on a fix` };
    case "branch":
      return {
        text: "fix ready",
        tone: "ok",
        title: `${agent} left a fix on ${fix.branch ?? "a branch"} — Create PR opens the pull request, linked to the issue`,
      };
    case "pr-open":
      return { text: fix.pull?.draft ? "draft PR" : "PR open", tone: "ok", title: `Pull request ${pr} is open` };
    case "merged":
      return { text: "fix merged", tone: "violet", title: `Pull request ${pr} was merged` };
    case "pr-closed":
      return { text: "PR closed", tone: "neutral", title: `Pull request ${pr} was closed without merging` };
    case "declined":
      return {
        text: `agent: ${fix.verdict ? VERDICT_WORDS[fix.verdict.verdict] : "declined"}`,
        tone: "warn",
        title: fix.verdict?.reason || `${agent} looked and didn't change anything`,
      };
    case "stalled":
      return { text: "no answer", tone: "warn", title: `${agent} hasn't answered the fix request` };
    case "failed":
      return { text: "fix not sent", tone: "bad", title: fix.run?.error ?? "The fix request didn't go through" };
  }
}

/**
 * The status, in order of what matters most: a filing under way; once an
 * issue exists, a merged fix, then the tracker's closed state, then where
 * the fix stands, then the tracker's open state; a verdict that it isn't a
 * bug; and for a design finding, whether the review offered a fix. A plain
 * finding with none of those has no tag — the group it sits in says it's to
 * act on.
 */
function statusOf(item: Item): Status | null {
  const { a, link, rejected } = item;
  if (item.filing) {
    return { text: "verifying…", tone: "neutral", title: "Checking the report against the source before filing" };
  }
  if (link) {
    const fixed = item.fix ? fixTag(item.fix, item.agent) : null;
    if (item.fix?.stage === "merged") return fixed;
    if (!a.filed) return fixed ?? { text: "filed", tone: "ok", title: "Filed on GitHub — its state shows here on the next load" };
    const detail = a.filed.detail;
    if (!detail) {
      return fixed ?? {
        text: "unreadable",
        tone: "neutral",
        title:
          "GitHub won't return this issue now — it was deleted or transferred, or the access token no longer covers the repository",
      };
    }
    if (detail.state === "open") return fixed ?? { text: "in progress", tone: "ok", title: "Open on GitHub" };
    return detail.stateReason === "not_planned"
      ? { text: "not planned", tone: "neutral", title: "Closed on GitHub as not planned" }
      : { text: "closed", tone: "violet", title: "Closed on GitHub" };
  }
  if (rejected) return { text: "not a bug", tone: "warn", title: `Checked the source — ${rejected}` };
  const issue = a.finding?.source === "design" ? a.finding.issue : null;
  if (issue?.suggestion) return { text: "fix suggested", tone: "info", title: issue.suggestion };
  if (issue?.suggestionWithheld) {
    return {
      text: "fix withheld",
      tone: "neutral",
      title: `Polishd dropped the model's suggested fix — ${issue.suggestionWithheld}`,
    };
  }
  return null;
}

function StatusTag({ status }: { status: Status }) {
  return (
    <Badge tone={status.tone} title={status.title} className="shrink-0 whitespace-nowrap rounded-full px-2">
      {status.text}
    </Badge>
  );
}

function Chip({ children, tone = "text-fg-2" }: { children: ReactNode; tone?: string }) {
  return (
    <span
      className={`max-w-full break-all rounded-md border border-line-strong bg-raised px-1.5 py-0.5 text-[11px] font-medium ${tone}`}
    >
      {children}
    </span>
  );
}

/** Which class of bug the fix suggestion decided this is. */
function BugTypeChip({ type }: { type: PolishdFixSuggestion["bugType"] }) {
  return type === "interaction" ? (
    <Badge tone="info" className="shrink-0">
      interaction issue
    </Badge>
  ) : (
    <Badge tone="violet" className="shrink-0">
      design issue
    </Badge>
  );
}

/** The filed issue's link, as the row and the drawer both show it. */
function IssueLink({ link, className = "" }: { link: ActionableLink; className?: string }) {
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noreferrer noopener"
      onClick={(e) => e.stopPropagation()}
      className={`inline-flex h-6 items-center gap-1 rounded-md bg-ok/10 px-2 text-[11px] font-medium text-ok ring-1 ring-inset ring-ok/20 transition-colors hover:bg-ok/15 ${className}`}
    >
      <IssueIcon size={11} />
      {link.number > 0 ? `Issue #${link.number}` : "Issue"}
      <ArrowUpRightIcon size={11} />
    </a>
  );
}

/** The dot-separated facts about a filed issue, in the order they matter. */
function metaLine(filed: PolishdFiledIssue): string {
  const { detail } = filed;
  const opened = detail?.createdAt ?? filed.filedAt;
  const bits: string[] = [];
  if (opened) bits.push(`opened ${timeAgo(opened)}`);
  if (detail?.author) bits.push(`by ${detail.author}`);
  if (detail?.closedAt) bits.push(`closed ${timeAgo(detail.closedAt)}`);
  // An "updated" that is really just the moment it was filed says nothing.
  else if (detail && detail.updatedAt > (opened ?? 0) + 60_000) {
    bits.push(`updated ${timeAgo(detail.updatedAt)}`);
  }
  if (detail && detail.comments > 0) {
    bits.push(`${detail.comments} ${detail.comments === 1 ? "comment" : "comments"}`);
  }
  if (detail && detail.assignees.length > 0) {
    bits.push(`assigned to ${detail.assignees.join(", ")}`);
  }
  return bits.join(" · ");
}

/** The count behind a loss, as one line: "23 dead clicks · 9 sessions". */
function signalLine(loss: PolishdLossItem): string | null {
  const s = loss.signal;
  if (!s || !(s.count > 0)) return null;
  const kind = s.kind.replace(/_/g, " ");
  return `${s.count.toLocaleString()} ${kind}${s.count === 1 ? "" : "s"} · ${s.sessions.toLocaleString()} session${s.sessions === 1 ? "" : "s"}`;
}

// ── Pictures ──────────────────────────────────────────────────────────────────

/** One snapshot picture, fetched lazily through the auth-gated action. */
function PreviewImage({
  preview,
  alt,
  className,
  fit = "contain",
}: {
  preview: PolishdDesignUsagePreview;
  alt: string;
  className: string;
  fit?: "contain" | "cover";
}) {
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    setSrc(undefined);
    loadSnapshotImage(preview.snapshotId, preview.file).then((url) => alive && setSrc(url));
    return () => {
      alive = false;
    };
  }, [preview.snapshotId, preview.file]);

  return (
    <div className={`flex items-center justify-center overflow-hidden border border-line bg-canvas ${className}`}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} className={`h-full w-full ${fit === "cover" ? "object-cover" : "object-contain"}`} />
      ) : (
        <span className={`text-[11px] text-fg-3 ${src === undefined ? "motion-safe:animate-pulse" : ""}`}>
          {src === null ? "missing" : "…"}
        </span>
      )}
    </div>
  );
}

/** The usages a design issue was read with, pictured ones first. */
function usagesOf(a: Actionable): PolishdDesignUsage[] {
  if (a.finding?.source !== "design") return [];
  const usages = a.finding.issue.usages ?? [];
  return [...usages].sort((x, y) => Number(!!y.preview) - Number(!!x.preview));
}

/**
 * Where a cited value renders, in the drawer: the picture when there is one,
 * and the facts either way. The same content a filed issue carries.
 */
function UsageFigure({ usage }: { usage: PolishdDesignUsage }) {
  return (
    <figure className="min-w-0">
      {usage.preview && (
        <PreviewImage
          preview={usage.preview}
          alt={`${usage.label} on ${previewCaption(usage.preview)}`}
          className="aspect-[16/10] w-full rounded-lg"
        />
      )}
      <figcaption className={`${usage.preview ? "mt-2" : ""} text-[12.5px] leading-relaxed text-fg-2`}>
        <span className="font-mono text-[12px] text-fg">
          <Annotated text={usage.label} />
        </span>{" "}
        <span className="text-fg-3">— {usageFacts(usage)}</span>
        {usage.preview && (
          <span className="mt-0.5 block text-[12px] text-fg-3">
            Pictured on <span className="font-mono text-fg-2">{usage.preview.route}</span> ·{" "}
            {usage.preview.device}, {usage.preview.theme} · {relTime(usage.preview.capturedAt)}
          </span>
        )}
      </figcaption>
    </figure>
  );
}

// ── One row ───────────────────────────────────────────────────────────────────

/** Everything a row or the drawer needs to know about one actionable right now. */
interface Item {
  a: Actionable;
  /** The filed issue, including one filed in this session. */
  link: ActionableLink | null;
  dismissal: Dismissal;
  /** The verdict's reasoning, when filing found the report isn't a bug. */
  rejected: string | null;
  /** Filing in progress. */
  filing: boolean;
  /** An error from the last file attempt, if it didn't come back as not-a-bug. */
  fileError: string | null;
  /** What GitHub says about the filed issue now, when it was read. */
  thread: PolishdIssueThread | null;
  /** Where the fix stands, when there's anything to say. */
  fix: PolishdFixStatus | null;
  /** The agent's name, for the words around a fix: "Claude", "Copilot". */
  agent: string;
  /** Create fix (or Ask again) can be pressed now. */
  fixable: boolean;
  /**
   * What Create PR would do now — open the pull request from the fix's
   * branch, or link the agent's pull request — or null when there's nothing.
   */
  prAction: "create" | "link" | null;
  /** A fix request, or Create PR, in flight. */
  fixPending: boolean;
  /** GitHub being read again for this issue. */
  fixReading: boolean;
  /** What went wrong with the last of those. */
  fixError: string | null;
}

/** How File bug is offered, as the plan allows a fix to start. */
type FileMode =
  /** File only; Create fix comes after (or no agent is set up). */
  | "plain"
  /** File bug, or File and fix — the workflow only hears new issues. */
  | "choose"
  /** Filing starts the agent regardless — automation mode. */
  | "with-fix";

function fileModeOf(trigger: PolishdFixTrigger, paused: boolean): FileMode {
  if (trigger === "every-filing") return "with-fix";
  return trigger === "on-filing" && !paused ? "choose" : "plain";
}

/** Stages after which the agent can be asked again. */
const ASK_AGAIN = new Set<PolishdFixStatus["stage"]>(["declined", "stalled", "pr-closed", "failed"]);

/**
 * On a row, the buttons sit on a line of their own under the chips, in line
 * with the text, that is closed until the row is hovered (or focused from the
 * keyboard) and then opens: the row grows to make room, softly, rather than
 * the buttons appearing over something. Closed, the line is zero height and
 * clipped, so a row is exactly as tall without the buttons and nothing in it
 * can be pressed blind — a tap on a phone opens the drawer, where the same
 * buttons are always there. The grid-row trick is what makes an unknown
 * height animate; the buttons fade in alongside.
 */
const BUTTON_ROW =
  "grid motion-safe:transition-[grid-template-rows] motion-safe:duration-200 motion-safe:ease-out";
const BUTTON_ROW_CLOSED = "grid-rows-[0fr] group-hover:grid-rows-[1fr] group-focus-within:grid-rows-[1fr]";
const BUTTON_ROW_OPEN = "grid-rows-[1fr]";
const BUTTONS_FADE =
  "opacity-0 motion-safe:transition-opacity motion-safe:duration-200 group-hover:opacity-100 group-focus-within:opacity-100";

/**
 * What's already decided about a finding, shown among its chips where it
 * stays visible: the issue filed for it, a not-a-bug verdict from filing, or
 * what went wrong the last time a button was pressed.
 */
function VerdictFacts({ item }: { item: Item }) {
  const { a, link, dismissal, rejected } = item;
  if (!a.finding) return null;
  return (
    <>
      {link && <IssueLink link={link} />}
      {!link && rejected && (
        <Badge tone="warn" title={rejected}>
          Checked the source — not an actual bug: {rejected}
        </Badge>
      )}
      {item.fileError && <span className="text-[12px] text-bad">{item.fileError}</span>}
      {dismissal.error && <span className="text-[12px] text-bad">{dismissal.error}</span>}
    </>
  );
}

/** The two ways a finding leaves the list: not a problem, or done. */
type Verdict = "ignore" | "fixed";

/**
 * The verdicts on a finding, as the row and the drawer both offer them, in
 * one line: Mark fixed and Ignore as quiet buttons, then File bug last as the
 * primary one — it's the verdict that produces something. File bug is offered
 * until an issue exists or filing found the report isn't a bug; the other two
 * each open their confirming dialog. `trailing` follows File bug: the drawer
 * puts the issue's link or the not-a-bug verdict there.
 */
function VerdictButtons({
  item,
  canFile,
  fileMode,
  onFile,
  onVerdict,
  onCreateFix,
  onCreatePr,
  component,
  className = "",
  trailing,
}: {
  item: Item;
  canFile: boolean;
  fileMode: FileMode;
  /** File it; `startFix` is File and fix. */
  onFile: (startFix: boolean) => void;
  /** Ignore opens its confirming dialog; Mark fixed applies at once. */
  onVerdict: (kind: Verdict) => void;
  onCreateFix: () => void;
  onCreatePr: () => void;
  /** Where the buttons sit, for the dashboard's own telemetry: "row" or "drawer". */
  component: string;
  className?: string;
  trailing?: ReactNode;
}) {
  const { a, link, dismissal, rejected } = item;
  if (!a.finding && !item.fixable && !item.prAction) return null;
  const fileable = !!a.finding && canFile && !link && !rejected;
  const busy = item.filing || dismissal.pending;
  return (
    <div
      className={`flex flex-wrap items-center gap-2 ${className}`}
      // The row opens the drawer on click; its buttons must not.
      onClick={(e) => e.stopPropagation()}
    >
      {a.finding && (
        <>
          <button
            type="button"
            data-component={`actionable-fixed-${component}`}
            onClick={() => onVerdict("fixed")}
            disabled={busy}
            title="Done — drop it from the reviews and tell the model the site changed here"
            className={ghostBtn}
          >
            Mark fixed
          </button>
          <IgnoreButton
            state={dismissal}
            dataComponent={`actionable-ignore-${component}`}
            title="Not a problem — drop it from the reviews and stop the model reporting it again"
            className={ghostBtn}
            onPress={() => onVerdict("ignore")}
          />
        </>
      )}
      {fileable && fileMode === "choose" && !item.filing && (
        <button
          type="button"
          data-component={`actionable-file-bug-${component}`}
          onClick={() => onFile(false)}
          disabled={busy}
          title={`Verify it against the source and file the issue, without starting ${item.agent} — your workflow only hears new issues, so a fix can't be started on it later`}
          className={ghostBtn}
        >
          File bug
        </button>
      )}
      {fileable && (
        <button
          type="button"
          data-component={`actionable-${fileMode === "plain" ? "file-bug" : "file-and-fix"}-${component}`}
          onClick={() => onFile(fileMode === "choose")}
          disabled={busy}
          title={
            fileMode === "choose"
              ? `Verify it against the source, then file it with the brief in its body, so ${item.agent} scopes it, checks it's real and opens a pull request as it's filed`
              : fileMode === "with-fix"
                ? `Verify it against the source, then file it — your workflow runs on every new issue, so ${item.agent} starts on it as it's filed`
                : "Verify this problem against the source code, then create a GitHub issue with the technical details — linked here"
          }
          className={primaryBtn}
        >
          {item.filing && <SpinnerIcon size={13} />}
          {item.filing ? "Verifying…" : fileMode === "plain" ? "File bug" : "File and fix"}
        </button>
      )}
      {item.fixable && (
        <button
          type="button"
          data-component={`actionable-create-fix-${component}`}
          onClick={onCreateFix}
          disabled={item.fixPending || busy}
          title={`Ask ${item.agent} to scope this issue, confirm it's real and fixable, then open a pull request linked to it`}
          className={primaryBtn}
        >
          {item.fixPending && <SpinnerIcon size={13} />}
          {item.fixPending ? "Asking…" : item.fix && ASK_AGAIN.has(item.fix.stage) ? "Ask again" : "Create fix"}
        </button>
      )}
      {item.prAction && (
        <button
          type="button"
          data-component={`actionable-${item.prAction === "create" ? "create-pr" : "link-pr"}-${component}`}
          onClick={onCreatePr}
          disabled={item.fixPending || busy}
          title={
            item.prAction === "create"
              ? `Open the pull request from ${item.fix?.branch ?? "the branch"} ${item.agent} left its fix on, with Fixes and this issue's number so it's linked`
              : `Add Fixes and this issue's number to ${item.agent}'s pull request, so merging it closes the issue`
          }
          className={primaryBtn}
        >
          {item.fixPending && <SpinnerIcon size={13} />}
          {item.fixPending
            ? item.prAction === "create"
              ? "Opening…"
              : "Linking…"
            : item.prAction === "create"
              ? "Create PR"
              : "Link PR"}
        </button>
      )}
      {trailing}
    </div>
  );
}

/** What the dialog says; only Ignore asks, Mark fixed applies at once. */
const VERDICT_COPY: Record<
  "ignore",
  { title: string; body: string; placeholder: string; confirm: string; busy: string }
> = {
  ignore: {
    title: "Ignore this finding?",
    body:
      "It leaves this review and every later one. A reason is optional, but the model reads it on every later run, so “the second CTA is deliberate” stops the same finding coming back in different words.",
    placeholder: "Why isn't this a problem? (optional)",
    confirm: "Ignore",
    busy: "Ignoring…",
  },
};

/**
 * The one question before a finding leaves the list: are you sure, and why?
 * The reason is optional and worth giving — the model reads it on every later
 * run — but the dialog's own button is what dismisses, so a click on a row's
 * button never dismisses on its own. Above the drawer, since the verdicts
 * are offered there too.
 */
function VerdictDialog({
  item,
  kind,
  onConfirm,
  onClose,
}: {
  item: Item;
  kind: Verdict;
  /** Resolves true once the dismissal is stored; the dialog then closes itself. */
  onConfirm: (reason?: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const busy = item.dismissal.pending;
  const copy = VERDICT_COPY.ignore;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const confirm = async () => {
    if (await onConfirm(reason.trim() || undefined)) onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      {/* backdrop — a button, so the click capture sees a handler rather
          than logging every close as a dead click. */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onClick={() => !busy && onClose()}
        className="absolute inset-0 cursor-default bg-black/70 backdrop-blur-[2px]"
      />
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="polishd-verdict-title"
        data-component={`actionable-${kind}-dialog`}
        onSubmit={(e) => {
          e.preventDefault();
          void confirm();
        }}
        className="relative w-full max-w-md rounded-2xl border border-line-strong bg-surface p-5 shadow-pop sm:p-6"
      >
        <h2 id="polishd-verdict-title" className="text-[16px] font-semibold text-fg">
          {copy.title}
        </h2>
        <p className="mt-2 text-[12.5px] leading-relaxed text-fg-3">{copy.body}</p>
        <label className="mt-4 block">
          <span className="sr-only">{copy.placeholder}</span>
          {/* Body-sized and quiet on focus: a note, not a form. ⌘/Ctrl+Enter
              confirms, since Enter makes a new line here. */}
          <textarea
            autoFocus
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void confirm();
              }
            }}
            maxLength={240}
            placeholder={copy.placeholder}
            disabled={busy}
            className="w-full resize-none rounded-lg border border-line-strong bg-canvas px-3 py-2 text-[13px] leading-relaxed text-fg placeholder:text-fg-3 transition-colors hover:border-fg-4 focus:border-fg-4 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          />
        </label>
        {item.dismissal.error && (
          <p className="mt-2 text-[12px] leading-relaxed text-bad">{item.dismissal.error}</p>
        )}
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className={ghostBtn}>
            Cancel
          </button>
          <button
            type="submit"
            data-component={`actionable-${kind}-confirm`}
            disabled={busy}
            className={primaryBtn}
          >
            {busy && <SpinnerIcon size={13} />}
            {busy ? copy.busy : copy.confirm}
          </button>
        </div>
      </form>
    </div>
  );
}

/** A pull request as the row's meta line names it: "PR #41 open". */
function PullLink({ pull }: { pull: PolishdLinkedPull }) {
  return (
    <a
      href={pull.url}
      target="_blank"
      rel="noreferrer noopener"
      onClick={(e) => e.stopPropagation()}
      title={pull.title}
      className="inline-flex items-center gap-0.5 font-medium text-fg-2 transition-colors hover:text-fg"
    >
      PR #{pull.number} {pull.state === "open" && pull.draft ? "draft" : pull.state}
      <ArrowUpRightIcon size={11} />
    </a>
  );
}

function Row({
  item,
  canFile,
  fileMode,
  onOpen,
  onFile,
  onVerdict,
  onCreateFix,
  onCreatePr,
}: {
  item: Item;
  canFile: boolean;
  fileMode: FileMode;
  onOpen: () => void;
  onFile: (startFix: boolean) => void;
  onVerdict: (kind: Verdict) => void;
  onCreateFix: () => void;
  onCreatePr: () => void;
}) {
  const { a, link, dismissal } = item;
  const rowCls = `${divider} first:border-t-0`;

  if (dismissal.ignored && a.finding) {
    return (
      <DismissedCard
        issue={actionableTitle(a)}
        state={dismissal}
        componentPrefix="actionable"
        readBy={a.finding.source === "analytics" ? "summary" : "review"}
        noun={a.finding.source === "analytics" ? "loss" : "issue"}
        className={`${rowCls} flex flex-col px-4 py-4 text-[13px] leading-snug text-fg-3 sm:px-5`}
        marker={<SourceIcon a={a} className="opacity-60" />}
      />
    );
  }

  const pictured = usagesOf(a).find((u) => u.preview);
  const status = statusOf(item);
  const errorText = item.fileError ?? item.fixError ?? dismissal.error;
  const pull = item.fix?.pull;

  return (
    <li
      className={`${rowCls} group cursor-pointer px-4 py-4 transition-colors hover:bg-raised/40 sm:px-5`}
      onClick={onOpen}
    >
      <div className="flex items-start gap-3">
        <span aria-hidden title={sourceName(a)} className="mt-[3px] shrink-0">
          <SourceIcon a={a} />
        </span>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            data-component="actionable-open"
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
            className="text-left text-[14px] font-medium leading-snug text-fg underline-offset-2 hover:underline"
          >
            {actionableTitle(a)}
          </button>

          {/* Where it stands, under the title where the chips used to be. */}
          {status && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <StatusTag status={status} />
            </div>
          )}

          {/* The issue it's tracked in, and anything that went wrong — the
              evidence, volumes and pictures wait in the drawer. */}
          {(link || pull || errorText) && (
            <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-[12px] leading-snug text-fg-3">
              {link && (
                // The dot travels with the link, so a wrap never starts a line with it.
                <span className="inline-flex items-center gap-1.5">
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-0.5 font-medium text-fg-2 transition-colors hover:text-fg"
                  >
                    {link.number > 0 ? `#${link.number}` : "Issue"} on GitHub
                    <ArrowUpRightIcon size={11} />
                  </a>
                  {(pull || (a.filed && metaLine(a.filed))) && <span aria-hidden>·</span>}
                </span>
              )}
              {pull && (
                <span className="inline-flex items-center gap-1.5">
                  <PullLink pull={pull} />
                  {a.filed && metaLine(a.filed) && <span aria-hidden>·</span>}
                </span>
              )}
              {a.filed && metaLine(a.filed) && <span>{metaLine(a.filed)}</span>}
              {errorText && <span className="text-bad">{errorText}</span>}
            </p>
          )}
        </div>

        {/* A design finding's picture: where the value renders, at a glance. */}
        {pictured?.preview && (
          <PreviewImage
            preview={pictured.preview}
            alt={`${pictured.label} on ${previewCaption(pictured.preview)}`}
            className="hidden h-14 w-[5.5rem] shrink-0 rounded-md sm:flex"
            fit="cover"
          />
        )}

        <div className="flex shrink-0 items-center gap-2">
          <span className="text-fg-3 transition-[color,transform] group-hover:translate-x-0.5 group-hover:text-fg-2">
            <ChevronRightIcon size={15} />
          </span>
        </div>
      </div>

      {/* The buttons' line spans the row and starts where the text does (past
          the dot and its gap), so it sits the same on every row, picture or
          no picture. Something in flight keeps it open when the pointer leaves. */}
      {(a.finding || item.fixable || item.prAction) && (
        <div
          className={`${BUTTON_ROW} ${item.filing || dismissal.pending || item.fixPending ? BUTTON_ROW_OPEN : BUTTON_ROW_CLOSED}`}
        >
          <div className="min-h-0 overflow-hidden">
            <VerdictButtons
              item={item}
              canFile={canFile}
              fileMode={fileMode}
              onFile={onFile}
              onVerdict={onVerdict}
              onCreateFix={onCreateFix}
              onCreatePr={onCreatePr}
              component="row"
              className={`pl-[1.125rem] pt-3 ${item.filing || dismissal.pending || item.fixPending ? "" : BUTTONS_FADE}`}
            />
          </div>
        </div>
      )}
    </li>
  );
}

// ── The suggest-a-fix panel (inside the drawer) ───────────────────────────────

function FixPanel({
  issueNumber,
  repo,
  suggestion,
  canSuggest,
  onSuggested,
}: {
  issueNumber: number;
  repo?: string;
  suggestion?: PolishdFixSuggestion;
  /** True when a model API key is configured — the button needs one. */
  canSuggest: boolean;
  onSuggested: (s: PolishdFixSuggestion) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (force: boolean) => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await suggestIssueFixAction(issueNumber, force);
        if (res.ok) onSuggested(res.suggestion);
        else setError(res.message);
      } catch {
        setError(UNREACHABLE);
      }
    });
  };

  const fileUrl = (path: string) =>
    repo ? `https://github.com/${repo}/blob/HEAD/${path}` : undefined;

  return (
    <div className="border-t border-line px-4 py-5 sm:px-5">
      <div className="mb-3 flex items-center gap-2">
        <div className={eyebrowCls}>Suggested fix</div>
        {suggestion && <BugTypeChip type={suggestion.bugType} />}
      </div>

      {suggestion ? (
        <>
          {suggestion.classification && (
            <p className="mb-3 text-[12.5px] leading-relaxed text-fg-2">{suggestion.classification}</p>
          )}

          <Markdown text={suggestion.approach} />

          {suggestion.steps.length > 0 && (
            <div className="mt-5">
              <div className={`mb-3 ${eyebrowCls}`}>Implementation path</div>
              <ol>
                {suggestion.steps.map((step, i) => (
                  <li key={i} className="relative flex gap-3">
                    <div className="relative flex w-5 shrink-0 justify-center">
                      <span className="z-10 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-raised text-[10.5px] font-semibold tabular-nums text-fg-2 ring-1 ring-inset ring-line-strong">
                        {i + 1}
                      </span>
                      {i < suggestion.steps.length - 1 && (
                        <span className="absolute top-5 h-full w-px bg-line-strong" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1 pb-4 pt-px">
                      {fileUrl(step.path) ? (
                        <a
                          href={fileUrl(step.path)}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="break-all font-mono text-[12px] text-accent hover:underline"
                        >
                          {step.path}
                        </a>
                      ) : (
                        <span className="break-all font-mono text-[12px] text-fg-2">{step.path}</span>
                      )}
                      <p className="mt-1 text-[12.5px] leading-relaxed text-fg-2">{step.change}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {suggestion.practices.length > 0 && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className="text-[12px] text-fg-3">grounded in</span>
              {suggestion.practices.map((p) => (
                <Chip key={p}>{p}</Chip>
              ))}
            </div>
          )}

          <div className="mt-4 flex items-center gap-2.5">
            <button
              type="button"
              data-component="issue-suggest-fix"
              onClick={() => run(true)}
              disabled={pending}
              className={microBtn}
            >
              {pending ? "Rethinking…" : "Regenerate"}
            </button>
            <span className="text-[12px] text-fg-3">
              {suggestion.model} · {timeAgo(suggestion.generatedAt)}
            </span>
          </div>
        </>
      ) : canSuggest ? (
        <>
          <p className="mb-4 text-[12.5px] leading-relaxed text-fg-2">
            Ask the configured model to classify this bug — interaction or design — and propose a
            fix grounded in the repository&apos;s source, with the files to change.
          </p>
          <button
            type="button"
            data-component="issue-suggest-fix"
            onClick={() => run(false)}
            disabled={pending}
            className={ghostBtn}
          >
            {pending && <SpinnerIcon size={13} />}
            {pending ? "Reading the source…" : "Suggest a fix"}
          </button>
        </>
      ) : (
        <p className="text-[12.5px] leading-relaxed text-fg-3">
          Configure a model API key in the settings and polishd can propose a fix for this issue
          from your source code.
        </p>
      )}

      {error && <p className="mt-2.5 text-[12px] leading-relaxed text-bad">{error}</p>}
    </div>
  );
}

// ── Right-side detail drawer ──────────────────────────────────────────────────

function MetaCell({ label: labelText, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="border-t border-line px-4 py-3 odd:border-r sm:px-5">
      <div className={label}>{labelText}</div>
      <div className={`mt-1 break-words text-[13px] font-medium text-fg ${mono ? "font-mono text-[12px]" : ""}`}>
        {value}
      </div>
    </div>
  );
}

function DrawerSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-t border-line px-4 py-5 sm:px-5">
      <div className={`mb-3 ${eyebrowCls}`}>{title}</div>
      {children}
    </div>
  );
}

/** The finding as its review stated it: evidence, volume, source, suggestion. */
function FindingDetail({ a }: { a: Actionable }) {
  if (!a.finding) return null;
  if (a.finding.source === "analytics") {
    const { loss } = a.finding;
    return (
      <DrawerSection title="What the analytics show">
        <div className="flex flex-col gap-1.5">
          <span className="break-all rounded-lg border border-line bg-surface px-2.5 py-1.5 font-mono text-[12px] leading-relaxed text-fg-2">
            {loss.evidence}
          </span>
          {loss.signal && loss.signal.count > 0 && (
            <p className="text-[12.5px] leading-relaxed text-fg-2">
              {signalLine(loss)}
              {loss.signal.pages.length > 0 && (
                <>
                  {" · on "}
                  {loss.signal.pages.slice(0, 4).map((p, i) => (
                    <span key={p}>
                      {i > 0 && ", "}
                      <span className="font-mono text-fg">{p}</span>
                    </span>
                  ))}
                  {loss.signal.pages.length > 4 && ` +${loss.signal.pages.length - 4} more`}
                </>
              )}
            </p>
          )}
          <p className="text-[12.5px] leading-relaxed text-fg-3">
            {loss.location ? (
              <>
                Matched to <span className="font-mono text-fg-2">{loss.location}</span>
                {loss.verified ? " — a name the author wrote, so the match is specific." : "."}
              </>
            ) : loss.candidates?.length ? (
              <>
                Not verified — the citation could be in any of{" "}
                {loss.candidates.map((c, i) => (
                  <span key={c}>
                    {i > 0 && ", "}
                    <span className="font-mono text-fg-2">{c}</span>
                  </span>
                ))}
                , so none was picked.
              </>
            ) : (
              "The citation is real analytics data, but nothing specific in it (a component name, page route, id or visible label) was found in the source."
            )}
          </p>
        </div>
      </DrawerSection>
    );
  }
  const { issue } = a.finding;
  return (
    <DrawerSection title="What the design review found">
      <div className="flex flex-col gap-1.5">
        <span className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12px] leading-relaxed text-fg-2">
          <Annotated text={issue.evidence} />
        </span>
        {issue.suggestion && (
          <span className="flex gap-1.5 rounded-lg border border-ok/20 bg-ok/[0.06] px-2.5 py-1.5 text-[12px] leading-relaxed text-fg-2">
            <span className="mt-[3px] shrink-0 text-ok">
              <ArrowRightIcon size={11} />
            </span>
            <span>
              <Annotated text={issue.suggestion} />
            </span>
          </span>
        )}
        {issue.suggestion && !!issue.newValues?.length && (
          <Badge className="self-start" title="The suggestion names a value the site doesn't render anywhere yet">
            New to the site: {issue.newValues.join(", ")}
          </Badge>
        )}
        {issue.suggestionWithheld && (
          <span
            className="rounded-lg border border-line bg-raised px-2.5 py-1.5 text-[11.5px] leading-relaxed text-fg-3"
            title="Polishd dropped the model's suggested fix — the problem may still be real"
          >
            Suggestion withheld: {issue.suggestionWithheld}
          </span>
        )}
      </div>
    </DrawerSection>
  );
}

/** Where a design finding's values render — pictures first, facts for all. */
function WhereItRenders({ a }: { a: Actionable }) {
  const usages = usagesOf(a);
  if (usages.length === 0) return null;
  const pictured = usages.filter((u) => u.preview);
  return (
    <DrawerSection title="Where it renders">
      <div className="flex flex-col gap-4">
        {usages.map((u) => (
          <UsageFigure key={u.key} usage={u} />
        ))}
      </div>
      {pictured.length === 0 && (
        <p className="mt-3 text-[12px] leading-relaxed text-fg-3">
          Not pictured yet — a{" "}
          <TabLink tab="design" className="text-fg-2 underline decoration-fg-4 underline-offset-2 hover:text-fg">
            site snapshot
          </TabLink>{" "}
          pictures every flagged value in place, and the picture goes into the issue when it&apos;s
          filed.
        </p>
      )}
    </DrawerSection>
  );
}

// ── The fix, and what GitHub says (inside the drawer) ─────────────────────────

/** What the list knows about how fixes reach the repo's coding agent. */
export interface FixContext {
  trigger: PolishdFixTrigger;
  /** "Claude" or "Copilot"; absent when no agent is ready. */
  agentName?: string;
  /** Dispatch paused in Settings. */
  paused: boolean;
}

const NO_FIXES: FixContext = { trigger: "none", paused: false };

function InlineCode({ children }: { children: ReactNode }) {
  return <span className="break-all font-mono text-[12px] text-fg">{children}</span>;
}

function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className="font-medium text-accent hover:underline">
      {children}
    </a>
  );
}

/** One sentence on where the fix stands — or, with none, how one would start. */
function fixSentence(item: Item, ctx: FixContext): ReactNode {
  const { fix, agent } = item;
  const run = fix?.run;
  const pull = fix?.pull;
  if (fix) {
    switch (fix.stage) {
      case "requested":
        return (
          <>
            Asked {agent} {run ? timeAgo(run.requestedAt) : ""}
            {run?.auto ? ", automatically," : ""} to scope this, confirm it&apos;s real and open a pull request
            — waiting for it to answer.{" "}
            {run?.commentUrl && <ExtLink href={run.commentUrl}>The request</ExtLink>}
          </>
        );
      case "working":
        return (
          <>
            {agent} is working on it
            {fix.branch ? (
              <>
                {" "}
                on <InlineCode>{fix.branch}</InlineCode>
              </>
            ) : null}
            . This looks again every half-minute while the page is open.
          </>
        );
      case "branch":
        return (
          <>
            {agent} left a fix on <InlineCode>{fix.branch}</InlineCode>, with no pull request on it yet. Create PR
            opens one from it, with <InlineCode>Fixes #{item.link?.number}</InlineCode> so it&apos;s linked to this
            issue.
          </>
        );
      case "pr-open":
        return (
          <>
            Pull request {pull && <ExtLink href={pull.url}>#{pull.number}</ExtLink>} is open
            {pull?.draft ? " as a draft" : ""}
            {pull?.author ? `, opened by ${pull.author}` : ""}.{" "}
            {pull?.closes
              ? "It's linked: merging it closes this issue."
              : item.prAction === "link"
                ? "It isn't linked with a closing keyword yet — Link PR adds one, so merging it closes this issue."
                : "It isn't linked with a closing keyword, so merging it won't close this issue."}
          </>
        );
      case "merged":
        return (
          <>
            Fixed by pull request {pull && <ExtLink href={pull.url}>#{pull.number}</ExtLink>}
            {pull?.mergedAt ? `, merged ${timeAgo(pull.mergedAt)}` : ", merged"}.
          </>
        );
      case "pr-closed":
        return (
          <>
            Pull request {pull && <ExtLink href={pull.url}>#{pull.number}</ExtLink>} was closed without merging.
          </>
        );
      case "declined":
        return <>{agent} looked into it and changed nothing.</>;
      case "stalled":
        return (
          <>
            No answer from {agent} since the request{run ? `, ${timeAgo(run.requestedAt)}` : ""}. If it keeps
            happening, the live test under{" "}
            <TabLink tab="settings" className="text-fg underline decoration-fg-4 underline-offset-2">
              Settings → Fix dispatch
            </TabLink>{" "}
            names the likely causes.
          </>
        );
      case "failed":
        return <>{run?.error ?? "The fix request didn't go through."}</>;
    }
  }
  if (item.a.filed?.detail?.state === "closed") return <>Closed on GitHub, with no pull request carrying a fix.</>;
  switch (ctx.trigger) {
    case "separate":
      return ctx.paused ? (
        <>
          No fix yet, and fix dispatch is paused under{" "}
          <TabLink tab="settings" className="text-fg underline decoration-fg-4 underline-offset-2">
            Settings → Fix dispatch
          </TabLink>
          .
        </>
      ) : (
        <>
          No fix yet. Create fix asks {agent} to scope this issue, confirm it&apos;s real and can be fixed in one
          focused pull request, then open one linked to it — or say why not.
        </>
      );
    case "on-filing":
      return (
        <>
          Your workflow only hears new issues, so a fix can&apos;t be started on one already filed. Add{" "}
          <InlineCode>issue_comment</InlineCode> to its <InlineCode>on:</InlineCode> block to start fixes from here.
        </>
      );
    case "every-filing":
      return <>Your workflow runs on every new issue, so {agent} started when this was filed. Nothing it did is linked here yet.</>;
    case "none":
      return (
        <>
          No pull request carries a fix yet. Set up a coding agent under{" "}
          <TabLink tab="settings" className="text-fg underline decoration-fg-4 underline-offset-2">
            Settings → Fix dispatch
          </TabLink>{" "}
          and polishd can ask it for one.
        </>
      );
  }
}

const PULL_TONE: Record<PolishdLinkedPull["state"], Tone> = { open: "ok", merged: "violet", closed: "neutral" };

/** One pull request that references the issue, whoever opened it. */
function PullRow({ pull, carriesFix }: { pull: PolishdLinkedPull; carriesFix: boolean }) {
  const bits = [
    pull.author ? `${pull.author}${pull.authorIsBot ? " (bot)" : ""}` : null,
    pull.closes ? "closes this issue" : carriesFix ? "the fix, not linked" : "mentions this issue",
    pull.state === "merged" && pull.mergedAt ? `merged ${timeAgo(pull.mergedAt)}` : `updated ${timeAgo(pull.updatedAt)}`,
  ].filter(Boolean);
  return (
    <li className="flex items-start gap-2.5 rounded-lg border border-line bg-canvas px-3 py-2">
      <Badge tone={PULL_TONE[pull.state]} className="mt-px shrink-0">
        {pull.state === "open" && pull.draft ? "draft" : pull.state}
      </Badge>
      <div className="min-w-0 flex-1">
        <a
          href={pull.url}
          target="_blank"
          rel="noreferrer noopener"
          className="text-[13px] font-medium leading-snug text-fg hover:underline"
        >
          #{pull.number} {pull.title}
        </a>
        <p className="mt-0.5 text-[12px] leading-snug text-fg-3">
          {bits.join(" · ")}
          {pull.branch && (
            <>
              {" · "}
              <span className="break-all font-mono text-[11.5px]">{pull.branch}</span>
            </>
          )}
        </p>
      </div>
    </li>
  );
}

function FixSection({
  item,
  ctx,
  threadError,
  onRefresh,
}: {
  item: Item;
  ctx: FixContext;
  threadError: string | null;
  onRefresh: () => void;
}) {
  const { fix, thread } = item;
  const verdict = fix?.verdict;
  const pulls = thread?.pulls ?? [];
  const carrying = new Set(fix?.pull ? [fix.pull.number] : []);
  return (
    <DrawerSection title="Fix and pull requests">
      <div className="flex flex-col gap-3">
        <p className="text-[12.5px] leading-relaxed text-fg-2">{fixSentence(item, ctx)}</p>

        {verdict && (
          <div className="rounded-lg border border-line bg-raised px-3 py-2 text-[12.5px] leading-relaxed text-fg-2">
            <span className={label}>{item.agent}&apos;s verdict</span>{" "}
            <span className="font-medium text-fg">{VERDICT_WORDS[verdict.verdict]}</span>
            {verdict.reason && <span> — {verdict.reason}</span>}
            {verdict.files.length > 0 && (
              <span className="mt-1.5 flex flex-wrap gap-1.5">
                {verdict.files.map((f) => (
                  <Chip key={f}>
                    <span className="font-mono">{f}</span>
                  </Chip>
                ))}
              </span>
            )}
          </div>
        )}

        {pulls.length > 0 && (
          <ul className="flex flex-col gap-2">
            {pulls.map((p) => (
              <PullRow key={p.number} pull={p} carriesFix={carrying.has(p.number)} />
            ))}
          </ul>
        )}

        {!thread && threadError && (
          <p className="text-[12px] leading-relaxed text-fg-3">
            Couldn&apos;t read this issue&apos;s pull requests and activity from GitHub — {threadError}
          </p>
        )}
        {item.fixError && <p className="text-[12px] leading-relaxed text-bad">{item.fixError}</p>}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-component="actionable-refresh-fix"
            onClick={onRefresh}
            disabled={item.fixReading}
            className={microBtn}
          >
            {item.fixReading ? "Checking…" : "Check GitHub"}
          </button>
        </div>
      </div>
    </DrawerSection>
  );
}

/** One timeline entry, in a line. */
function eventHeadline(e: PolishdIssueEvent): ReactNode {
  const who = (login?: string) => <span className="font-medium text-fg">{login ?? "someone"}</span>;
  switch (e.kind) {
    case "comment":
      return (
        <>
          {who(e.author)}{" "}
          {e.fromPolishd ? "asked for a fix" : "commented"}
          {e.isAgent && (
            <Badge tone="info" className="ml-1.5 align-middle">
              agent
            </Badge>
          )}
          {e.fromPolishd && (
            <Badge className="ml-1.5 align-middle">polishd</Badge>
          )}
        </>
      );
    case "referenced":
      return (
        <>
          {who(e.actor)} {e.closes ? "linked" : "mentioned this in"} pull request #{e.pull}
        </>
      );
    case "closed":
      return (
        <>
          {who(e.actor)} closed this{e.reason === "not_planned" ? " as not planned" : ""}
          {e.byPull ? ` with pull request #${e.byPull}` : ""}
        </>
      );
    case "reopened":
      return <>{who(e.actor)} reopened this</>;
    case "assigned":
      return (
        <>
          {who(e.actor)} assigned {e.assignee ?? "someone"}
        </>
      );
    case "labeled":
      return (
        <>
          {who(e.actor)} added <Chip>{e.label}</Chip>
        </>
      );
  }
}

const ACTIVITY_SHOWN = 6;

/** What happened on the issue on GitHub, newest first — whoever did it. */
function ActivitySection({ thread }: { thread: PolishdIssueThread | null }) {
  const [all, setAll] = useState(false);
  if (!thread || thread.events.length === 0) return null;
  const events = [...thread.events].reverse();
  const shown = all ? events : events.slice(0, ACTIVITY_SHOWN);
  return (
    <DrawerSection title="Activity on GitHub">
      <ol className="flex flex-col gap-3">
        {shown.map((e, i) => (
          <li key={`${e.kind}-${e.at}-${i}`} className="flex gap-2.5">
            <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-fg-4" />
            <div className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-fg-2">
              {eventHeadline(e)} <span className="text-fg-3">· {timeAgo(e.at)}</span>
              {e.kind === "comment" && e.text && (
                <p className="mt-0.5 line-clamp-3 break-words text-fg-3">
                  {e.text}{" "}
                  {e.url && (
                    <a
                      href={e.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="whitespace-nowrap text-fg-2 underline decoration-fg-4 underline-offset-2 hover:text-fg"
                    >
                      on GitHub
                    </a>
                  )}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
      {events.length > ACTIVITY_SHOWN && (
        <button type="button" onClick={() => setAll((v) => !v)} className={`${microBtn} mt-3`}>
          {all ? "Show fewer" : `Show all ${events.length}`}
        </button>
      )}
    </DrawerSection>
  );
}

function ActionableDrawer({
  item,
  repo,
  canFile,
  fileMode,
  fixCtx,
  threadError,
  suggestion,
  canSuggest,
  onClose,
  onFile,
  onVerdict,
  onCreateFix,
  onCreatePr,
  onRefresh,
  onSuggested,
}: {
  item: Item | null;
  repo?: string;
  canFile: boolean;
  fileMode: FileMode;
  fixCtx: FixContext;
  threadError: string | null;
  suggestion?: PolishdFixSuggestion;
  canSuggest: boolean;
  onClose: () => void;
  onFile: (startFix: boolean) => void;
  onVerdict: (kind: Verdict) => void;
  onCreateFix: () => void;
  onCreatePr: () => void;
  onRefresh: () => void;
  onSuggested: (s: PolishdFixSuggestion) => void;
}) {
  // Esc to close + lock background scroll while the drawer is open.
  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [item, onClose]);

  const open = item !== null;
  const a = item?.a ?? null;
  const link = item?.link ?? null;
  const filed = a?.filed ?? null;
  const detail: PolishdGithubIssue | null = filed?.detail ?? null;
  const title = a ? actionableTitle(a) : "";

  return (
    <div className={`fixed inset-0 z-50 ${open ? "" : "pointer-events-none"}`} aria-hidden={!open}>
      {/* backdrop — a button, because clicking it closes the drawer. As a
          plain div with a React onClick, the click capture can't see the
          handler and logs every close as a dead click. Hidden from assistive
          tech and the tab order; Escape and the ✕ button are the ways out. */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onClick={onClose}
        className={`absolute inset-0 cursor-default bg-black/60 backdrop-blur-[2px] transition-opacity duration-200 ${
          open ? "opacity-100" : "opacity-0"
        }`}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Actionable detail"
        className={`absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l border-line-strong bg-surface shadow-pop transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] sm:max-w-xl ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {item && a && (
          <>
            {/* header */}
            <div className="flex items-center gap-2.5 border-b border-line px-4 py-3.5 sm:px-5">
              <span className="flex items-center gap-1.5 text-[12px] font-medium text-fg-3">
                <SourceIcon a={a} />
                {sourceName(a)}
              </span>
              {link && link.number > 0 && (
                <span className="font-mono text-[15px] font-semibold text-fg">#{link.number}</span>
              )}
              {item && statusOf(item) && <StatusTag status={statusOf(item)!} />}
              {link && (
                <a
                  href={link.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className={`${ghostBtn} ml-auto h-8 px-2.5 text-[12px]`}
                >
                  GitHub
                  <ArrowUpRightIcon />
                </a>
              )}
              <button
                type="button"
                data-component="actionable-close"
                onClick={onClose}
                aria-label="Close"
                className={`${iconBtn} ${link ? "" : "ml-auto"}`}
              >
                <XIcon size={15} />
              </button>
            </div>

            {/* scrollable body */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <div className="px-4 pt-5 sm:px-5">
                <h2
                  className={`text-[17px] font-semibold leading-snug text-fg ${
                    item.dismissal.ignored ? "line-through decoration-fg-4" : ""
                  }`}
                >
                  {title}
                </h2>
                {/* The tracker's title, when it differs from what the review said. */}
                {detail && detail.title !== title && (
                  <p className="mt-2 text-[12.5px] leading-relaxed text-fg-3">
                    <span className={label}>On GitHub</span>{" "}
                    <span className="text-fg-2">{detail.title}</span>
                  </p>
                )}
                {!a.finding && filed?.claim && filed.claim !== title && (
                  <p className="mt-2 text-[12.5px] leading-relaxed text-fg-3">
                    <span className={label}>Reported as</span>{" "}
                    <span className="text-fg-2">{filed.claim}</span>
                  </p>
                )}
                {item.dismissal.ignored && (
                  <div className="mt-3 flex flex-wrap items-center gap-2.5">
                    <span
                      className={`inline-flex items-center gap-1 text-[12.5px] ${
                        item.dismissal.ignored.fixed ? "text-ok" : "text-fg-3"
                      }`}
                    >
                      {item.dismissal.ignored.fixed ? <CheckIcon size={13} /> : <XIcon size={13} />}
                      {item.dismissal.ignored.fixed ? "Fixed" : "Ignored"}
                    </span>
                    {item.dismissal.ignored.reason && (
                      <span className="text-[12.5px] italic text-fg-3">
                        &ldquo;{item.dismissal.ignored.reason}&rdquo;
                      </span>
                    )}
                    <button
                      type="button"
                      data-component="actionable-ignore-undo-drawer"
                      onClick={item.dismissal.undo}
                      disabled={item.dismissal.pending}
                      className={microBtn}
                    >
                      {item.dismissal.pending ? "Undoing…" : "Undo"}
                    </button>
                  </div>
                )}
                {(detail?.labels.length ?? 0) > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5 pb-1">
                    {detail?.labels.map((l) => <Chip key={l}>{l}</Chip>)}
                  </div>
                )}
                <div className="pb-4" />
              </div>

              <FindingDetail a={a} />
              <WhereItRenders a={a} />

              {/* where the fix stands, and what GitHub says — once there's an issue */}
              {link && link.number > 0 && (
                <>
                  <FixSection
                    item={item}
                    ctx={fixCtx}
                    threadError={threadError}
                    onRefresh={onRefresh}
                  />
                  <ActivitySection thread={item.thread} />
                </>
              )}

              {/* the tracker's half, when the issue was read */}
              {filed && (
                <>
                  <div className="grid grid-cols-2 border-b border-line">
                    <MetaCell
                      label="Opened"
                      value={
                        detail?.createdAt
                          ? shortDate(detail.createdAt)
                          : filed.filedAt
                            ? shortDate(filed.filedAt)
                            : "—"
                      }
                    />
                    <MetaCell label="Author" value={detail?.author ?? "—"} />
                    <MetaCell label="Evidence" value={filed.evidence} mono />
                    <MetaCell
                      label="Verification"
                      value={
                        filed.verdict === "confirmed"
                          ? "verified against source"
                          : filed.verdict === "inconclusive"
                            ? "filed unverified"
                            : "—"
                      }
                    />
                  </div>
                  <div className="px-4 py-5 sm:px-5">
                    <div className={`mb-3 ${eyebrowCls}`}>Issue body</div>
                    {detail ? (
                      detail.body.trim().length > 0 ? (
                        <Markdown text={detail.body} />
                      ) : (
                        <p className="text-[12.5px] italic text-fg-3">This issue has no body.</p>
                      )
                    ) : (
                      <p className="text-[12.5px] leading-relaxed text-fg-3">
                        GitHub won&apos;t return this issue any more — it was deleted or transferred,
                        or the access token no longer covers{repo ? ` ${repo}` : " the repository"}.
                      </p>
                    )}
                  </div>
                  {offersSuggestFix(item.fix, fixCtx) && (
                    <FixPanel
                      issueNumber={filed.number}
                      repo={repo}
                      suggestion={suggestion}
                      canSuggest={canSuggest}
                      onSuggested={onSuggested}
                    />
                  )}
                </>
              )}

              {/* filed in this session: the tracker's half arrives on the next load */}
              {link && !filed && (
                <DrawerSection title="On GitHub">
                  <p className="text-[12.5px] leading-relaxed text-fg-2">
                    Filed as{" "}
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="font-medium text-accent hover:underline"
                    >
                      {link.number > 0 ? `#${link.number}` : "an issue"}
                    </a>
                    . Its state, body and the suggest-a-fix panel show here on the next load.
                  </p>
                </DrawerSection>
              )}
            </div>

            {/* the verdicts, pinned where the decision gets made */}
            {((a.finding && !item.dismissal.ignored) || item.fixable || item.prAction) && (
              <div className="border-t border-line px-4 py-3 sm:px-5">
                <VerdictButtons
                  item={item}
                  canFile={canFile}
                  fileMode={fileMode}
                  onFile={onFile}
                  onVerdict={onVerdict}
                  onCreateFix={onCreateFix}
                  onCreatePr={onCreatePr}
                  component="drawer"
                  trailing={<VerdictFacts item={item} />}
                />
              </div>
            )}
          </>
        )}
      </aside>
    </div>
  );
}

// ── The Closed list (below the main one) ──────────────────────────────────────

/**
 * Closed and untracked issues, as a list of their own under the main one,
 * collapsed until asked for: closed on GitHub (fixed, or not planned), or no
 * longer readable there (deleted, transferred, or beyond what the token
 * covers). Their rows work as they do above — the drawer opens from them.
 */
function ClosedList({ items, row }: { items: Item[]; row: (item: Item) => ReactNode }) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  const untracked = items.filter((it) => it.a.filed?.detail === null).length;
  return (
    <section className="mt-10">
      <SectionHeader
        title={
          <button
            type="button"
            data-component="actionable-closed-toggle"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 text-left transition-colors hover:text-fg-2"
          >
            <span aria-hidden className={`inline-flex text-fg-3 transition-transform duration-200 ${open ? "rotate-90" : ""}`}>
              <ChevronRightIcon size={14} />
            </span>
            Closed
            <span className="font-normal tabular-nums text-fg-3">{items.length}</span>
          </button>
        }
        description={
          <>
            Issues closed on GitHub, and ones GitHub no longer returns
            {untracked > 0 ? ` (${untracked} here, deleted, transferred or beyond what the token covers)` : ""}.
            {!open && " Open it to see them."}
          </>
        }
      />
      {open && (
        <div className={`${card} overflow-hidden`}>
          <ul>{items.map(row)}</ul>
        </div>
      )}
    </section>
  );
}

// ── Exported list + drawer ────────────────────────────────────────────────────

export interface ActionableListProps {
  /** The current summary's losses, already without the ones the owner ignored. */
  losses: readonly PolishdLossItem[];
  /** The current design review's issues, likewise. */
  designIssues: readonly PolishdDesignIssue[];
  /** Every issue polishd has filed, joined to the tracker. Empty when it wasn't read. */
  filed?: readonly PolishdFiledIssue[];
  /** The connected repository, "owner/repo". */
  repo?: string;
  /** True when a GitHub repo + token are configured — enables "File bug". */
  githubConnected: boolean;
  /** Cached fix suggestions, keyed by issue number. */
  suggestions?: Record<number, PolishdFixSuggestion>;
  /** True when a model API key is configured (fix suggestions need one). */
  canSuggest?: boolean;
  /** Show at most this many rows, and a link to the rest on the Actionables tab. */
  limit?: number;
  /** What to render when there's nothing to act on. */
  empty: ReactNode;
  /** Told when a loss is ignored, restored or filed, keyed by its evidence. */
  onLossChange?: (evidence: string, change: FindingChange) => void;
  /** Told when a design issue is ignored, restored or filed, keyed by `findingKey`. */
  onIssueChange?: (key: string, change: FindingChange) => void;
  /** Dismissals recorded elsewhere (a pasted verdict block), keyed by evidence. */
  dismissedLosses?: ReadonlyMap<string, PolishdIgnoredLoss>;
  /** The same for design issues, keyed by `findingKey`. */
  dismissedDesign?: ReadonlyMap<string, PolishdIgnoredLoss>;
  /** Fixes polishd asked an agent for, keyed by issue number. */
  runs?: Record<number, PolishdFixRun>;
  /** What GitHub says about each filed issue now, keyed by issue number. */
  threads?: Record<number, PolishdIssueThread>;
  /** Why the threads couldn't be read, when none could. */
  threadError?: string;
  /** How fixes reach the repo's coding agent. No agent, no Create fix. */
  fix?: FixContext;
}

/** How often a fix under way is looked at again. */
const FIX_POLL_MS = 30_000;

export default function ActionableList({
  losses,
  designIssues,
  filed = [],
  repo,
  githubConnected,
  suggestions: initialSuggestions = {},
  canSuggest = false,
  limit,
  empty,
  onLossChange,
  onIssueChange,
  dismissedLosses,
  dismissedDesign,
  runs: initialRuns = {},
  threads: initialThreads = {},
  threadError: initialThreadError,
  fix: fixCtx = NO_FIXES,
}: ActionableListProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** The actionable whose verdict dialog is open, and which verdict. */
  const [confirming, setConfirming] = useState<{ id: string; kind: Verdict } | null>(null);
  // Per actionable, by id. `ignored` holds null for one explicitly restored,
  // so an adopted dismissal (from a verdict paste) can be undone too.
  const [ignored, setIgnored] = useState<ReadonlyMap<string, PolishdIgnoredLoss | null>>(() => new Map());
  const [links, setLinks] = useState<ReadonlyMap<string, ActionableLink>>(() => new Map());
  const [rejected, setRejected] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  const [filing, setFiling] = useState<ReadonlySet<string>>(() => new Set());
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [fileErrors, setFileErrors] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [suggestions, setSuggestions] = useState(initialSuggestions);
  // Fixes, by issue number: polishd's runs, GitHub's threads, and what's in
  // flight or went wrong for each.
  const [runs, setRuns] = useState<Record<number, PolishdFixRun>>(initialRuns);
  const [threads, setThreads] = useState<Record<number, PolishdIssueThread>>(initialThreads);
  const [threadError, setThreadError] = useState<string | null>(initialThreadError ?? null);
  const [fixBusy, setFixBusy] = useState<ReadonlySet<number>>(() => new Set());
  const [fixReading, setFixReading] = useState<ReadonlySet<number>>(() => new Set());
  const [fixErrors, setFixErrors] = useState<ReadonlyMap<number, string>>(() => new Map());
  const fileMode = fileModeOf(fixCtx.trigger, fixCtx.paused);

  const actionables = buildActionables(losses, designIssues, filed);

  const notify = (a: Actionable, change: FindingChange) => {
    if (!a.finding) return;
    if (a.finding.source === "analytics") onLossChange?.(a.finding.loss.evidence, change);
    else onIssueChange?.(findingKey(a.finding.issue), change);
  };

  // A throw from an action (an expired dashboard session, a timeout) would
  // land in the nearest error boundary, and the dashboard has none: every
  // call is caught and said on the row instead.
  /**
   * Store the verdict — a dismissal, flagged fixed when that's what it is;
   * true once it landed, so a dialog can close on it. Re-saving a reason
   * passes no flag, and the server keeps the verdict the entry had.
   */
  const ignore = async (a: Actionable, reason?: string, fixed?: boolean): Promise<boolean> => {
    if (!a.finding) return false;
    setBusy((prev) => toggled(prev, a.id, true));
    setErrors((prev) => without(prev, a.id));
    try {
      const res =
        a.finding.source === "analytics"
          ? await ignoreLossAction(
              { issue: a.finding.loss.issue, evidence: a.finding.loss.evidence },
              reason,
              fixed,
            )
          : await ignoreDesignIssueAction(
              { issue: a.finding.issue.issue, evidence: a.finding.issue.evidence },
              reason,
              fixed,
            );
      if (res.ok) {
        setIgnored((prev) => new Map(prev).set(a.id, res.ignored));
        notify(a, { ignored: true });
        // Fixed means the issue filed for it is done too.
        const n = links.get(a.id)?.number ?? a.link?.number ?? 0;
        if (fixed && githubConnected && n > 0 && a.filed?.detail?.state !== "closed") {
          try {
            const closed = await closeFixedIssueAction(n);
            if (!closed.ok)
              setErrors((prev) => new Map(prev).set(a.id, `Marked fixed, but issue #${n} wasn't closed: ${closed.message}`));
          } catch {
            setErrors((prev) => new Map(prev).set(a.id, `Marked fixed, but issue #${n} wasn't closed: ${UNREACHABLE}`));
          }
        }
        return true;
      }
      setErrors((prev) => new Map(prev).set(a.id, res.message));
    } catch {
      setErrors((prev) => new Map(prev).set(a.id, UNREACHABLE));
    } finally {
      setBusy((prev) => toggled(prev, a.id, false));
    }
    return false;
  };

  const restore = async (a: Actionable) => {
    if (!a.finding) return;
    setBusy((prev) => toggled(prev, a.id, true));
    setErrors((prev) => without(prev, a.id));
    try {
      const res =
        a.finding.source === "analytics"
          ? await unignoreLossAction(a.finding.loss.evidence)
          : await unignoreDesignIssueAction({ issue: a.finding.issue.issue, evidence: a.finding.issue.evidence });
      if (res.ok) {
        setIgnored((prev) => new Map(prev).set(a.id, null));
        notify(a, { ignored: false });
      } else setErrors((prev) => new Map(prev).set(a.id, res.message));
    } catch {
      setErrors((prev) => new Map(prev).set(a.id, UNREACHABLE));
    } finally {
      setBusy((prev) => toggled(prev, a.id, false));
    }
  };

  const file = async (a: Actionable, startFix = false) => {
    if (!a.finding) return;
    setFiling((prev) => toggled(prev, a.id, true));
    setFileErrors((prev) => without(prev, a.id));
    const opts = startFix ? { startFix: true } : undefined;
    try {
      const res =
        a.finding.source === "analytics"
          ? await createIssueFromLossAction(
              {
                issue: a.finding.loss.issue,
                evidence: a.finding.loss.evidence,
                location: a.finding.loss.location,
              },
              opts,
            )
          : await createIssueFromDesignIssueAction(
              {
                issue: a.finding.issue.issue,
                evidence: a.finding.issue.evidence,
                suggestion: a.finding.issue.suggestion,
              },
              opts,
            );
      if (res.ok) {
        const link = { url: res.url, number: res.number };
        setLinks((prev) => new Map(prev).set(a.id, link));
        notify(a, { filed: link });
        const fix = res.fix;
        if (fix) setRuns((prev) => ({ ...prev, [res.number]: fix }));
        if (res.fixError) setFixErrors((prev) => new Map(prev).set(res.number, res.fixError!));
      } else if (res.error === "not-a-bug") {
        setRejected((prev) => new Map(prev).set(a.id, res.message));
      } else setFileErrors((prev) => new Map(prev).set(a.id, res.message));
    } catch {
      setFileErrors((prev) => new Map(prev).set(a.id, "Couldn't reach the server — reload and try again."));
    } finally {
      setFiling((prev) => toggled(prev, a.id, false));
    }
  };

  /** Run one fix action for an issue, with its busy flag and its error. */
  const withFixBusy = async (n: number, work: () => Promise<string | null>) => {
    setFixBusy((prev) => toggled(prev, n, true));
    setFixErrors((prev) => without(prev, n));
    try {
      const error = await work();
      if (error) setFixErrors((prev) => new Map(prev).set(n, error));
    } catch {
      setFixErrors((prev) => new Map(prev).set(n, UNREACHABLE));
    } finally {
      setFixBusy((prev) => toggled(prev, n, false));
    }
  };

  const mergeFixes = (res: { runs: Record<number, PolishdFixRun>; threads: Record<number, PolishdIssueThread>; threadError?: string }) => {
    setRuns((prev) => ({ ...prev, ...res.runs }));
    setThreads((prev) => ({ ...prev, ...res.threads }));
    setThreadError(res.threadError ?? null);
  };

  const createFix = (n: number) =>
    withFixBusy(n, async () => {
      const res = await dispatchFixAction(n);
      if (!res.ok) return res.message;
      setRuns((prev) => ({ ...prev, [n]: res.run }));
      return null;
    });

  const createPull = (n: number) =>
    withFixBusy(n, async () => {
      const res = await createFixPullAction(n);
      if (!res.ok) return res.message;
      mergeFixes(res);
      return null;
    });

  /** Read the issue again from GitHub. A read: it never blocks the buttons. */
  const readOne = async (n: number) => {
    setFixReading((prev) => toggled(prev, n, true));
    try {
      const res = await readFixesAction([n]);
      if (res.ok) {
        mergeFixes(res);
        if (res.threadError && !res.threads[n]) setFixErrors((prev) => new Map(prev).set(n, res.threadError!));
      } else setFixErrors((prev) => new Map(prev).set(n, res.message));
    } catch {
      setFixErrors((prev) => new Map(prev).set(n, UNREACHABLE));
    } finally {
      setFixReading((prev) => toggled(prev, n, false));
    }
  };

  // Ignore asks first, since the reason is replayed to the model; Mark fixed
  // is plain bookkeeping and happens at once.
  const verdict = (a: Actionable, kind: Verdict) => {
    if (kind === "fixed") void ignore(a, undefined, true);
    else setConfirming({ id: a.id, kind });
  };

  const itemOf = (a: Actionable): Item => {
    const adopted =
      a.finding?.source === "analytics"
        ? dismissedLosses?.get(a.finding.loss.evidence)
        : a.finding
          ? dismissedDesign?.get(findingKey(a.finding.issue))
          : undefined;
    const entry = ignored.has(a.id) ? ignored.get(a.id)! : adopted ?? null;
    const link = links.get(a.id) ?? a.link;
    const n = link && link.number > 0 ? link.number : 0;
    const run = n ? runs[n] : undefined;
    const thread = n ? (threads[n] ?? null) : null;
    const fix = run || thread ? fixStatus({ run, thread: thread ?? undefined }) : null;
    const agent = run ? (run.agent === "copilot" ? "Copilot" : "Claude") : (fixCtx.agentName ?? "the agent");
    const fixable =
      githubConnected &&
      fixCtx.trigger === "separate" &&
      !fixCtx.paused &&
      n > 0 &&
      a.filed?.detail?.state !== "closed" &&
      !entry &&
      (!fix || ASK_AGAIN.has(fix.stage));
    const prAction =
      githubConnected && n > 0 && a.filed?.detail?.state !== "closed" && !entry
        ? createPrAction(run, thread ?? undefined)
        : null;
    return {
      a,
      link,
      thread,
      fix,
      agent,
      fixable,
      prAction,
      fixPending: n > 0 && fixBusy.has(n),
      fixReading: n > 0 && fixReading.has(n),
      fixError: n > 0 ? (fixErrors.get(n) ?? null) : null,
      dismissal: {
        ignored: entry,
        pending: busy.has(a.id),
        error: errors.get(a.id) ?? null,
        ignore: (reason, fixed) => void ignore(a, reason, fixed),
        undo: () => void restore(a),
      },
      rejected: rejected.get(a.id) ?? null,
      filing: filing.has(a.id),
      fileError: fileErrors.get(a.id) ?? null,
    };
  };

  const items = actionables.map(itemOf);

  // The page arrives with every filed issue read from GitHub. While an agent
  // is still expected to answer, read again now and then, so a fix that lands
  // while the page is open shows (and offers Create PR) without a reload.
  // Reads only, and only while the page is visible.
  const activeKey = [
    ...new Set(items.filter((it) => it.link && isFixActive(it.fix)).map((it) => it.link!.number)),
  ]
    .sort((x, y) => x - y)
    .join(",");
  useEffect(() => {
    if (!activeKey) return;
    const numbers = activeKey.split(",").map(Number);
    const look = () => {
      if (document.visibilityState !== "visible") return;
      readFixesAction(numbers)
        .then((res) => {
          if (res.ok) mergeFixes(res);
        })
        .catch(() => {
          /* the next look tries again */
        });
    };
    const timer = setInterval(look, FIX_POLL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey]);

  // Closed and untracked issues leave the main list for the Closed menu at
  // the bottom; what's current stays in view.
  const { current: currentItems, closed: closedItems } = splitClosed(items, (it) => it.a);
  const shown = limit !== undefined ? currentItems.slice(0, limit) : currentItems;
  const hidden = currentItems.length - shown.length;
  const selected = items.find((it) => it.a.id === selectedId) ?? null;

  // Opening an issue reads it again: the agent may have answered since the
  // page loaded — or since it was last open.
  const selectedNumber = selected?.link && selected.link.number > 0 ? selected.link.number : 0;
  useEffect(() => {
    if (selectedNumber) void readOne(selectedNumber);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNumber]);
  const confirmingItem = confirming ? (items.find((it) => it.a.id === confirming.id) ?? null) : null;

  if (items.length === 0) return <div className={`${card} overflow-hidden`}>{empty}</div>;

  const row = (item: Item) => (
    <Row
      key={item.a.id}
      item={item}
      canFile={githubConnected}
      fileMode={fileMode}
      onOpen={() => setSelectedId(item.a.id)}
      onFile={(startFix) => void file(item.a, startFix)}
      onVerdict={(kind) => verdict(item.a, kind)}
      onCreateFix={() => item.link && void createFix(item.link.number)}
      onCreatePr={() => item.link && void createPull(item.link.number)}
    />
  );

  return (
    <>
      <div className={`${card} overflow-hidden`}>
        {shown.length > 0 ? (
          <ul>{shown.map(row)}</ul>
        ) : (
          <p className="px-4 py-4 text-[13px] leading-relaxed text-fg-3 sm:px-5">
            Nothing open — everything here is closed on GitHub, or no longer readable there.
          </p>
        )}
        {hidden > 0 && (
          <div className={`${divider} px-4 py-3 sm:px-5`}>
            <TabLink
              tab="actionables"
              className="group inline-flex items-center gap-1 text-[12.5px] font-medium text-fg-2 transition-colors hover:text-fg"
            >
              {hidden} more {hidden === 1 ? "actionable" : "actionables"}
              <span className="transition-transform group-hover:translate-x-0.5">
                <ArrowRightIcon />
              </span>
            </TabLink>
          </div>
        )}
      </div>
      <ClosedList items={closedItems} row={row} />
      <ActionableDrawer
        item={selected}
        repo={repo}
        canFile={githubConnected}
        fileMode={fileMode}
        fixCtx={fixCtx}
        threadError={threadError}
        suggestion={selected?.link ? suggestions[selected.link.number] : undefined}
        canSuggest={canSuggest}
        onClose={() => setSelectedId(null)}
        onFile={(startFix) => selected && void file(selected.a, startFix)}
        onVerdict={(kind) => selected && verdict(selected.a, kind)}
        onCreateFix={() => selected?.link && void createFix(selected.link.number)}
        onCreatePr={() => selected?.link && void createPull(selected.link.number)}
        onRefresh={() => selected?.link && void readOne(selected.link.number)}
        onSuggested={(s) => setSuggestions((prev) => ({ ...prev, [s.issueNumber]: s }))}
      />
      {confirming && confirmingItem && (
        <VerdictDialog
          item={confirmingItem}
          kind={confirming.kind}
          onConfirm={(reason) => ignore(confirmingItem.a, reason, confirming.kind === "fixed")}
          onClose={() => setConfirming(null)}
        />
      )}
    </>
  );
}
