/**
 * Buffd — AI settings resolution (server only).
 *
 * One place that decides "which model, with which key, and what the owner told
 * us about the site". Saved dashboard settings win over `BUFFD_AI_*` env
 * defaults. Lives in its own module so both the summary and the project-profile
 * orchestrators can share it without importing each other.
 *
 * The API key never leaves the server: `getAISettingsPublic` maps it to a
 * boolean before anything reaches the client.
 */
import { getMeta, setMeta } from "../server/store";
import { DEFAULT_MODEL } from "./providers";
import type {
  BuffdAIProvider,
  BuffdAISettings,
  BuffdAISettingsPublic,
  BuffdRefreshCadence,
} from "./types";

const SETTINGS_KEY = "ai_settings";

const VALID_PROVIDERS: BuffdAIProvider[] = [
  "anthropic",
  "openai",
  "openai-compatible",
  "google",
];

function coerceProvider(v: unknown): BuffdAIProvider | undefined {
  return typeof v === "string" && (VALID_PROVIDERS as string[]).includes(v)
    ? (v as BuffdAIProvider)
    : undefined;
}

const VALID_CADENCES: BuffdRefreshCadence[] = ["manual", "daily", "weekly"];

function coerceCadence(v: unknown): BuffdRefreshCadence | undefined {
  return typeof v === "string" && (VALID_CADENCES as string[]).includes(v)
    ? (v as BuffdRefreshCadence)
    : undefined;
}

/** Settings the owner saved via the dashboard (may be partial). */
type SavedSettings = Partial<BuffdAISettings>;

async function readSaved(): Promise<SavedSettings> {
  const raw = await getMeta(SETTINGS_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as SavedSettings;
  } catch {
    return {};
  }
}

/** Non-secret env defaults — handy for CI / shared deploys. */
function envSettings(): SavedSettings {
  const e = process.env;
  const out: SavedSettings = {};
  const provider = coerceProvider(e.BUFFD_AI_PROVIDER);
  if (provider) out.provider = provider;
  if (e.BUFFD_AI_MODEL) out.model = e.BUFFD_AI_MODEL;
  if (e.BUFFD_AI_API_KEY) out.apiKey = e.BUFFD_AI_API_KEY;
  if (e.BUFFD_AI_BASE_URL) out.baseUrl = e.BUFFD_AI_BASE_URL;
  if (e.BUFFD_AI_INSTRUCTIONS) out.instructions = e.BUFFD_AI_INSTRUCTIONS;
  if (e.BUFFD_AI_CONTEXT) out.context = e.BUFFD_AI_CONTEXT;
  if (e.BUFFD_AI_AUDIENCE) out.audience = e.BUFFD_AI_AUDIENCE;
  if (e.BUFFD_AI_IDEOLOGY) out.ideology = e.BUFFD_AI_IDEOLOGY;
  if (e.BUFFD_AI_SOURCE_DIRS) out.sourceDirs = e.BUFFD_AI_SOURCE_DIRS;
  const cadence = coerceCadence(e.BUFFD_AI_REFRESH_CADENCE);
  if (cadence) out.refreshCadence = cadence;
  return out;
}

/**
 * Effective settings = saved (dashboard) over env defaults. Returns the full
 * settings (with key) for server use, plus whether the *provider config* came
 * purely from env (so the UI can show it as a read-only default).
 */
export async function resolveSettings(): Promise<{ settings: BuffdAISettings; fromEnv: boolean }> {
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
    },
    fromEnv: Object.keys(saved).length === 0 && Object.keys(env).length > 0,
  };
}

/** Public (no-secret) settings for the dashboard. */
export async function getAISettingsPublic(): Promise<BuffdAISettingsPublic> {
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
}

/** Persist owner settings. Returns the refreshed public view. */
export async function saveAISettings(
  input: SaveAISettingsInput,
): Promise<BuffdAISettingsPublic> {
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

  await setMeta(SETTINGS_KEY, JSON.stringify(next));
  return getAISettingsPublic();
}
