/**
 * Polishd — loss → verified GitHub issue (server only).
 *
 * A loss in the summary is a claim made from analytics data. Before it becomes
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
 * re-investigated nor re-filed.
 */
import { getMeta, setMeta } from "../server/store";
import {
  createGithubIssue,
  getGithubStatus,
  isGithubConnected,
  readGithubFile,
  searchGithubCode,
} from "./github";
import { loadProjectProfile } from "./profile";
import { callModel } from "./providers";
import { resolveSettings } from "./settings";
import type { PolishdLossItem, CreateIssueResult } from "./types";

/** The slice of a loss the pipeline needs. */
type Loss = Pick<PolishdLossItem, "issue" | "evidence" | "location">;

// ── Issue log (dedupe) ───────────────────────────────────────────────────────

const ISSUE_LOG_KEY = "github_issue_log";

/** Per-evidence outcome: a filed issue, or a rejection we won't re-litigate. */
type LogEntry =
  | { url: string; number: number }
  | { rejected: true; reason: string };

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

const INVESTIGATE_PROMPT =
  "You are a senior engineer verifying a suspected bug before it enters the " +
  "issue tracker. A product-analytics tool watched real users interact with a " +
  "website and flagged a suspected problem. You receive that suspicion, the " +
  "analytics identifier cited as evidence (a page path, CSS selector, or " +
  "component name), and source files from the site's repository.\n\n" +
  "Decide whether the problem is technically real in this code. Respond with " +
  "ONLY a JSON object (no markdown fences, no preamble):\n" +
  '{ "verdict": "confirmed" | "rejected" | "inconclusive", "title": string, ' +
  '"details": string, "fixes": string[], "reasoning": string }\n\n' +
  "verdict: confirmed ONLY when you can point to specific code that explains " +
  "or exhibits the problem. rejected ONLY when the code demonstrates the " +
  "report cannot be right (the interaction is handled correctly, the behavior " +
  "is clearly intentional). inconclusive when the source provided is not " +
  "enough to decide either way.\n" +
  "title: a short, specific bug title (under 80 characters) — becomes the " +
  "GitHub issue title when confirmed.\n" +
  "details: the technical root-cause analysis, citing the file paths and the " +
  "relevant code. Written for the developer who will fix it.\n" +
  "fixes: 1-3 concrete, code-level suggestions for fixing it.\n" +
  "reasoning: one or two sentences on how you reached the verdict — shown to " +
  "the site owner when the report is rejected or unverifiable.";

/** Terms specific enough to search code for (same spirit as citationTokens). */
function searchTerms(evidence: string): string[] {
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
 * Gather the source files that should contain the answer: the file the loss
 * was already matched to, then code-search hits for the evidence.
 */
async function collectSource(
  loss: Loss,
): Promise<{ path: string; content: string }[]> {
  const paths: string[] = [];
  if (loss.location) paths.push(loss.location);
  for (const p of await searchGithubCode(searchTerms(loss.evidence), MAX_FILES)) {
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
 * Verify one loss against the repository's source. Never throws — anything
 * that prevents a real verdict (no source found, model unavailable) comes back
 * as inconclusive so the caller can still file a plain, unverified report.
 */
async function investigateLoss(loss: Loss): Promise<Investigation> {
  const { settings } = await resolveSettings();
  if (!settings.apiKey) {
    return {
      verdict: "inconclusive",
      fixes: [],
      reasoning: "No model is configured to verify against the source.",
      files: [],
    };
  }

  const files = await collectSource(loss);
  if (files.length === 0) {
    return {
      verdict: "inconclusive",
      fixes: [],
      reasoning: "No source files mentioning the cited element were found in the repository.",
      files: [],
    };
  }

  const profile = await loadProjectProfile();
  const sections = [
    "SUSPECTED PROBLEM (from analytics):",
    loss.issue,
    "",
    `EVIDENCE (identifier from the analytics data): ${loss.evidence}`,
  ];
  if (profile) {
    sections.push("", `PROJECT PROFILE (what this site and its components are):\n${profile.text}`);
  }
  sections.push(
    "",
    "SOURCE FILES (from the GitHub repository):",
    ...files.map((f) => `--- ${f.path} ---\n${f.content}`),
  );

  try {
    const reply = await callModel(settings, INVESTIGATE_PROMPT, sections.join("\n"));
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
  loss: Loss,
  inv: Investigation,
  fileUrl: (path: string) => string,
): string {
  const lines = [loss.issue, "", `**Evidence (from analytics):** \`${loss.evidence}\``];
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
    if (loss.location) lines.push("", `**Possible source:** [\`${loss.location}\`](${fileUrl(loss.location)})`);
  }
  lines.push(
    "",
    "---",
    inv.verdict === "confirmed"
      ? "_Filed from the Polishd analytics dashboard — observed in real user-behavior data and confirmed against the source code._"
      : "_Filed from the Polishd analytics dashboard — observed in real user-behavior data._",
  );
  return lines.join("\n");
}

/**
 * File a bug from one loss — after verifying it against the source (see the
 * module doc for the pipeline). Returns the issue on success, the stored issue
 * when this evidence was already filed, or `not-a-bug` with the verdict's
 * reasoning when the code disproves the report.
 */
export async function createIssueFromLoss(loss: Loss): Promise<CreateIssueResult> {
  if (!(await isGithubConnected())) {
    return {
      ok: false,
      error: "not-connected",
      message: "Connect a GitHub repository in the settings first.",
    };
  }

  const key = issueKey(loss.evidence);
  const existing = (await loadIssueLog())[key];
  if (existing) {
    if ("rejected" in existing) {
      return { ok: false, error: "not-a-bug", message: existing.reason };
    }
    return { ok: true, ...existing };
  }

  const inv = await investigateLoss(loss);
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
      title: (inv.verdict === "confirmed" && inv.title) || loss.issue,
      body: issueBody(loss, inv, fileUrl),
      labels: ["bug"],
    });
    await recordLog(key, issue);
    return { ok: true, url: issue.url, number: issue.number };
  } catch (err) {
    return {
      ok: false,
      error: "github-error",
      message: err instanceof Error ? err.message : "Could not create the issue.",
    };
  }
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
