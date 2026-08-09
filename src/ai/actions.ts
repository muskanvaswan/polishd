"use server";

/**
 * Buffd — server actions for the AI summary card.
 *
 * These are the only AI entry points the client touches. They run on the
 * server (Node runtime), so the API key never crosses to the browser, and they
 * return only serializable, non-secret data.
 *
 * Every one of them gates on `requireBuffdAuth()` first. A server action is an
 * addressable POST endpoint whose id ships in the public client bundle, so it
 * is reachable directly regardless of whether the dashboard page rendered —
 * the page's `authenticate` gate protects the render, not these. The guard
 * re-runs that same callback against the caller's cookies on every call.
 */
import { requireBuffdAuth } from "./guard";
import { verifyGithubConnection } from "./github";
import { createIssueFromLoss } from "./issues";
import { generateProjectProfile } from "./profile";
import { loadBuffdDashboardData } from "../server/queries";
import { saveAISettings, type SaveAISettingsInput } from "./settings";
import { generateSummary } from "./summary";
import type {
  BuffdAISettingsPublic,
  BuffdLossItem,
  CreateIssueResult,
  GenerateProfileResult,
  GenerateSummaryResult,
  VerifyGithubResult,
} from "./types";

/** Generate or refresh the narrative. `force` re-asks the model even if data is unchanged. */
export async function generateSummaryAction(force = false): Promise<GenerateSummaryResult> {
  await requireBuffdAuth();
  return generateSummary({ force });
}

/** Persist provider/model/key/instructions/context; returns the no-secret view. */
export async function saveAISettingsAction(
  input: SaveAISettingsInput,
): Promise<BuffdAISettingsPublic> {
  await requireBuffdAuth();
  return saveAISettings(input);
}

/**
 * Scan the codebase and (re)build the project profile — the explicit setup
 * step. Passes current analytics so known component names steer the scan.
 */
export async function generateProfileAction(): Promise<GenerateProfileResult> {
  await requireBuffdAuth();
  const data = await loadBuffdDashboardData();
  return generateProjectProfile(data);
}

/**
 * Check the saved GitHub repo + token live against the API — called by the
 * onboarding step right after saving, so a bad token fails at setup.
 */
export async function verifyGithubAction(): Promise<VerifyGithubResult> {
  await requireBuffdAuth();
  return verifyGithubConnection();
}

/**
 * Verify one loss against the repository's source and — when it holds up —
 * file a GitHub issue with the technical analysis and fix suggestions. A
 * disproved report returns `not-a-bug` with the reasoning instead of filing.
 */
export async function createIssueFromLossAction(
  loss: Pick<BuffdLossItem, "issue" | "evidence" | "location">,
): Promise<CreateIssueResult> {
  await requireBuffdAuth();
  return createIssueFromLoss(loss);
}
