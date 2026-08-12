/**
 * Polishd — AI summary types (shared between server and the dashboard UI).
 *
 * The AI layer reads the captured analytics, folds in an owner-supplied
 * description of the site, and asks a model to narrate "how are people actually
 * using this — what's working and what isn't" as one short paragraph.
 *
 * Bring-your-own-key: the owner picks a provider + model and supplies an API
 * key. Keys live server-side only (in the polishd_meta store / env) and are never
 * sent back to the browser — the client only ever sees whether one is set.
 */

/** Supported model vendors. `openai-compatible` covers OpenRouter, Groq, etc. */
export type PolishdAIProvider = "anthropic" | "openai" | "openai-compatible" | "google";

/**
 * How often the summary refreshes itself. Evaluated when the dashboard loads
 * (serverless-friendly — no external cron): if the cadence has elapsed AND the
 * data actually changed, a regenerate runs in the background after the page is
 * served. Unchanged data never costs tokens regardless of cadence.
 */
export type PolishdRefreshCadence = "manual" | "daily" | "weekly";

/** The full, server-side settings — includes the secret API key. */
export interface PolishdAISettings {
  provider: PolishdAIProvider;
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
  refreshCadence?: PolishdRefreshCadence;
  /** GitHub repository this site lives in, as "owner/repo". */
  githubRepo?: string;
  /** GitHub access token. Secret. Server-only — never serialized to the client. */
  githubToken?: string;
  /** File an issue automatically for each new problem a summary finds. */
  githubAutoIssues?: boolean;
}

/** Client-safe view of the settings: same shape, key replaced by a boolean. */
export interface PolishdAISettingsPublic {
  provider: PolishdAIProvider;
  model: string;
  /** True when an API key is configured (via the dashboard or env). */
  hasApiKey: boolean;
  baseUrl?: string;
  instructions?: string;
  context?: string;
  audience?: string;
  ideology?: string;
  sourceDirs?: string;
  refreshCadence?: PolishdRefreshCadence;
  /** GitHub repository ("owner/repo"), when connected. */
  githubRepo?: string;
  /** True when a GitHub token is configured (via the dashboard or env). */
  hasGithubToken: boolean;
  /** File an issue automatically for each new problem a summary finds. */
  githubAutoIssues?: boolean;
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
export interface PolishdProjectProfile {
  /** The profile prose. */
  text: string;
  provider: PolishdAIProvider;
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
  | { ok: true; profile: PolishdProjectProfile }
  | { ok: false; error: GenerateProfileError; message: string };

export type GenerateProfileError = "no-key" | "no-source" | "provider-error";

/**
 * A specific problem the model found in the data. Losses are held to a higher
 * bar than wins: each must cite evidence (a selector, component name, or page
 * path) that appears in the digest we sent — uncited losses are dropped as
 * hallucinations — and the server then tries to locate the cited element in
 * the codebase (`location`/`verified`).
 */
export interface PolishdLossItem {
  /** The specific problem, in plain English. */
  issue: string;
  /** The identifier from the data that shows it (selector / component / path). */
  evidence: string;
  /** Source file containing the cited element, when found on disk. */
  location?: string;
  /** True when the citation was matched to a file in the codebase. */
  verified: boolean;
  /** GitHub issue filed for this problem (manually or automatically). */
  issueUrl?: string;
  issueNumber?: number;
}

/** A generated narrative summary, cached in the store. */
export interface PolishdSummary {
  /** The paragraph(s) of narrative. */
  text: string;
  /** What's working — may be general. Absent on summaries from older versions. */
  wins?: string[];
  /** Specific, evidence-cited problems. Absent on summaries from older versions. */
  losses?: PolishdLossItem[];
  /** Provider + model that produced it. */
  provider: PolishdAIProvider;
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
  | { ok: true; summary: PolishdSummary; regenerated: boolean }
  | { ok: false; error: GenerateSummaryError; message: string };

export type GenerateSummaryError =
  | "no-key" // no API key configured
  | "no-data" // store empty / not ready — nothing to summarize
  | "provider-error"; // the model call failed

// ── GitHub connection ────────────────────────────────────────────────────────

/**
 * What the configured token can actually do against the configured repo,
 * checked live during onboarding. `contents` (read) powers source reading;
 * `issues` and `pullRequests` (write) power filing bugs and opening PRs.
 */
export interface PolishdGithubStatus {
  /** The repo as GitHub reports it, e.g. "muskanvaswan/create". */
  repo: string;
  defaultBranch: string;
  /** True when the token can push (create branches / PRs). */
  canPush: boolean;
  /** True when the repo has issues enabled. */
  issuesEnabled: boolean;
}

/** Result of verifying the GitHub connection. */
export type VerifyGithubResult =
  | { ok: true; status: PolishdGithubStatus }
  | { ok: false; error: GithubError; message: string };

/** Result of creating an issue from a loss item. */
export type CreateIssueResult =
  | { ok: true; url: string; number: number }
  | { ok: false; error: GithubError; message: string };

export type GithubError =
  | "not-connected" // no token / repo configured
  | "not-a-bug" // source verification disproved the report — nothing filed
  | "github-error"; // the GitHub API call failed

// ── Model listing ────────────────────────────────────────────────────────────

/** Result of asking a provider which models are available to the configured key. */
export type ListModelsResult =
  | { ok: true; models: string[] }
  | { ok: false; error: ListModelsError; message: string };

export type ListModelsError =
  | "bad-provider" // unrecognized provider value
  | "no-key" // no API key available (neither typed nor stored for this provider)
  | "provider-error"; // the provider's list-models call failed
