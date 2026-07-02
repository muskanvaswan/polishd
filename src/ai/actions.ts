"use server";

/**
 * Buffd — server actions for the AI summary card.
 *
 * These are the only AI entry points the client touches. They run on the
 * server (Node runtime), so the API key never crosses to the browser, and they
 * return only serializable, non-secret data. The host app's dashboard page is
 * already auth-gated; these inherit that protection by being reachable only
 * from it.
 */
import { generateProjectProfile } from "./profile";
import { loadBuffdDashboardData } from "../server/queries";
import { saveAISettings, type SaveAISettingsInput } from "./settings";
import { generateSummary } from "./summary";
import type {
  BuffdAISettingsPublic,
  GenerateProfileResult,
  GenerateSummaryResult,
} from "./types";

/** Generate or refresh the narrative. `force` re-asks the model even if data is unchanged. */
export async function generateSummaryAction(force = false): Promise<GenerateSummaryResult> {
  return generateSummary({ force });
}

/** Persist provider/model/key/instructions/context; returns the no-secret view. */
export async function saveAISettingsAction(
  input: SaveAISettingsInput,
): Promise<BuffdAISettingsPublic> {
  return saveAISettings(input);
}

/**
 * Scan the codebase and (re)build the project profile — the explicit setup
 * step. Passes current analytics so known component names steer the scan.
 */
export async function generateProfileAction(): Promise<GenerateProfileResult> {
  const data = await loadBuffdDashboardData();
  return generateProjectProfile(data);
}
