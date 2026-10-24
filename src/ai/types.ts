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
  /**
   * Set when the scan read the connected GitHub repo rather than the disk:
   * the repo, the branch, and the app's folder in it ("" for the repo root).
   */
  github?: { repo: string; ref: string; root: string };
}

/** Result of a profile scan attempt. */
export type GenerateProfileResult =
  | { ok: true; profile: PolishdProjectProfile }
  | { ok: false; error: GenerateProfileError; message: string };

export type GenerateProfileError =
  | "no-key"
  | "no-source" // nothing to scan: no source on disk and no repo, or no app in the repo
  | "github-error" // the repo couldn't be read
  | "provider-error";

/**
 * How much behaviour a loss's evidence accounts for, looked up in the
 * aggregated analytics after the model answers — never the model's numbers.
 * `kind` is the event type counted: `dead_click`, `rage_click`, `js_error`,
 * or, for evidence with no friction on it, `page_view` / `component_view`.
 * `pages` lists where it happened, most affected first (capped; empty for a
 * component's views).
 */
export interface PolishdLossSignal {
  kind: string;
  count: number;
  sessions: number;
  pages: string[];
}

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
  /** The analytics volume behind the evidence. Absent when nothing counts it. */
  signal?: PolishdLossSignal;
  /** GitHub issue filed for this problem (manually or automatically). */
  issueUrl?: string;
  issueNumber?: number;
}

/**
 * A loss the owner dismissed — the opposite verdict to filing a bug. Kept out
 * of every summary that renders afterwards, and replayed (with its reason, when
 * one was given) into the prompt of every later model call so the same problem
 * isn't reported again.
 */
export interface PolishdIgnoredLoss {
  /** The problem as the model stated it, when it was dismissed. */
  issue: string;
  /** The citation this dismissal is keyed by. */
  evidence: string;
  /** Why it isn't a problem, in the owner's words. Optional. */
  reason?: string;
  /** When it was first dismissed, ms since epoch. */
  ignoredAt: number;
}

/**
 * A design issue the owner dismissed. Same shape and the same three effects as
 * an ignored loss, against the design review: kept out of every review that
 * renders, and replayed into every later review's prompt.
 */
export type PolishdIgnoredDesignIssue = PolishdIgnoredLoss;

/** Result of dismissing a loss or a design issue. */
export type IgnoreLossResult =
  | { ok: true; ignored: PolishdIgnoredLoss }
  | { ok: false; message: string };

/** Result of undoing a dismissal. */
export type UnignoreLossResult = { ok: true } | { ok: false; message: string };

/**
 * One finding to dismiss from a coding agent's verdict block. Only the
 * citation, verdict and reason travel: the server looks the finding up in the
 * current summary or review by its citation, and takes the problem's wording
 * from there, so a pasted block can't put text of its own into later prompts
 * beyond the bounded reason.
 */
export interface PolishdVerdictDismissal {
  source: "analytics" | "design";
  /**
   * The finding's id in the current summary or review ("A2", "D1"): what
   * picks it out, since two design issues can cite identical evidence.
   */
  id: string;
  /** Its citation, checked against the finding the id names. */
  evidence: string;
  verdict: "not_real" | "deliberate";
  /** The agent's reason, as it wrote it. Sanitized and clipped server-side. */
  reason: string;
}

/** Result of recording a verdict block's dismissals. */
export type RecordVerdictsResult =
  | {
      ok: true;
      /** Each dismissal stored, with the id it was sent under. */
      recorded: { source: "analytics" | "design"; id: string; ignored: PolishdIgnoredLoss }[];
      /** Verdicts whose finding isn't in the current summary or review. */
      skipped: number;
    }
  | { ok: false; message: string };

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

// ── Design review ────────────────────────────────────────────────────────────

/**
 * One aesthetic problem the model called out. `evidence` must be a concrete
 * token from the design digest (a hex color, a px value, a page path) — the
 * same citation bar the summary's losses are held to, so a review can't
 * invent a color the site never renders.
 */
export interface PolishdDesignIssue {
  /** The problem, in plain English. */
  issue: string;
  /** The token from the metrics that shows it (hex, px value, page path). */
  evidence: string;
  /** A concrete fix, when the model offered one and it held up. */
  suggestion?: string;
  /**
   * Values the suggestion names that the metrics don't contain: new to the
   * site, where every other value it names is already in use.
   */
  newValues?: string[];
  /**
   * Why the model's suggestion was dropped, when it was: it would have
   * removed a value the same review lists as a strength, or proposed a new
   * scale or palette rather than reusing the site's own values.
   */
  suggestionWithheld?: string;
  /** GitHub issue filed for this problem, attached when the tab loads. */
  issueUrl?: string;
  issueNumber?: number;
}

/**
 * The model's aesthetic read of the deterministic design metrics — generated
 * by the same provider/model the owner configured for the analytics summary,
 * cached in the store, and refreshed only on demand or when the metrics change.
 */
export interface PolishdDesignReview {
  /** The overall assessment — how coherent and tasteful the design reads. */
  text: string;
  /** What the design gets right. */
  strengths?: string[];
  /** Specific, evidence-cited aesthetic problems. */
  issues?: PolishdDesignIssue[];
  provider: PolishdAIProvider;
  model: string;
  generatedAt: number;
  /** Hash of the design digest it was generated from — drives staleness. */
  fingerprint: string;
  /**
   * Hash of the measurements alone — no site description, no dismissals — so
   * a stale review can say whether the site's design actually changed or only
   * something around it did. Absent on reviews from older versions.
   */
  metricsFingerprint?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

/** Result of a design review attempt, returned to the dashboard. */
export type GenerateDesignReviewResult =
  | { ok: true; review: PolishdDesignReview; regenerated: boolean }
  | { ok: false; error: GenerateDesignReviewError; message: string };

export type GenerateDesignReviewError =
  | "no-key" // no API key configured
  | "no-data" // no pages scanned yet
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

// ── Filed issues (the Issues tab) ────────────────────────────────────────────

/**
 * One issue as GitHub reports it right now, trimmed to what the dashboard
 * shows. Read fresh on every render of the Issues tab — the state, labels and
 * comment count are whatever the tracker says, not what polishd filed.
 */
export interface PolishdGithubIssue {
  number: number;
  title: string;
  /** The issue body, as markdown. */
  body: string;
  url: string;
  state: "open" | "closed";
  /** GitHub's reason for the close, e.g. "completed" / "not_planned". */
  stateReason?: string;
  labels: string[];
  /** Login of whoever the token filed as. */
  author?: string;
  assignees: string[];
  comments: number;
  createdAt: number;
  updatedAt: number;
  closedAt?: number;
}

/**
 * A bug polishd filed, as the Issues tab shows it: what the dashboard knows
 * locally (the analytics citation it came from, the verdict that let it
 * through) joined to what GitHub reports now. `detail` is null when the issue
 * can no longer be read — deleted, transferred, or the token lost access —
 * and the row falls back to the stored number and URL.
 */
export interface PolishdFiledIssue {
  /** The analytics citation this issue was filed from. */
  evidence: string;
  /** The problem as the summary stated it. Absent on older filings. */
  claim?: string;
  /** Whether the source verified the report. Absent on older filings. */
  verdict?: "confirmed" | "inconclusive";
  /** When polishd filed it, ms since epoch. Absent on older filings. */
  filedAt?: number;
  number: number;
  url: string;
  detail: PolishdGithubIssue | null;
}

// ── Fix suggestions ──────────────────────────────────────────────────────────

/**
 * The two failure classes a filed issue falls into, which decide the practice
 * the fix leans on: an interaction issue (something users do fails — dead
 * handlers, broken flows, errors) draws on usability and ARIA authoring
 * practice; a design issue (something users see is wrong — contrast,
 * hierarchy, spacing, layout shift) draws on WCAG and visual-rhythm practice.
 */
export type PolishdFixBugType = "interaction" | "design";

/** One ordered step of the implementation path: a file, and the edit to it. */
export interface PolishdFixStep {
  /** Repository path of the file to change. */
  path: string;
  /** The edit, in one to three sentences. */
  change: string;
}

/**
 * A model-proposed fix for one filed issue, grounded in the repository's
 * actual source and in published practice. Cached per issue number — the
 * source and the issue rarely change under it, and a regenerate is always one
 * click away.
 */
export interface PolishdFixSuggestion {
  issueNumber: number;
  bugType: PolishdFixBugType;
  /** Why the bug was classed the way it was, one sentence. */
  classification: string;
  /** The fix itself, written for the implementing developer. Markdown. */
  approach: string;
  /** The implementation path, in order. */
  steps: PolishdFixStep[];
  /** Named guidelines the fix leans on, e.g. "WCAG 2.2 §1.4.3 contrast". */
  practices: string[];
  /** Repo paths the model was shown. */
  files: string[];
  provider: PolishdAIProvider;
  model: string;
  generatedAt: number;
}

/** Result of asking for (or regenerating) a fix suggestion. */
export type SuggestFixResult =
  | { ok: true; suggestion: PolishdFixSuggestion; regenerated: boolean }
  | { ok: false; error: SuggestFixError; message: string };

export type SuggestFixError =
  | "not-connected" // no GitHub repository configured
  | "no-key" // no model API key configured
  | "not-found" // the issue number isn't one polishd filed
  | "provider-error"; // the model call failed or returned nothing usable

// ── Model listing ────────────────────────────────────────────────────────────

/** Result of asking a provider which models are available to the configured key. */
export type ListModelsResult =
  | { ok: true; models: string[] }
  | { ok: false; error: ListModelsError; message: string };

export type ListModelsError =
  | "bad-provider" // unrecognized provider value
  | "no-key" // no API key available (neither typed nor stored for this provider)
  | "provider-error"; // the provider's list-models call failed
