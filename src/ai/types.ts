/**
 * Buffd — AI summary types (shared between server and the dashboard UI).
 *
 * The AI layer reads the captured analytics, folds in an owner-supplied
 * description of the site, and asks a model to narrate "how are people actually
 * using this — what's working and what isn't" as one short paragraph.
 *
 * Bring-your-own-key: the owner picks a provider + model and supplies an API
 * key. Keys live server-side only (in the buffd_meta store / env) and are never
 * sent back to the browser — the client only ever sees whether one is set.
 */

/** Supported model vendors. `openai-compatible` covers OpenRouter, Groq, etc. */
export type BuffdAIProvider = "anthropic" | "openai" | "openai-compatible" | "google";

/**
 * How often the summary refreshes itself. Evaluated when the dashboard loads
 * (serverless-friendly — no external cron): if the cadence has elapsed AND the
 * data actually changed, a regenerate runs in the background after the page is
 * served. Unchanged data never costs tokens regardless of cadence.
 */
export type BuffdRefreshCadence = "manual" | "daily" | "weekly";

/** The full, server-side settings — includes the secret API key. */
export interface BuffdAISettings {
  provider: BuffdAIProvider;
  /** Model id, e.g. "claude-opus-4-8", "gpt-4o-mini", "gemini-1.5-flash". */
  model: string;
  /** Secret. Server-only — never serialized to the client. */
  apiKey: string;
  /** Base URL override (required for `openai-compatible`; ignored otherwise). */
  baseUrl?: string;
  /** Extra steering appended to the system prompt (tone, focus, length…). */
  instructions?: string;
  /** Owner's description of the site — what it is, who it's for, key flows. */
  context?: string;
  /** Who the product is for — fed into the project profile. */
  audience?: string;
  /** Product ideology / values / what success looks like — fed into the profile. */
  ideology?: string;
  /** Comma-separated source folders to scan (relative to project root). */
  sourceDirs?: string;
  /** Auto-refresh cadence for the summary. Defaults to "manual". */
  refreshCadence?: BuffdRefreshCadence;
}

/** Client-safe view of the settings: same shape, key replaced by a boolean. */
export interface BuffdAISettingsPublic {
  provider: BuffdAIProvider;
  model: string;
  /** True when an API key is configured (via the dashboard or env). */
  hasApiKey: boolean;
  baseUrl?: string;
  instructions?: string;
  context?: string;
  audience?: string;
  ideology?: string;
  sourceDirs?: string;
  refreshCadence?: BuffdRefreshCadence;
  /** True when provider settings came from env vars (read-only defaults). */
  fromEnv: boolean;
}

/**
 * A one-time, model-written understanding of the codebase: its purpose, the
 * key components and interactive elements, and (optionally) the owner's stated
 * audience and ideology. Cached and reused as authoritative context for every
 * summary, so the per-summary call never needs to read source again — only an
 * explicit re-scan does.
 */
export interface BuffdProjectProfile {
  /** The profile prose. */
  text: string;
  provider: BuffdAIProvider;
  model: string;
  generatedAt: number;
  /** Hash of the scanned source (paths + sizes) — detects source drift. */
  fingerprint: string;
  /** Component/element identifiers the profile explicitly covers. */
  coveredIdentifiers: string[];
  /** How many source files went into the scan, and whether it was capped. */
  sourceFiles: number;
  truncated: boolean;
}

/** Result of a profile scan attempt. */
export type GenerateProfileResult =
  | { ok: true; profile: BuffdProjectProfile }
  | { ok: false; error: GenerateProfileError; message: string };

export type GenerateProfileError = "no-key" | "no-source" | "provider-error";

/** A generated narrative summary, cached in the store. */
export interface BuffdSummary {
  /** The paragraph(s) of narrative. */
  text: string;
  /** Provider + model that produced it. */
  provider: BuffdAIProvider;
  model: string;
  /** When it was generated, ms since epoch. */
  generatedAt: number;
  /** Hash of the digest it was generated from — drives the "stale" check. */
  fingerprint: string;
  /** Token usage, when the provider reported it. */
  usage?: { inputTokens?: number; outputTokens?: number };
}

/** Result of a generate attempt, returned to the dashboard. */
export type GenerateSummaryResult =
  | { ok: true; summary: BuffdSummary; regenerated: boolean }
  | { ok: false; error: GenerateSummaryError; message: string };

export type GenerateSummaryError =
  | "no-key" // no API key configured
  | "no-data" // store empty / not ready — nothing to summarize
  | "provider-error"; // the model call failed
