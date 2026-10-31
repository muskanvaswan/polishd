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
  /** Model id, e.g. "claude-opus-4-8", "gpt-4o-mini", "gemini-2.5-flash". */
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
  /**
   * Fix dispatch — the owner's choices for handing filed issues to the
   * coding agent connected to the repo (ai/fix-dispatch.ts acts on them).
   */
  /**
   * Hand each issue the source verified to the agent as soon as it's filed,
   * without pressing Create fix. Off by default.
   */
  dispatchAuto?: boolean;
  /** Label put on every issue polishd dispatches. Default "polishd-fix". */
  dispatchLabel?: string;
  /** At most this many dispatches a day. Default 5. */
  dispatchDailyCap?: number;
  /** Pause dispatch, keeping the other choices. */
  dispatchPaused?: boolean;
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
  /** Fix dispatch choices — see `PolishdAISettings`. Always filled in. */
  dispatchAuto: boolean;
  dispatchLabel: string;
  dispatchDailyCap: number;
  dispatchPaused: boolean;
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
 * `kind` is the event type counted: `dead_click`, `rage_click`, or, for
 * evidence with no friction on it, `page_view` / `component_view`.
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
  /**
   * Source file the cited element was matched to — on disk, or in the
   * connected GitHub repo (then a repo path) where the source isn't on disk.
   */
  location?: string;
  /**
   * True when the citation matched exactly one file on something the author
   * wrote — a component name, route, id, custom class or visible label —
   * never on utility classes or tag names.
   */
  verified: boolean;
  /**
   * Set instead of `location` when the match isn't specific enough to verify:
   * the citation matched several files equally well (none of them picked), or
   * its text matched one file in a repo too large to read whole.
   */
  candidates?: string[];
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
  /** Why it isn't a problem — or, for a fix, what changed — in the owner's words. Optional. */
  reason?: string;
  /** When it was first dismissed, ms since epoch. */
  ignoredAt: number;
  /**
   * True when the owner marked it fixed rather than not a problem. The same
   * three effects as a dismissal; the model is told the site changed here,
   * so data from before the fix doesn't bring it back.
   */
  fixed?: boolean;
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
  /**
   * Where the values the issue cites render: how much of the UI each covers,
   * on which pages, how it was declared, and a picture of it in place when a
   * site snapshot took one. Attached when the review is read, never stored —
   * the measurements and the snapshots both move under a cached review.
   */
  usages?: PolishdDesignUsage[];
}

/**
 * A cropped picture of a design value in place — the element carrying it,
 * ringed, with the component around it — from the newest site snapshot that
 * pictured it. `publicUrl` is set when the image sits where anyone can open
 * it (a public Blob store), which is what lets a filed issue embed it.
 */
export interface PolishdDesignUsagePreview {
  snapshotId: string;
  /** Image filename inside the snapshot's `previews/` directory. */
  file: string;
  route: string;
  device: string;
  theme: string;
  capturedAt: number;
  publicUrl?: string;
}

/**
 * One measured design value a finding cites, and everything the Design tab
 * knows about where it renders. The facts come from the design scan; the
 * picture from the snapshots. Both describe the site as it is now, which is
 * why they're attached on read rather than written into the review.
 */
export interface PolishdDesignUsage {
  /** `designValueKey` of the value — what a snapshot's pictures are filed under. */
  key: string;
  kind: "font" | "color" | "radius" | "spacing";
  /** The value as the Design tab names it: "#fafafa", "Inter 17px / 500", "6px radius", "13px padding". */
  label: string;
  /** Elements rendering it, site-wide. */
  count: number;
  pages: string[];
  /** Colors: the roles it plays. */
  roles?: ("text" | "background" | "border")[];
  /** Fonts: the tags seen carrying it. */
  tags?: string[];
  /** Distinct declarations choosing it, and how many hand-typed it. Absent on older scans. */
  declarations?: number;
  handTyped?: number;
  /** Flagged by the deterministic review: a one-off, or hand-typed off the 2px scale. */
  flagged: boolean;
  /** Which of the two, when flagged; a one-off that's also off-scale reads as a one-off. */
  flag?: "one-off" | "off-scale";
  preview?: PolishdDesignUsagePreview;
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
  /**
   * What the model was shown beside the metrics, from the review capture run
   * for this review: the pages whose first screens went (light and dark where
   * the site has both), and the flagged values pictured in place, in words.
   * Absent when nothing went — no capture, or a model that takes no images.
   */
  screenshots?: { capturedAt: number; pages: string[]; values: string[] };
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

// ── The Overview's paragraph ─────────────────────────────────────────────────

/**
 * The one paragraph at the top of the dashboard: the analytics summary and
 * the design review folded into a single story by the same model, cached in
 * the store. Written from the two reviews as they stand (dismissed findings
 * already gone), so it goes stale when either of them changes.
 */
export interface PolishdOverview {
  /** One paragraph of prose — no headings, lists or labels. */
  text: string;
  /** Which reviews existed when it was written. */
  sources: ("summary" | "review")[];
  provider: PolishdAIProvider;
  model: string;
  generatedAt: number;
  /** Hash of the reviews it was written from — drives the "stale" check. */
  fingerprint: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

/** Result of writing (or reusing) the Overview's paragraph. */
export type GenerateOverviewResult =
  | { ok: true; overview: PolishdOverview; regenerated: boolean }
  | { ok: false; error: GenerateOverviewError; message: string };

export type GenerateOverviewError =
  | "no-key" // no API key configured
  | "no-data" // neither review exists yet — nothing to fold together
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

/**
 * Result of creating an issue from a loss item. When the filing also started
 * a fix — File and fix, automatic dispatch, or a workflow that runs on every
 * new issue — `fix` is that run; `fixError` says why a fix that was asked for
 * didn't start, while the issue itself was filed.
 */
export type CreateIssueResult =
  | { ok: true; url: string; number: number; fix?: PolishdFixRun; fixError?: string }
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
 * handlers, broken flows) draws on usability and ARIA authoring
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

// ── Fix dispatch ─────────────────────────────────────────────────────────────

/**
 * Which coding agent polishd found in the connected repo: the Claude Code
 * GitHub Action (a workflow using `anthropics/claude-code-action`), the
 * Copilot coding agent (assignable on the repo), or neither.
 */
export type PolishdDispatchAgent = "claude-code-action" | "copilot" | "none";

/**
 * How a filed issue would reach the agent. `comment`: the workflow listens
 * for comments, so polishd files the issue without the trigger phrase and
 * starts a fix later with a comment — a separate step, preferred whenever the
 * workflow allows it. `body`: it listens for new issues but not comments, so
 * the only way in is the trigger phrase in the body, at filing. `assign`: the
 * Copilot agent, which starts when the issue is assigned to it. `none`: the
 * workflow listens for neither, so nothing polishd files would start it.
 */
export type PolishdDispatchMode = "body" | "comment" | "assign" | "none";

/**
 * When a fix can start, as the plan allows. `separate`: on an issue already
 * filed, with Create fix (a comment, or an assignment). `on-filing`: only as
 * the issue is filed — File and fix puts the phrase in the body. `every-filing`:
 * the workflow runs in automation mode on every new issue, so filing is
 * starting a fix whether polishd asks or not. `none`: no agent can be reached.
 */
export type PolishdFixTrigger = "separate" | "on-filing" | "every-filing" | "none";

/**
 * How the Action authenticates, read from which input the step passes —
 * never from a value. A subscription token (`claude_code_oauth_token`) draws
 * on the plan's usage limits; an API key (`anthropic_api_key`) is metered
 * usage, covered by a Max or Team plan's monthly credit when linked.
 */
export type PolishdDispatchSecret = "oauth-token" | "api-key" | "both" | "unknown";

export type PolishdDispatchStatus =
  | "not-set-up"
  | "ready-claude"
  | "ready-copilot"
  | "needs-attention";

/** The plan polishd would follow when dispatching — the facts, not the prose. */
export interface PolishdDispatchPlan {
  agent: PolishdDispatchAgent;
  mode: PolishdDispatchMode;
  /** The phrase the workflow looks for. "@claude" unless the workflow says otherwise. */
  triggerPhrase: string;
  /** Repo path of the workflow the plan is built on, when there is one. */
  workflowPath?: string;
  /** The `@version` the step pins, e.g. "v1". */
  actionVersion?: string;
  secretKind: PolishdDispatchSecret;
  defaultBranch: string;
  /** Whether Copilot can be assigned too; null when the token couldn't ask. */
  copilotAssignable: boolean | null;
  /**
   * When a fix can start (see `PolishdFixTrigger`). Absent on plans stored
   * before fixes were dispatched; `fixTriggerOf` in dispatch-readiness.ts
   * reads those as their mode implies.
   */
  fixTrigger?: PolishdFixTrigger;
}

/** One read-only row of "What polishd found". */
export interface PolishdDispatchRow {
  label: string;
  value: string;
  /** The consequence, spelled out in a sentence. */
  detail?: string;
  tone: "ok" | "warn" | "bad" | "neutral";
}

/** Everything the card shows about the repo as it stands. */
export interface PolishdDispatchReadiness {
  status: PolishdDispatchStatus;
  plan: PolishdDispatchPlan;
  rows: PolishdDispatchRow[];
  /** Things that would stop a dispatch or make it do more than intended. */
  warnings: string[];
  /** Write access of the token's user; null when GitHub didn't say. */
  canWrite: boolean | null;
  /** Workflows that use the Action but weren't chosen for the plan. */
  otherWorkflows: string[];
}

/** The live test: one issue, filed and watched until the agent replies. */
export interface PolishdDispatchTest {
  issueNumber: number;
  issueUrl: string;
  startedAt: number;
  status: "running" | "passed" | "failed";
  agent: PolishdDispatchAgent;
  mode: PolishdDispatchMode;
  /** When the agent's reply was first seen. */
  repliedAt?: number;
  /** Login of the bot that replied. */
  replyFrom?: string;
  /** Why it failed, when it did. */
  reason?: "timeout" | "closed-elsewhere" | "unreadable" | "copilot-manual";
  /** When polishd closed the issue. Absent while running, or when it couldn't. */
  closedAt?: number;
  /** True when the issue is still open because polishd failed to close it. */
  leftOpen?: boolean;
}

/** What's stored about dispatch: the last check, and the last live test. */
export interface PolishdDispatchState {
  readiness: PolishdDispatchReadiness | null;
  checkedAt?: number;
  /** Why the last check failed, when it did. `readiness` is then the previous one. */
  checkError?: string;
  test?: PolishdDispatchTest;
}

/** Result of a readiness check. */
export type CheckDispatchResult =
  | { ok: true; state: PolishdDispatchState }
  | { ok: false; error: "not-connected" | "github-error"; message: string; state: PolishdDispatchState };

/** Result of starting or polling the live test. */
export type DispatchTestResult =
  | { ok: true; state: PolishdDispatchState }
  | {
      ok: false;
      error: "not-connected" | "not-checked" | "no-agent" | "github-error" | "no-test";
      message: string;
      state: PolishdDispatchState;
    };

// ── Fixes: the agent's run, and what GitHub says about an issue ─────────────

/**
 * What the agent concluded, from the verdict block the brief asks it to end
 * with. `fixed`: it changed the code. `not_real`: the code shows the finding
 * is wrong. `deliberate`: real, and intended. `infeasible`: real, but a proper
 * fix is bigger than one scoped pull request or needs a decision. `needs_info`:
 * it couldn't decide from the repository alone.
 */
export type PolishdAgentVerdictKind = "fixed" | "not_real" | "deliberate" | "infeasible" | "needs_info";

export interface PolishdAgentVerdict {
  verdict: PolishdAgentVerdictKind;
  /** The agent's one-line reason, sanitized and clipped. */
  reason: string;
  /** A pull request title it proposed, for one polishd opens from its branch. */
  title?: string;
  /** The branch it pushed, when it says. */
  branch?: string;
  /** The pull request it opened, when it says. */
  pr?: number;
  files: string[];
  /** When the comment carrying it was last written. */
  at: number;
}

/**
 * A pull request that references a filed issue, whoever opened it — the
 * agent, a teammate, polishd — as GitHub reports it now.
 */
export interface PolishdLinkedPull {
  number: number;
  title: string;
  url: string;
  state: "open" | "closed" | "merged";
  draft: boolean;
  author?: string;
  authorIsBot: boolean;
  /** Head branch. */
  branch?: string;
  /** Linked with a closing keyword ("Fixes #12"): merging it closes the issue. */
  closes: boolean;
  createdAt: number;
  updatedAt: number;
  mergedAt?: number;
}

/** One thing that happened on a filed issue, as its GitHub timeline lists it. */
export type PolishdIssueEvent =
  | {
      kind: "comment";
      at: number;
      author?: string;
      isBot: boolean;
      /** A coding agent's comment (a bot whose login names Claude or Copilot). */
      isAgent: boolean;
      /** One of polishd's own comments — a fix request. */
      fromPolishd: boolean;
      /** The comment as plain text, clipped for display. */
      text: string;
      url: string;
    }
  | { kind: "referenced"; at: number; actor?: string; pull: number; closes: boolean }
  | { kind: "closed"; at: number; actor?: string; reason?: string; byPull?: number }
  | { kind: "reopened"; at: number; actor?: string }
  | { kind: "assigned"; at: number; actor?: string; assignee?: string }
  | { kind: "labeled"; at: number; actor?: string; label: string };

/**
 * What GitHub says has happened on one filed issue since: the pull requests
 * that reference it and its recent timeline, plus what polishd reads out of
 * the agent's comments. Read fresh, never stored.
 */
export interface PolishdIssueThread {
  number: number;
  pulls: PolishdLinkedPull[];
  /** The most recent events, oldest first. */
  events: PolishdIssueEvent[];
  /** The newest verdict block among the agent's comments. */
  verdict?: PolishdAgentVerdict;
  /** The branch the agent's comments point at, when they do — from its first moments, work or not. */
  agentBranch?: string;
  /**
   * The fix the agent left ready: its "Create PR" link, which the Action only
   * writes once the branch has commits. `at` is when that comment was last
   * written, so a link from an earlier request isn't taken for this one's.
   */
  fixLink?: { branch: string; url: string; at: number };
}

/**
 * One fix polishd asked a coding agent for: when, how it was sent, and what
 * polishd itself did about the pull request since. Stored per issue number;
 * everything the agent did is read from GitHub (`PolishdIssueThread`).
 */
export interface PolishdFixRun {
  issueNumber: number;
  agent: Exclude<PolishdDispatchAgent, "none">;
  /** How it was sent: a comment, an assignment, or the phrase in the body at filing. */
  mode: Exclude<PolishdDispatchMode, "none">;
  requestedAt: number;
  /** Sent without a click: automatic dispatch, or a workflow that runs on every new issue. */
  auto?: boolean;
  /** The fix request comment, when there is one. */
  commentUrl?: string;
  /** The pull request Create PR opened from the agent's branch. */
  openedPull?: number;
  /** Agent pull requests Create PR added "Fixes #N" to, so they close the issue. */
  linkedPulls?: number[];
  /** What went wrong after the request was sent (an assignment that didn't take). */
  error?: string;
}

/**
 * Where a filed issue's fix stands, put together from the run (if polishd
 * sent one) and the thread (whoever did the work). Pure; see fix-status.ts.
 */
export type PolishdFixStage =
  | "requested" // sent; the agent hasn't answered
  | "working" // the agent answered, or opened a draft, and hasn't finished
  | "branch" // the agent left a fix on a branch and there's no pull request for it yet: Create PR
  | "pr-open"
  | "merged"
  | "pr-closed" // the pull request was closed without merging
  | "declined" // the agent's verdict: not real, deliberate, infeasible, or needs info
  | "stalled" // sent a while ago, and nothing came back
  | "failed"; // the request itself didn't take

export interface PolishdFixStatus {
  stage: PolishdFixStage;
  /** The pull request that carries the fix, when there is one. */
  pull?: PolishdLinkedPull;
  verdict?: PolishdAgentVerdict;
  /** A branch with no pull request yet. */
  branch?: string;
  run?: PolishdFixRun;
}

/** Result of asking for a fix. */
export type DispatchFixResult =
  | { ok: true; run: PolishdFixRun }
  | { ok: false; error: DispatchFixError; message: string };

export type DispatchFixError =
  | "not-connected"
  | "not-ready" // no agent the readiness check says could take it
  | "on-filing" // the workflow only hears new issues; a fix can't start later
  | "paused"
  | "cap" // the daily cap is spent
  | "not-found" // not an issue polishd filed
  | "closed" // the issue is closed
  | "in-flight" // a fix is already running, or a pull request is open
  | "github-error";

/** Result of reading fixes and threads, or of Create PR. */
export type RefreshFixesResult =
  | {
      ok: true;
      runs: Record<number, PolishdFixRun>;
      threads: Record<number, PolishdIssueThread>;
      /** Set when the threads couldn't be read; the runs are as stored. */
      threadError?: string;
    }
  | { ok: false; message: string };
