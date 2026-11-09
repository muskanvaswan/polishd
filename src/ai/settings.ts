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
import { DEFAULT_MODEL, listModels } from "./providers";
import type {
  ListModelsResult,
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

// ── Fix dispatch defaults ────────────────────────────────────────────────────

/** The label on every issue polishd dispatches to the coding agent. */
export const DISPATCH_LABEL_DEFAULT = "polishd-fix";
/** How many dispatches a day before polishd stops, unless the owner says otherwise. */
export const DISPATCH_DAILY_CAP_DEFAULT = 5;
export const DISPATCH_DAILY_CAP_MAX = 100;

/** A daily cap as a whole number between 1 and the maximum, or undefined. */
function coerceCap(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return undefined;
  return Math.min(DISPATCH_DAILY_CAP_MAX, Math.max(1, Math.round(n)));
}

/** A label as GitHub accepts one: trimmed, no newlines, at most 50 characters. */
function coerceLabel(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const label = v.replace(/\s+/g, " ").trim().slice(0, 50);
  return label || undefined;
}

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

// ── Defaults file (polishd.defaults.json) ─────────────────────────────────────

/**
 * The shape of `polishd.defaults.json`: what an app commits about itself so
 * the dashboard opens already knowing the site, the repo and the model. They
 * are defaults: the environment beats them, and anything saved in the
 * dashboard beats both. The file is in git, so it never holds a secret.
 */
export interface PolishdDefaults {
  ai?: {
    provider?: PolishdAIProvider;
    model?: string;
    /** For `openai-compatible` providers. */
    baseUrl?: string;
    /**
     * Read the API key from this environment variable — typically one the app
     * already sets, like `ANTHROPIC_API_KEY`. Only a name ending in `_KEY`.
     */
    apiKeyEnv?: string;
    instructions?: string;
    refresh?: PolishdRefreshCadence;
  };
  site?: {
    description?: string;
    audience?: string;
    values?: string;
    /** Folders the codebase scan reads, relative to the repo root. */
    sourceDirs?: string[] | string;
  };
  github?: { repo?: string; autoIssues?: boolean };
  fix?: { auto?: boolean; label?: string; dailyCap?: number };
}

export interface ParsedPolishdDefaults {
  settings: SavedSettings;
  apiKeyEnv?: string;
  /** What was ignored and why: logged when the page registers the file. */
  problems: string[];
}

/** The file's keys per section, and the setting each one fills. */
export const DEFAULTS_FIELDS: Record<string, Record<string, keyof PolishdAISettings | "apiKeyEnv">> = {
  ai: {
    provider: "provider",
    model: "model",
    baseUrl: "baseUrl",
    apiKeyEnv: "apiKeyEnv",
    instructions: "instructions",
    refresh: "refreshCadence",
  },
  site: {
    description: "context",
    audience: "audience",
    values: "ideology",
    sourceDirs: "sourceDirs",
  },
  github: { repo: "githubRepo", autoIssues: "githubAutoIssues" },
  fix: { auto: "dispatchAuto", label: "dispatchLabel", dailyCap: "dispatchDailyCap" },
};

/** Keys that would put a secret in git, and where the secret goes instead. */
export const DEFAULTS_SECRETS: Record<string, string> = {
  "ai.apiKey": "set POLISHD_AI_API_KEY, or name an existing variable in ai.apiKeyEnv",
  "ai.key": "set POLISHD_AI_API_KEY, or name an existing variable in ai.apiKeyEnv",
  "github.token": "set POLISHD_GITHUB_TOKEN",
  "github.githubToken": "set POLISHD_GITHUB_TOKEN",
};

const API_KEY_ENV_RE = /^[A-Za-z_][A-Za-z0-9_]*_KEY$/;
const GITHUB_REPO_RE = /^[\w.-]+\/[\w.-]+$/;

/**
 * Read a parsed `polishd.defaults.json` into settings, keeping what's valid
 * and naming everything it drops. Blank strings mean "not set", so a file
 * with empty placeholders is fine as it is.
 */
export function parsePolishdDefaults(raw: unknown): ParsedPolishdDefaults {
  const out: ParsedPolishdDefaults = { settings: {}, problems: [] };
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    out.problems.push("expected a JSON object; nothing was read from it");
    return out;
  }
  const settings = out.settings as Record<string, unknown>;
  for (const [section, value] of Object.entries(raw as Record<string, unknown>)) {
    if (section === "$schema") continue;
    const fields = DEFAULTS_FIELDS[section];
    if (!fields) {
      out.problems.push(`unknown section "${section}", ignored`);
      continue;
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      out.problems.push(`"${section}" should be an object, ignored`);
      continue;
    }
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      const path = `${section}.${key}`;
      const secret = DEFAULTS_SECRETS[path];
      if (secret) {
        out.problems.push(`${path} is a secret and this file is committed: ignored. Instead, ${secret}`);
        continue;
      }
      const target = fields[key];
      if (!target) {
        out.problems.push(`unknown key ${path}, ignored`);
        continue;
      }
      const read = readDefault(target, v);
      if (read.problem) out.problems.push(`${path} ${read.problem}, ignored`);
      else if (read.value === undefined) continue;
      else if (target === "apiKeyEnv") out.apiKeyEnv = read.value as string;
      else settings[target] = read.value;
    }
  }
  return out;
}

function readDefault(
  target: keyof PolishdAISettings | "apiKeyEnv",
  v: unknown,
): { value?: unknown; problem?: string } {
  if (v === undefined || v === null || v === "") return {};
  switch (target) {
    case "provider":
      return coerceProvider(v) ? { value: v } : { problem: `must be one of ${VALID_PROVIDERS.join(", ")}` };
    case "refreshCadence":
      return coerceCadence(v) ? { value: v } : { problem: `must be one of ${VALID_CADENCES.join(", ")}` };
    case "githubAutoIssues":
    case "dispatchAuto":
      return typeof v === "boolean" ? { value: v } : { problem: "must be true or false" };
    case "dispatchDailyCap": {
      const cap = typeof v === "number" ? coerceCap(v) : undefined;
      return cap === undefined ? { problem: "must be a number" } : { value: cap };
    }
    case "dispatchLabel": {
      const label = coerceLabel(v);
      return label === undefined ? { problem: "must be text" } : { value: label };
    }
    case "sourceDirs": {
      const list = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : null;
      if (!list || list.some((d) => typeof d !== "string")) {
        return { problem: "must be a list of folder names" };
      }
      const dirs = (list as string[]).map((d) => d.trim()).filter(Boolean);
      return dirs.length ? { value: dirs.join(",") } : {};
    }
    default: {
      if (typeof v !== "string") return { problem: "must be text" };
      const s = v.trim();
      if (!s) return {};
      if (target === "apiKeyEnv" && !API_KEY_ENV_RE.test(s)) {
        return { problem: "must name an environment variable ending in _KEY" };
      }
      if (target === "githubRepo" && !GITHUB_REPO_RE.test(s)) {
        return { problem: 'must be "owner/name"' };
      }
      return { value: s };
    }
  }
}

let fileDefaults: ParsedPolishdDefaults | null = null;
const warnedDefaults = new Set<string>();

/**
 * Register the app's `polishd.defaults.json`, as `createPolishdPage({ defaults })`
 * does at module evaluation — the same moment the access policy is registered,
 * and for the same reason: server actions can run without the page rendering.
 */
export function registerPolishdDefaults(raw: unknown): ParsedPolishdDefaults {
  fileDefaults = parsePolishdDefaults(raw);
  for (const problem of fileDefaults.problems) {
    if (warnedDefaults.has(problem)) continue;
    warnedDefaults.add(problem);
    console.warn(`[polishd] polishd.defaults.json: ${problem}`);
  }
  return fileDefaults;
}

/** Partial settings with every gap filled by the package's own default. */
function complete(merged: SavedSettings): PolishdAISettings {
  const provider = merged.provider ?? "anthropic";
  return {
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
    dispatchAuto: merged.dispatchAuto === true,
    dispatchLabel: coerceLabel(merged.dispatchLabel) ?? DISPATCH_LABEL_DEFAULT,
    dispatchDailyCap: coerceCap(merged.dispatchDailyCap) ?? DISPATCH_DAILY_CAP_DEFAULT,
    dispatchPaused: merged.dispatchPaused === true,
  };
}

/**
 * Effective settings = saved (dashboard) over env over polishd.defaults.json.
 * Returns the full settings (with key) for server use, plus whether the
 * *provider config* came purely from env (so the UI can show it as a read-only
 * default), whether the defaults file supplied anything, and the variable the
 * key was read from when the file named one.
 */
export async function resolveSettings(): Promise<{
  settings: PolishdAISettings;
  fromEnv: boolean;
  fromFile: boolean;
  apiKeyEnv?: string;
}> {
  const env = envSettings();
  const saved = await readSaved();
  const file = fileDefaults?.settings ?? {};
  const merged: SavedSettings = { ...file, ...env, ...saved };
  // A key saved in the dashboard or set as POLISHD_AI_API_KEY wins; the
  // variable the file names is the fallback, so naming one never overrides.
  const namedEnv = fileDefaults?.apiKeyEnv;
  const namedKey = !merged.apiKey && namedEnv ? (process.env[namedEnv] ?? "").trim() : "";
  return {
    settings: { ...complete(merged), apiKey: merged.apiKey || namedKey },
    fromEnv: Object.keys(saved).length === 0 && Object.keys(env).length > 0,
    fromFile: Object.keys(file).length > 0 || namedEnv !== undefined,
    apiKeyEnv: namedKey ? namedEnv : undefined,
  };
}

/** Public (no-secret) settings for the dashboard. */
export async function getAISettingsPublic(): Promise<PolishdAISettingsPublic> {
  const { settings, fromEnv, fromFile, apiKeyEnv } = await resolveSettings();
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
    dispatchAuto: settings.dispatchAuto === true,
    dispatchLabel: settings.dispatchLabel ?? DISPATCH_LABEL_DEFAULT,
    dispatchDailyCap: settings.dispatchDailyCap ?? DISPATCH_DAILY_CAP_DEFAULT,
    dispatchPaused: settings.dispatchPaused === true,
    fromEnv,
    fromFile,
    apiKeyEnv,
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
  /** Fix dispatch choices. A blank label or an unusable cap falls back to the default. */
  dispatchAuto?: boolean;
  dispatchLabel?: string;
  dispatchDailyCap?: number;
  dispatchPaused?: boolean;
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
  if (input.dispatchAuto !== undefined) next.dispatchAuto = input.dispatchAuto === true;
  if (input.dispatchLabel !== undefined) next.dispatchLabel = coerceLabel(input.dispatchLabel);
  if (input.dispatchDailyCap !== undefined) next.dispatchDailyCap = coerceCap(input.dispatchDailyCap);
  if (input.dispatchPaused !== undefined) next.dispatchPaused = input.dispatchPaused === true;

  // Defaults stay defaults. The form sends every field on each save, so a
  // value that matches what would apply without it — polishd.defaults.json,
  // the environment, or the package's own default — isn't stored: storing it
  // would pin it, and a later edit to the file would never land. Secrets are
  // kept as given.
  const defaults = complete({ ...(fileDefaults?.settings ?? {}), ...envSettings() });
  for (const key of Object.keys(next) as (keyof SavedSettings)[]) {
    if (key === "apiKey" || key === "githubToken") continue;
    if (next[key] === defaults[key]) delete next[key];
  }

  await setMeta(SETTINGS_KEY, JSON.stringify(next));
  return getAISettingsPublic();
}

// ── First-time setup ──────────────────────────────────────────────────────────

/** Set once the owner skips the first-time setup; the value is when. */
const ONBOARDING_SKIPPED_KEY = "onboarding_skipped";

/**
 * Whether the dashboard should open on the Settings tab's first-time setup: no
 * model, saved or from env (the same test that shows the wizard), and the
 * owner hasn't skipped it. Saving a key ends it. So does skipping, which is
 * remembered, so a bare `/polishd` stops sending the owner back.
 */
export async function needsOnboarding(): Promise<boolean> {
  const { settings, fromEnv } = await resolveSettings();
  if (settings.apiKey || fromEnv) return false;
  return (await getMeta(ONBOARDING_SKIPPED_KEY)) === null;
}

/** Remember that the owner skipped the first-time setup. */
export async function skipOnboarding(): Promise<void> {
  await setMeta(ONBOARDING_SKIPPED_KEY, String(Date.now()));
}

/** Fields the dashboard sends when asking a provider which models are available. */
export interface ListModelsInput {
  provider?: string;
  /** Typed-but-unsaved key from the form. Falls back to the stored key when blank. */
  apiKey?: string;
  baseUrl?: string;
}

/**
 * List the models available to the given (or stored) key, so the dashboard
 * can render a dropdown instead of a free-text model id. The stored key is
 * only reused when its saved provider matches the requested one — a key
 * saved for Anthropic is never sent to Google, even accidentally.
 */
export async function listModelsForProvider(input: ListModelsInput): Promise<ListModelsResult> {
  const provider = coerceProvider(input.provider);
  if (!provider) {
    return { ok: false, error: "bad-provider", message: "Unrecognized provider." };
  }

  let apiKey = input.apiKey?.trim();
  if (!apiKey) {
    const { settings } = await resolveSettings();
    if (settings.provider === provider && settings.apiKey) apiKey = settings.apiKey;
  }
  if (!apiKey) {
    return { ok: false, error: "no-key", message: "Add an API key first." };
  }

  try {
    const models = await listModels({
      provider,
      model: "",
      apiKey,
      baseUrl: input.baseUrl?.trim() || undefined,
    });
    return { ok: true, models };
  } catch (err) {
    return {
      ok: false,
      error: "provider-error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
