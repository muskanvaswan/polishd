"use server";

/**
 * Polishd — server actions for the AI summary card.
 *
 * These are the only AI entry points the client touches. They run on the
 * server (Node runtime), so the API key never crosses to the browser, and they
 * return only serializable, non-secret data.
 *
 * Every one of them gates on `requirePolishdAuth()` first. A server action is an
 * addressable POST endpoint whose id ships in the public client bundle, so it
 * is reachable directly regardless of whether the dashboard page rendered —
 * the page's `authenticate` gate protects the render, not these. The guard
 * re-runs that same callback against the caller's cookies on every call.
 */
import { requirePolishdAuth } from "./guard";
import { selectVerdictDismissals } from "../dashboard/verdicts";
import { generateDesignReview, loadDesignReview } from "./design";
import { checkDispatchReadiness, pollDispatchTest, startDispatchTest } from "./dispatch";
import { generateOverview } from "./overview";
import { suggestIssueFix } from "./fix";
import { createFixPull, dispatchFix, readFixes } from "./fix-dispatch";
import { closeGithubIssue, verifyGithubConnection } from "./github";
import {
  ignoreDesignIssue,
  ignoreLoss,
  unignoreDesignIssue,
  unignoreLoss,
} from "./ignored";
import { createIssueFromDesignIssue, createIssueFromLoss, type FileOptions } from "./issues";
import { generateProjectProfile } from "./profile";
import { loadPolishdDashboardData } from "../server/queries";
import {
  listModelsForProvider,
  saveAISettings,
  type ListModelsInput,
  type SaveAISettingsInput,
} from "./settings";
import { generateSummary, loadSummary } from "./summary";
import type {
  CheckDispatchResult,
  DispatchFixResult,
  DispatchTestResult,
  GenerateOverviewResult,
  PolishdAISettingsPublic,
  PolishdDesignIssue,
  PolishdLossItem,
  CreateIssueResult,
  GenerateDesignReviewResult,
  GenerateProfileResult,
  GenerateSummaryResult,
  IgnoreLossResult,
  ListModelsResult,
  PolishdVerdictDismissal,
  RecordVerdictsResult,
  RefreshFixesResult,
  SuggestFixResult,
  UnignoreLossResult,
  VerifyGithubResult,
} from "./types";

/** Generate or refresh the narrative. `force` re-asks the model even if data is unchanged. */
export async function generateSummaryAction(force = false): Promise<GenerateSummaryResult> {
  await requirePolishdAuth();
  return generateSummary({ force });
}

/**
 * Generate or refresh the aesthetic design review (the Design tab). Uses the
 * same configured provider/model as the summary. `force` re-asks the model
 * even when the design metrics haven't changed. `captureId` names the review
 * capture the dashboard just ran — its first screens and value pictures go
 * to the model; anything but the one capture on record is ignored.
 */
export async function generateDesignReviewAction(
  force = false,
  captureId?: string,
): Promise<GenerateDesignReviewResult> {
  await requirePolishdAuth();
  return generateDesignReview({
    force,
    ...(typeof captureId === "string" && captureId.length > 0 && captureId.length <= 32 ? { captureId } : {}),
  });
}

/**
 * Write (or reuse) the Overview's paragraph — the analytics summary and the
 * design review folded into one by the model. `force` re-asks even when the
 * two reviews haven't changed since it was last written.
 */
export async function generateOverviewAction(force = false): Promise<GenerateOverviewResult> {
  await requirePolishdAuth();
  return generateOverview({ force });
}

/** Persist provider/model/key/instructions/context; returns the no-secret view. */
export async function saveAISettingsAction(
  input: SaveAISettingsInput,
): Promise<PolishdAISettingsPublic> {
  await requirePolishdAuth();
  return saveAISettings(input);
}

/**
 * Scan the codebase and (re)build the project profile — the explicit setup
 * step. Reads the disk where the source is there, otherwise the connected
 * GitHub repo. Passes current analytics so known component names steer the scan.
 */
export async function generateProfileAction(): Promise<GenerateProfileResult> {
  await requirePolishdAuth();
  const data = await loadPolishdDashboardData();
  return generateProjectProfile(data);
}

/**
 * List the models available to the given (or already-stored) key, so the
 * dashboard can render a dropdown instead of a free-text model id.
 */
export async function listModelsAction(input: ListModelsInput): Promise<ListModelsResult> {
  await requirePolishdAuth();
  return listModelsForProvider(input);
}

/**
 * Check the saved GitHub repo + token live against the API — called by the
 * onboarding step right after saving, so a bad token fails at setup.
 */
export async function verifyGithubAction(): Promise<VerifyGithubResult> {
  await requirePolishdAuth();
  return verifyGithubConnection();
}

/** Only the one switch a filing takes from the browser. */
function fileOptions(opts: FileOptions | undefined): FileOptions {
  return opts?.startFix === true ? { startFix: true } : {};
}

/**
 * Verify one loss against the repository's source and — when it holds up —
 * file a GitHub issue with the technical analysis and fix suggestions. A
 * disproved report returns `not-a-bug` with the reasoning instead of filing.
 * `startFix` is File and fix, for a workflow that only hears new issues.
 *
 * The analytics signal behind the loss (which says how it was detected) is
 * looked up in the current summary here, never taken from the browser.
 */
export async function createIssueFromLossAction(
  loss: Pick<PolishdLossItem, "issue" | "evidence" | "location">,
  opts?: FileOptions,
): Promise<CreateIssueResult> {
  await requirePolishdAuth();
  const summary = await loadSummary();
  const key = loss.evidence.trim().toLowerCase();
  const signalKind = summary?.losses?.find((l) => l.evidence.trim().toLowerCase() === key)?.signal?.kind;
  return createIssueFromLoss(
    { issue: loss.issue, evidence: loss.evidence, location: loss.location, ...(signalKind ? { signalKind } : {}) },
    fileOptions(opts),
  );
}

/**
 * The same verify-then-file pipeline for one of the design review's issues —
 * the evidence is a measured design token (hex, px value, page path) instead
 * of an analytics identifier.
 */
export async function createIssueFromDesignIssueAction(
  issue: Pick<PolishdDesignIssue, "issue" | "evidence" | "suggestion">,
  opts?: FileOptions,
): Promise<CreateIssueResult> {
  await requirePolishdAuth();
  return createIssueFromDesignIssue(
    { issue: issue.issue, evidence: issue.evidence, suggestion: issue.suggestion },
    fileOptions(opts),
  );
}

/**
 * Classify one filed issue (interaction vs design) and propose a fix grounded
 * in the repository's source and in published practice, with the file-by-file
 * implementation path. Cached per issue; `force` regenerates.
 */
export async function suggestIssueFixAction(
  issueNumber: number,
  force = false,
): Promise<SuggestFixResult> {
  await requirePolishdAuth();
  return suggestIssueFix(issueNumber, force);
}

/**
 * The other verdict on a loss: dismiss it, with an optional reason. The loss
 * leaves every summary from here on, and the dismissal — reason included — is
 * replayed into later model calls so the problem isn't reported again. With
 * `fixed`, the same with the verdict "fixed": the model is told the site
 * changed here. Calling it on an already-dismissed loss just updates the
 * reason and keeps the verdict it had.
 */
export async function ignoreLossAction(
  loss: Pick<PolishdLossItem, "issue" | "evidence">,
  reason?: string,
  fixed = false,
): Promise<IgnoreLossResult> {
  await requirePolishdAuth();
  const ignored = await ignoreLoss(loss, reason, { fixed });
  return ignored
    ? { ok: true, ignored }
    : { ok: false, message: "Couldn't save that — the analytics store didn't accept the write." };
}

/**
 * Close the GitHub issue filed for a finding the owner just marked fixed, with
 * a short comment saying why. Failure is returned, not thrown: the fixed
 * verdict is already saved by then, and the row says the close didn't go.
 */
export async function closeFixedIssueAction(
  number: number,
): Promise<{ ok: true } | { ok: false; message: string }> {
  await requirePolishdAuth();
  if (!Number.isInteger(number) || number <= 0) return { ok: false, message: "That isn't an issue number." };
  try {
    await closeGithubIssue(number, "Marked fixed in the Polishd dashboard.");
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Couldn't reach GitHub." };
  }
}

/** Undo a dismissal: the loss can be found and reported again. */
export async function unignoreLossAction(evidence: string): Promise<UnignoreLossResult> {
  await requirePolishdAuth();
  return (await unignoreLoss(evidence))
    ? { ok: true }
    : { ok: false, message: "Couldn't undo that — the analytics store didn't accept the write." };
}

/**
 * The same verdict on one of the design review's issues: it leaves every
 * review from here on, and the dismissal is replayed into later reviews so the
 * model doesn't report it again.
 */
export async function ignoreDesignIssueAction(
  issue: Pick<PolishdDesignIssue, "issue" | "evidence">,
  reason?: string,
  fixed = false,
): Promise<IgnoreLossResult> {
  await requirePolishdAuth();
  const ignored = await ignoreDesignIssue(issue, reason, { fixed });
  return ignored
    ? { ok: true, ignored }
    : { ok: false, message: "Couldn't save that — the analytics store didn't accept the write." };
}

/** Undo a design issue's dismissal. */
export async function unignoreDesignIssueAction(
  issue: Pick<PolishdDesignIssue, "issue" | "evidence">,
): Promise<UnignoreLossResult> {
  await requirePolishdAuth();
  return (await unignoreDesignIssue(issue))
    ? { ok: true }
    : { ok: false, message: "Couldn't undo that — the analytics store didn't accept the write." };
}

/**
 * Record a coding agent's not-real and deliberate verdicts as dismissals.
 *
 * The block came from a paste, so nothing in it is taken on trust: each entry
 * must name a finding the current summary or review holds, and only its
 * cleaned reason is kept (selectVerdictDismissals, pure and tested). Entries
 * are written in order, in one call: each dismissal rewrites its log, so
 * parallel calls would drop each other's entries.
 */
export async function recordVerdictsAction(
  dismissals: PolishdVerdictDismissal[],
): Promise<RecordVerdictsResult> {
  await requirePolishdAuth();
  const [summary, review] = await Promise.all([loadSummary(), loadDesignReview()]);
  const checked = selectVerdictDismissals(dismissals, {
    losses: summary?.losses ?? [],
    issues: review?.issues ?? [],
  });
  if (!checked) return { ok: false, message: "That isn't a verdict block from a fix prompt." };

  const recorded: Extract<RecordVerdictsResult, { ok: true }>["recorded"] = [];
  for (const d of checked.selected) {
    const ignored =
      d.source === "design"
        ? await ignoreDesignIssue(d.finding, d.reason)
        : await ignoreLoss(d.finding, d.reason);
    if (!ignored) {
      return recorded.length
        ? { ok: true, recorded, skipped: checked.skipped }
        : { ok: false, message: "Couldn't save that — the analytics store didn't accept the write." };
    }
    recorded.push({ source: d.source, id: d.id, ignored });
  }
  return { ok: true, recorded, skipped: checked.skipped };
}

// ── Fix dispatch ─────────────────────────────────────────────────────────────

/**
 * Read the connected repo and judge whether a fix could be dispatched to a
 * coding agent there — the Settings tab's Fix dispatch card. Reads only.
 */
export async function checkDispatchReadinessAction(): Promise<CheckDispatchResult> {
  await requirePolishdAuth();
  return checkDispatchReadiness();
}

/**
 * File the dispatch test issue and start watching it. Writes one issue (and
 * a comment or an assignment, per the plan) to the connected repo.
 */
export async function startDispatchTestAction(): Promise<DispatchTestResult> {
  await requirePolishdAuth();
  return startDispatchTest();
}

/**
 * One look at the running test. The card calls this every few seconds while
 * the test runs, and "Check again" calls it for a test that outlived the
 * page; whichever way it ends, the issue is closed with a comment.
 */
export async function pollDispatchTestAction(): Promise<DispatchTestResult> {
  await requirePolishdAuth();
  return pollDispatchTest();
}

// ── Fixes ────────────────────────────────────────────────────────────────────

/** A whole, positive issue number, or null — these arrive from the browser. */
function issueNumberOf(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null;
}

/**
 * Create fix: ask the connected coding agent to fix one filed issue — a
 * comment with the trigger phrase and the brief, or the brief and an
 * assignment for Copilot. Writes a label, a comment (and maybe an
 * assignment) to the issue; refuses unless dispatch is ready, unpaused and
 * under its daily cap, and no fix is already under way.
 */
export async function dispatchFixAction(issueNumber: number): Promise<DispatchFixResult> {
  await requirePolishdAuth();
  const n = issueNumberOf(issueNumber);
  if (n === null) return { ok: false, error: "not-found", message: "That isn't an issue number." };
  return dispatchFix(n);
}

/**
 * Read where filed issues' fixes stand — their pull requests and recent
 * activity on GitHub, and polishd's runs. Reads only; the Actionables tab
 * asks when an issue is opened, and now and then while an agent is working.
 */
export async function readFixesAction(issueNumbers: number[]): Promise<RefreshFixesResult> {
  await requirePolishdAuth();
  const numbers = Array.isArray(issueNumbers)
    ? issueNumbers.map(issueNumberOf).filter((n): n is number => n !== null)
    : [];
  return readFixes(numbers);
}

/**
 * Create PR: open the pull request from the branch the agent left its fix on,
 * with `Fixes #N` so it's linked to the issue, and add that line to an agent's
 * pull request that left it out. Writes a pull request, or edits one.
 */
export async function createFixPullAction(issueNumber: number): Promise<RefreshFixesResult> {
  await requirePolishdAuth();
  const n = issueNumberOf(issueNumber);
  if (n === null) return { ok: false, message: "That isn't an issue number." };
  return createFixPull(n);
}
