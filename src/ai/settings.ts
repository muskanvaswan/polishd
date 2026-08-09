/**
 * Polishd — AI settings resolution (server only).
 *
 * One place that decides "which model, with which key, and what the owner told
 * us about the site". Saved dashboard settings win over `POLISHD_AI_*` env
 * defaults. Lives in its own module so both the summary and the project-profile
 * orchestrators can share it without importing each other.
 *
 * The API key never leaves the server: `getAISettingsPublic` maps it to a
 * boolean before anything reaches the client.
 */
import { getMeta, setMeta } from "../server/store";
import { DEFAULT_MODEL } from "./providers";
import type {
  PolishdAIProvider,
  PolishdAISettings,
  PolishdAISettingsPublic,
  PolishdRefreshCadence,
} from "./types";

const SETTINGS_KEY = "ai_settings";

const VALID_PROVIDERS: PolishdAIProvider[] = [
  "anthropic",
  "openai",
  "openai-compatible",
  "google",
];

function coerceProvider(v: unknown): PolishdAIProvider | undefined {
  return typeof v === "string" && (VALID_PROVIDERS as string[]).includes(v)
    ? (v as PolishdAIProvider)
    : undefined;
}

const VALID_CADENCES: PolishdRefreshCadence[] = ["manual", "daily", "weekly"];

function coerceCadence(v: unknown): PolishdRefreshCadence | undefined {
  return typeof v === "string" && (VALID_CADENCES as string[]).includes(v)
    ? (v as PolishdRefreshCadence)
    : undefined;
}

/** Settings the owner saved via the dashboard (may be partial). */
type SavedSettings = Partial<PolishdAISettings>;

async function readSaved(): Promise<SavedSettings> {
  const raw = await getMeta(SETTINGS_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as SavedSettings;
  } catch {
    return {};
  }
}

/**
 * Non-secret env defaults — handy for CI / shared deploys.
 *
 * Each key is read as `POLISHD_*` first, then the pre-rename `BUFFD_*` name, so
 * deployments configured before the rename keep working without anyone having
 * to touch their host's environment settings.
 */
function envSettings(): SavedSettings {
  const e = process.env;
  /** POLISHD_<name>, falling back to the legacy BUFFD_<name>. */
  const read = (name: string): string | undefined =>
    e[`POLISHD_${name}`] || e[`BUFFD_${name}`];
  const out: SavedSettings = {};

  const provider = coerceProvider(read("AI_PROVIDER"));
  if (provider) out.provider = provider;
  const cadence = coerceCadence(read("AI_REFRESH_CADENCE"));
  if (cadence) out.refreshCadence = cadence;

  const model = read("AI_MODEL");
  if (model) out.model = model;
  const apiKey = read("AI_API_KEY");
  if (apiKey) out.apiKey = apiKey;
  const baseUrl = read("AI_BASE_URL");
  if (baseUrl) out.baseUrl = baseUrl;
  const instructions = read("AI_INSTRUCTIONS");
  if (instructions) out.instructions = instructions;
  const context = read("AI_CONTEXT");
  if (context) out.context = context;
  const audience = read("AI_AUDIENCE");
  if (audience) out.audience = audience;
  const ideology = read("AI_IDEOLOGY");
  if (ideology) out.ideology = ideology;
  const sourceDirs = read("AI_SOURCE_DIRS");
  if (sourceDirs) out.sourceDirs = sourceDirs;

  const githubRepo = read("GITHUB_REPO");
  if (githubRepo) out.githubRepo = githubRepo;
  const githubToken = read("GITHUB_TOKEN");
  if (githubToken) out.githubToken = githubToken;
  const autoIssues = read("GITHUB_AUTO_ISSUES");
  if (autoIssues) out.githubAutoIssues = /^(1|true|yes)$/i.test(autoIssues);

  return out;
}

/**
 * Effective settings = saved (dashboard) over env defaults. Returns the full
 * settings (with key) for server use, plus whether the *provider config* came
 * purely from env (so the UI can show it as a read-only default).
 */
export async function resolveSettings(): Promise<{ settings: PolishdAISettings; fromEnv: boolean }> {
  const env = envSettings();
  const saved = await readSaved();
  const merged: SavedSettings = { ...env, ...saved };
  const provider = merged.provider ?? "anthropic";
  return {
    settings: {
      provider,
      model: merged.model || DEFAULT_MODEL[provider],
      apiKey: merged.apiKey ?? "",
      baseUrl: merged.baseUrl,
      instructions: merged.instructions,
      context: merged.context,
      audience: merged.audience,
      ideology: merged.ideology,
      sourceDirs: merged.sourceDirs,
      refreshCadence: merged.refreshCadence ?? "manual",
      githubRepo: merged.githubRepo,
      githubToken: merged.githubToken,
      githubAutoIssues: merged.githubAutoIssues ?? false,
    },
    fromEnv: Object.keys(saved).length === 0 && Object.keys(env).length > 0,
  };
}

/** Public (no-secret) settings for the dashboard. */
export async function getAISettingsPublic(): Promise<PolishdAISettingsPublic> {
  const { settings, fromEnv } = await resolveSettings();
  return {
    provider: settings.provider,
    model: settings.model,
    hasApiKey: settings.apiKey.length > 0,
    baseUrl: settings.baseUrl,
    instructions: settings.instructions,
    context: settings.context,
    audience: settings.audience,
    ideology: settings.ideology,
    sourceDirs: settings.sourceDirs,
    refreshCadence: settings.refreshCadence,
    githubRepo: settings.githubRepo,
    hasGithubToken: (settings.githubToken ?? "").length > 0,
    githubAutoIssues: settings.githubAutoIssues,
    fromEnv,
  };
}

/** Fields the dashboard form can write. A blank apiKey leaves the saved one. */
export interface SaveAISettingsInput {
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  instructions?: string;
  context?: string;
  audience?: string;
  ideology?: string;
  sourceDirs?: string;
  refreshCadence?: string;
  githubRepo?: string;
  githubToken?: string;
  githubAutoIssues?: boolean;
}

/** Persist owner settings. Returns the refreshed public view. */
export async function saveAISettings(
  input: SaveAISettingsInput,
): Promise<PolishdAISettingsPublic> {
  const prev = await readSaved();
  const next: SavedSettings = { ...prev };

  const provider = coerceProvider(input.provider);
  if (provider) next.provider = provider;
  if (input.model !== undefined) next.model = input.model.trim();
  // Empty apiKey = "keep what's stored"; a non-empty value replaces it.
  if (input.apiKey) next.apiKey = input.apiKey.trim();
  if (input.baseUrl !== undefined) next.baseUrl = input.baseUrl.trim() || undefined;
  if (input.instructions !== undefined)
    next.instructions = input.instructions.trim() || undefined;
  if (input.context !== undefined) next.context = input.context.trim() || undefined;
  if (input.audience !== undefined) next.audience = input.audience.trim() || undefined;
  if (input.ideology !== undefined) next.ideology = input.ideology.trim() || undefined;
  if (input.sourceDirs !== undefined)
    next.sourceDirs = input.sourceDirs.trim() || undefined;
  const cadence = coerceCadence(input.refreshCadence);
  if (cadence) next.refreshCadence = cadence;
  if (input.githubRepo !== undefined)
    next.githubRepo = input.githubRepo.trim() || undefined;
  // Like apiKey: blank keeps the stored token, a value replaces it.
  if (input.githubToken) next.githubToken = input.githubToken.trim();
  if (input.githubAutoIssues !== undefined)
    next.githubAutoIssues = input.githubAutoIssues === true;

  await setMeta(SETTINGS_KEY, JSON.stringify(next));
  return getAISettingsPublic();
}
