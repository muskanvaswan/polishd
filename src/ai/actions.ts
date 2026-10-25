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
import { verifyGithubConnection } from "./github";
import {
  ignoreDesignIssue,
  ignoreLoss,
  unignoreDesignIssue,
  unignoreLoss,
} from "./ignored";
import { createIssueFromDesignIssue, createIssueFromLoss } from "./issues";
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

/**
 * Verify one loss against the repository's source and — when it holds up —
 * file a GitHub issue with the technical analysis and fix suggestions. A
 * disproved report returns `not-a-bug` with the reasoning instead of filing.
 */
export async function createIssueFromLossAction(
  loss: Pick<PolishdLossItem, "issue" | "evidence" | "location">,
): Promise<CreateIssueResult> {
  await requirePolishdAuth();
  return createIssueFromLoss(loss);
}

/**
 * The same verify-then-file pipeline for one of the design review's issues —
 * the evidence is a measured design token (hex, px value, page path) instead
 * of an analytics identifier.
 */
export async function createIssueFromDesignIssueAction(
  issue: Pick<PolishdDesignIssue, "issue" | "evidence" | "suggestion">,
): Promise<CreateIssueResult> {
  await requirePolishdAuth();
  return createIssueFromDesignIssue(issue);
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
 * replayed into later model calls so the problem isn't reported again. Calling
 * it on an already-dismissed loss just updates the reason.
 */
export async function ignoreLossAction(
  loss: Pick<PolishdLossItem, "issue" | "evidence">,
  reason?: string,
): Promise<IgnoreLossResult> {
  await requirePolishdAuth();
  const ignored = await ignoreLoss(loss, reason);
  return ignored
    ? { ok: true, ignored }
    : { ok: false, message: "Couldn't save that — the analytics store didn't accept the write." };
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
): Promise<IgnoreLossResult> {
  await requirePolishdAuth();
  const ignored = await ignoreDesignIssue(issue, reason);
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
