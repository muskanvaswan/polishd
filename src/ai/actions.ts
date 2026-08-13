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
import { generateDesignReview } from "./design";
import { verifyGithubConnection } from "./github";
import { createIssueFromLoss } from "./issues";
import { generateProjectProfile } from "./profile";
import { loadPolishdDashboardData } from "../server/queries";
import {
  listModelsForProvider,
  saveAISettings,
  type ListModelsInput,
  type SaveAISettingsInput,
} from "./settings";
import { generateSummary } from "./summary";
import type {
  PolishdAISettingsPublic,
  PolishdLossItem,
  CreateIssueResult,
  GenerateDesignReviewResult,
  GenerateProfileResult,
  GenerateSummaryResult,
  ListModelsResult,
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
 * even when the design metrics haven't changed.
 */
export async function generateDesignReviewAction(
  force = false,
): Promise<GenerateDesignReviewResult> {
  await requirePolishdAuth();
  return generateDesignReview({ force });
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
 * step. Passes current analytics so known component names steer the scan.
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
