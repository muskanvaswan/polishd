/**
 * @buffd/next/server — storage, ingest, and read-side queries.
 *
 * Node runtime only (uses `node:sqlite` in dev, `pg` in production). Never
 * import this from a client component — it will pull database drivers into the
 * browser bundle.
 */
export * from "./server/store";
export * from "./server/ingest";
export * from "./server/queries";
export { withBuffdSession } from "./session";

// AI summary layer (server-only — calls model providers).
export {
  generateSummary,
  loadSummary,
  loadSummaryState,
  getAISettingsPublic,
  saveAISettings,
} from "./ai/summary";
export {
  generateProjectProfile,
  loadProjectProfile,
  loadProfileState,
} from "./ai/profile";
export type {
  BuffdAIProvider,
  BuffdAISettings,
  BuffdAISettingsPublic,
  BuffdProjectProfile,
  BuffdSummary,
  GenerateProfileResult,
  GenerateSummaryResult,
} from "./ai/types";
