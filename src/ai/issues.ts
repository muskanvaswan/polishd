/**
 * Polishd — model finding → verified GitHub issue (server only).
 *
 * A loss in the summary is a claim made from analytics data; a design-review
 * issue is a claim made from the measured design system. Before either becomes
 * a bug in the tracker, this module makes it earn that status:
 *
 *   1. Pull the relevant source from the connected GitHub repo — the file the
 *      citation was matched to, plus code-search hits for the evidence.
 *   2. Ask the model for a technical verdict against that code: confirmed
 *      (specific code explains the problem), rejected (the code proves the
 *      report wrong), or inconclusive (not enough source to decide).
 *   3. Rejected → no issue; the verdict's reasoning is surfaced to the owner.
 *      Confirmed → an issue with a precise title, the technical analysis, and
 *      suggested fixes. Inconclusive → the plain analytics-only issue, marked
 *      as unverified, so a search hiccup never blocks a real report.
 *
 * Verdicts and filed issues are logged per evidence citation, so the same
 * problem — refound by a regenerated summary or clicked twice — is neither
 * re-investigated nor re-filed. That log is also what the dashboard's Issues
 * tab reads: `listFiledIssues` joins it to the live issues on GitHub.
 */
import { getMeta, setMeta } from "../server/store";
import {
  createGithubIssue,
  getGithubStatus,
  isGithubConnected,
  readGithubFile,
  readGithubIssues,
  searchGithubCode,
} from "./github";
import { loadProjectProfile } from "./profile";
import { callModel } from "./providers";
import { resolveSettings } from "./settings";
import type {
  PolishdDesignIssue,
  PolishdFiledIssue,
  PolishdLossItem,
  CreateIssueResult,
} from "./types";

/** The slice of a summary loss the pipeline needs. */
type Loss = Pick<PolishdLossItem, "issue" | "evidence" | "location">;

/** The slice of a design-review issue the pipeline needs. */
type DesignIssue = Pick<PolishdDesignIssue, "issue" | "evidence" | "suggestion">;

/**
 * One suspected problem, whichever tab reported it. `kind` steers the
 * verification prompt and the filed issue's wording: a loss is a claim about
 * user behavior, a design issue is a claim about the rendered design system.
 */
type Report = {
  kind: "loss" | "design";
  issue: string;
  evidence: string;
  /** Source file the citation was matched to (losses only). */
  location?: string;
  /** The review's own suggested fix (design issues only). */
  suggestion?: string;
};

// ── Issue log (dedupe) ───────────────────────────────────────────────────────

const ISSUE_LOG_KEY = "github_issue_log";

/**
 * Per-evidence outcome: a filed issue, or a rejection we won't re-litigate.
 *
 * The filed half carries the context GitHub can't tell us later — the
 * analytics claim it came from, the verdict that let it through, when we filed
 * it — because that's what makes the Issues tab more than a copy of the
 * tracker. Every one of those fields is optional: entries written by earlier
 * versions have only the url and the number, and still read fine.
 */
type FiledEntry = {
  url: string;
  number: number;
  /** The problem as the summary stated it. */
  issue?: string;
  /** Whether the source verified the report before it was filed. */
  verdict?: "confirmed" | "inconclusive";
  /** When it was filed, ms since epoch. */
  filedAt?: number;
};

type LogEntry = FiledEntry | { rejected: true; reason: string };

type IssueLog = Record<string, LogEntry>;

function issueKey(evidence: string): string {
  return evidence.trim().toLowerCase();
}

async function loadIssueLog(): Promise<IssueLog> {
  const raw = await getMeta(ISSUE_LOG_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as IssueLog;
  } catch {
    return {};
  }
}

async function recordLog(key: string, entry: LogEntry): Promise<void> {
  const log = await loadIssueLog();
  log[key] = entry;
  await setMeta(ISSUE_LOG_KEY, JSON.stringify(log));
}

// ── Investigation ────────────────────────────────────────────────────────────

const MAX_FILES = 4;
const MAX_CHARS_PER_FILE = 8_000;

interface Investigation {
  verdict: "confirmed" | "rejected" | "inconclusive";
  /** Precise bug title, when confirmed. */
  title?: string;
  /** Technical root-cause analysis, citing files. */
  details?: string;
  /** 1-3 concrete fix suggestions. */
  fixes: string[];
  /** How the verdict was reached — shown to the owner on rejection. */
  reasoning: string;
  /** Repo paths that were examined. */
  files: string[];
}

const INVESTIGATE_FORMAT =
  "Decide whether the problem is technically real in this code. Respond with " +
  "ONLY a JSON object (no markdown fences, no preamble):\n" +
  '{ "verdict": "confirmed" | "rejected" | "inconclusive", "title": string, ' +
  '"details": string, "fixes": string[], "reasoning": string }\n\n' +
  "verdict: confirmed ONLY when you can point to specific code that explains " +
  "or exhibits the problem. rejected ONLY when the code demonstrates the " +
  "report cannot be right (the code handles it correctly, or the flagged " +
  "behavior is clearly deliberate). inconclusive when the source provided is " +
  "not enough to decide either way.\n" +
  "title: a short, specific bug title (under 80 characters) — becomes the " +
  "GitHub issue title when confirmed.\n" +
  "details: the technical root-cause analysis, citing the file paths and the " +
  "relevant code. Written for the developer who will fix it.\n" +
  "fixes: 1-3 concrete, code-level suggestions for fixing it.\n" +
  "reasoning: one or two sentences on how you reached the verdict — shown to " +
  "the site owner when the report is rejected or unverifiable.";

/**
 * The local record behind one filed issue number — the citation and claim
 * GitHub was never told. The fix pipeline (`fix.ts`) uses it to search the
 * source for the right element, and its absence is how a number that isn't
 * ours gets refused.
 */
export async function findFiledIssue(
  number: number,
): Promise<{ evidence: string; claim?: string } | null> {
  for (const [evidence, entry] of Object.entries(await loadIssueLog())) {
    if (!("rejected" in entry) && entry.number === number) {
      return { evidence, claim: entry.issue };
    }
  }
  return null;
}

const INVESTIGATE_PROMPTS: Record<Report["kind"], string> = {
  loss:
    "You are a senior engineer verifying a suspected bug before it enters the " +
    "issue tracker. A product-analytics tool watched real users interact with a " +
    "website and flagged a suspected problem. You receive that suspicion, the " +
    "analytics identifier cited as evidence (a page path, CSS selector, or " +
    "component name), and source files from the site's repository.\n\n" +
    INVESTIGATE_FORMAT,
  design:
    "You are a senior engineer verifying a suspected design flaw before it " +
    "enters the issue tracker. A design audit measured a website's rendered " +
    "pages — the typography, colors, radii and spacing actually shipped — and " +
    "flagged something breaking the design system. You receive that finding, " +
    "the design token cited as evidence (a hex color, a px value, or a page " +
    "path), and source files from the site's repository.\n\n" +
    INVESTIGATE_FORMAT,
};

/** Terms specific enough to search code for (same spirit as citationTokens). */
export function evidenceSearchTerms(evidence: string): string[] {
  return [
    ...new Set(
      evidence
        .split(/[^\w-]+/)
        .filter(
          (t) =>
            t.length >= 4 &&
            !/^(button|input|click|clicks|page|pages|http|https|with|from|that|div|span)$/i.test(t),
        ),
    ),
  ].slice(0, 3);
}

/**
 * Gather the source files that should contain the answer: the file the report
 * was already matched to, then code-search hits for the evidence.
 */
async function collectSource(
  report: Report,
): Promise<{ path: string; content: string }[]> {
  const paths: string[] = [];
  if (report.location) paths.push(report.location);
  for (const p of await searchGithubCode(evidenceSearchTerms(report.evidence), MAX_FILES)) {
    if (!paths.includes(p)) paths.push(p);
  }
  const out: { path: string; content: string }[] = [];
  for (const path of paths.slice(0, MAX_FILES)) {
    const content = await readGithubFile(path);
    if (content) out.push({ path, content: content.slice(0, MAX_CHARS_PER_FILE) });
  }
  return out;
}

/** Tolerant JSON extraction, same approach as the summary parser. */
function parseInvestigation(text: string, files: string[]): Investigation {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const obj = JSON.parse(t.slice(start, end + 1)) as Record<string, unknown>;
      const verdict =
        obj.verdict === "confirmed" || obj.verdict === "rejected"
          ? obj.verdict
          : "inconclusive";
      return {
        verdict,
        title: typeof obj.title === "string" ? obj.title.trim() || undefined : undefined,
        details:
          typeof obj.details === "string" ? obj.details.trim() || undefined : undefined,
        fixes: Array.isArray(obj.fixes)
          ? obj.fixes
              .filter((f): f is string => typeof f === "string" && f.trim().length > 0)
              .slice(0, 3)
          : [],
        reasoning:
          typeof obj.reasoning === "string" && obj.reasoning.trim()
            ? obj.reasoning.trim()
            : "The model returned no reasoning.",
        files,
      };
    } catch {
      /* fall through */
    }
  }
  return {
    verdict: "inconclusive",
    fixes: [],
    reasoning: "The model's verdict could not be parsed.",
    files,
  };
}

/**
 * Verify one report against the repository's source. Never throws — anything
 * that prevents a real verdict (no source found, model unavailable) comes back
 * as inconclusive so the caller can still file a plain, unverified report.
 */
async function investigate(report: Report): Promise<Investigation> {
  const { settings } = await resolveSettings();
  if (!settings.apiKey) {
    return {
      verdict: "inconclusive",
      fixes: [],
      reasoning: "No model is configured to verify against the source.",
      files: [],
    };
  }

  const files = await collectSource(report);
  if (files.length === 0) {
    return {
      verdict: "inconclusive",
      fixes: [],
      reasoning: "No source files mentioning the cited element were found in the repository.",
      files: [],
    };
  }

  const profile = await loadProjectProfile();
  const sections =
    report.kind === "design"
      ? [
          "SUSPECTED PROBLEM (from the design audit):",
          report.issue,
          "",
          `EVIDENCE (design token measured on the rendered pages): ${report.evidence}`,
        ]
      : [
          "SUSPECTED PROBLEM (from analytics):",
          report.issue,
          "",
          `EVIDENCE (identifier from the analytics data): ${report.evidence}`,
        ];
  if (report.suggestion) {
    sections.push("", `SUGGESTED FIX (from the design review): ${report.suggestion}`);
  }
  if (profile) {
    sections.push("", `PROJECT PROFILE (what this site and its components are):\n${profile.text}`);
  }
  sections.push(
    "",
    "SOURCE FILES (from the GitHub repository):",
    ...files.map((f) => `--- ${f.path} ---\n${f.content}`),
  );

  try {
    const reply = await callModel(settings, INVESTIGATE_PROMPTS[report.kind], sections.join("\n"));
    if (!reply.text) throw new Error("empty response");
    return parseInvestigation(
      reply.text,
      files.map((f) => f.path),
    );
  } catch (err) {
    return {
      verdict: "inconclusive",
      fixes: [],
      reasoning: `Verification failed: ${err instanceof Error ? err.message : "model error"}.`,
      files: files.map((f) => f.path),
    };
  }
}

// ── Filing ───────────────────────────────────────────────────────────────────

/** Markdown body for a filed issue, sized to the verdict behind it. */
function issueBody(
  report: Report,
  inv: Investigation,
  fileUrl: (path: string) => string,
): string {
  const evidenceLabel = report.kind === "design" ? "from the design audit" : "from analytics";
  const lines = [report.issue, "", `**Evidence (${evidenceLabel}):** \`${report.evidence}\``];
  if (report.suggestion) {
    lines.push("", `**Suggested fix (from the design review):** ${report.suggestion}`);
  }
  if (inv.verdict === "confirmed") {
    if (inv.details) lines.push("", "## Technical analysis", inv.details);
    if (inv.files.length) {
      lines.push(
        "",
        "**Verified against:**",
        ...inv.files.map((p) => `- [\`${p}\`](${fileUrl(p)})`),
      );
    }
    if (inv.fixes.length) {
      lines.push("", "## Suggested fixes", ...inv.fixes.map((f) => `- ${f}`));
    }
  } else {
    lines.push(
      "",
      `> **Note:** source verification was inconclusive — ${inv.reasoning}`,
    );
    if (report.location) lines.push("", `**Possible source:** [\`${report.location}\`](${fileUrl(report.location)})`);
  }
  const source = report.kind === "design" ? "design review" : "analytics dashboard";
  const observed =
    report.kind === "design"
      ? "measured on the site's rendered pages"
      : "observed in real user-behavior data";
  lines.push(
    "",
    "---",
    inv.verdict === "confirmed"
      ? `_Filed from the Polishd ${source} — ${observed} and confirmed against the source code._`
      : `_Filed from the Polishd ${source} — ${observed}._`,
  );
  return lines.join("\n");
}

/**
 * File a bug from one report — after verifying it against the source (see the
 * module doc for the pipeline). Returns the issue on success, the stored issue
 * when this evidence was already filed, or `not-a-bug` with the verdict's
 * reasoning when the code disproves the report.
 */
async function fileReport(report: Report): Promise<CreateIssueResult> {
  if (!(await isGithubConnected())) {
    return {
      ok: false,
      error: "not-connected",
      message: "Connect a GitHub repository in the settings first.",
    };
  }

  const key = issueKey(report.evidence);
  const existing = (await loadIssueLog())[key];
  if (existing) {
    if ("rejected" in existing) {
      return { ok: false, error: "not-a-bug", message: existing.reason };
    }
    return { ok: true, url: existing.url, number: existing.number };
  }

  const inv = await investigate(report);
  if (inv.verdict === "rejected") {
    await recordLog(key, { rejected: true, reason: inv.reasoning });
    return { ok: false, error: "not-a-bug", message: inv.reasoning };
  }

  try {
    const status = await getGithubStatus();
    const fileUrl = (path: string) =>
      status
        ? `https://github.com/${status.repo}/blob/${status.defaultBranch}/${path}`
        : path;
    const issue = await createGithubIssue({
      title: (inv.verdict === "confirmed" && inv.title) || report.issue,
      body: issueBody(report, inv, fileUrl),
      labels: ["bug"],
    });
    await recordLog(key, {
      ...issue,
      issue: report.issue,
      verdict: inv.verdict,
      filedAt: Date.now(),
    });
    return { ok: true, url: issue.url, number: issue.number };
  } catch (err) {
    return {
      ok: false,
      error: "github-error",
      message: err instanceof Error ? err.message : "Could not create the issue.",
    };
  }
}

/** File a bug from one summary loss. */
export async function createIssueFromLoss(loss: Loss): Promise<CreateIssueResult> {
  return fileReport({ ...loss, kind: "loss" });
}

/**
 * File a bug from one design-review issue — the same verify-then-file pipeline
 * with the design framing: the evidence is a measured design token rather than
 * an analytics identifier, so verification searches the source for wherever
 * that value is produced.
 */
export async function createIssueFromDesignIssue(
  issue: DesignIssue,
): Promise<CreateIssueResult> {
  return fileReport({ ...issue, kind: "design" });
}

/**
 * Attach already-filed GitHub issues to a design review's issues, keyed by the
 * evidence citation — read-only decoration for the Design tab, so a problem
 * that's already in the tracker renders as its issue link instead of a "file
 * bug" button. Never files anything.
 */
export async function attachGithubIssuesToDesignIssues(
  issues: PolishdDesignIssue[],
): Promise<PolishdDesignIssue[]> {
  if (issues.length === 0) return issues;
  const log = await loadIssueLog();
  return issues.map((iss) => {
    const entry = log[issueKey(iss.evidence)];
    return entry && "url" in entry
      ? { ...iss, issueUrl: entry.url, issueNumber: entry.number }
      : iss;
  });
}

/**
 * Decorate a fresh summary's losses with their GitHub issues: attach the link
 * for anything already filed and — when the owner enabled auto-filing — run
 * the verify-and-file pipeline on the new ones. Losses whose report the code
 * disproved are skipped (and remembered, so they aren't re-investigated).
 * Never throws; a hiccup just leaves a loss undecorated, with the manual
 * "file bug" button as the fallback.
 */
export async function attachGithubIssues(losses: PolishdLossItem[]): Promise<PolishdLossItem[]> {
  if (losses.length === 0) return losses;
  const { settings } = await resolveSettings();
  if (!(await isGithubConnected())) return losses;

  const out: PolishdLossItem[] = [];
  for (const loss of losses) {
    // Re-read per loss: auto-filing above may have just written new entries.
    let entry = (await loadIssueLog())[issueKey(loss.evidence)];
    if (!entry && settings.githubAutoIssues) {
      const res = await createIssueFromLoss(loss);
      if (res.ok) entry = { url: res.url, number: res.number };
    }
    out.push(
      entry && "url" in entry
        ? { ...loss, issueUrl: entry.url, issueNumber: entry.number }
        : loss,
    );
  }
  return out;
}

// ── Listing (the Issues tab) ─────────────────────────────────────────────────

/**
 * How many filed issues the tab hydrates from GitHub. A log longer than this
 * keeps its newest entries. It matches GitHub's page size on purpose: that's
 * how many `readGithubIssues` can answer for in a single API call.
 */
const MAX_LISTED = 100;

/**
 * Newest first, by whatever the entry knows about its own age. Entries from
 * before `filedAt` existed fall behind the dated ones and order among
 * themselves by issue number, which is chronological within a repo.
 */
function newestFirst(a: FiledEntry, b: FiledEntry): number {
  return (b.filedAt ?? 0) - (a.filedAt ?? 0) || b.number - a.number;
}

/**
 * Every issue polishd has filed in the connected repo, newest first, each one
 * joined to its live state on GitHub.
 *
 * The log is the source of truth for *which* issues are ours — the repo's own
 * issue list is full of everyone else's — and GitHub is the source of truth
 * for everything about them since: title edits, labels, comments, whether
 * someone closed it. An issue that can't be read comes back with a null
 * `detail` rather than disappearing, so a deleted or transferred issue is
 * visible as exactly that. Returns [] when nothing is connected.
 */
export async function listFiledIssues(): Promise<PolishdFiledIssue[]> {
  if (!(await isGithubConnected())) return [];

  const filed = Object.entries(await loadIssueLog())
    .flatMap(([evidence, entry]) =>
      "rejected" in entry ? [] : [{ evidence, entry }],
    )
    .sort((a, b) => newestFirst(a.entry, b.entry))
    .slice(0, MAX_LISTED);

  const details = await readGithubIssues(filed.map((f) => f.entry.number));

  return filed
    .map(({ evidence, entry }) => ({
      evidence,
      claim: entry.issue,
      verdict: entry.verdict,
      filedAt: entry.filedAt,
      number: entry.number,
      url: entry.url,
      detail: details.get(entry.number) ?? null,
    }))
    // GitHub's `created_at` beats our own record of when we filed: it's the
    // same moment, but every issue has it, including the ones logged before
    // `filedAt` existed.
    .sort(
      (a, b) =>
        (b.detail?.createdAt ?? b.filedAt ?? b.number) -
        (a.detail?.createdAt ?? a.filedAt ?? a.number),
    );
}
