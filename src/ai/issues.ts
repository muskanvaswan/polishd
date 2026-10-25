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
import { detectionFor } from "../dashboard/fix-prompt";
import { getDesignData } from "../server/design";
import { listSnapshots } from "../server/snapshots";
import { designUsagesFor, usageFacts, whereItRendersMarkdown } from "../shared/design-evidence";
import {
  createGithubIssue,
  findRecentGithubIssue,
  getGithubStatus,
  isGithubConnected,
  readGithubFile,
  readGithubIssues,
  searchGithubCode,
} from "./github";
import { dispatchFix, prepareFixAtFiling } from "./fix-dispatch";
import { FILED_FOOTER, evidenceLine, filedFor } from "./issue-marker";
import { issueKey, loadIssueLog, recordLog, type FiledEntry } from "./issue-log";
import { loadProjectProfile } from "./profile";
import { callModel } from "./providers";
import { resolveSettings } from "./settings";
import type {
  PolishdDesignIssue,
  PolishdDesignUsage,
  PolishdFiledIssue,
  PolishdLossItem,
  CreateIssueResult,
} from "./types";

/**
 * The slice of a summary loss the pipeline needs. `signalKind` is the
 * analytics signal behind it ("dead_click"…), looked up server-side, which
 * says how it was detected — and so what the fix brief tells the agent to
 * rule out first.
 */
type Loss = Pick<PolishdLossItem, "issue" | "evidence" | "location"> & { signalKind?: string };

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
  /** The analytics signal behind it (losses only). */
  signalKind?: string;
  /** The review's own suggested fix (design issues only). */
  suggestion?: string;
  /**
   * Where the cited values render (design issues only): the facts behind each
   * color, size or padding and its picture, when a snapshot took one. Looked
   * up here from the current measurements, never taken from the browser.
   */
  usages?: PolishdDesignUsage[];
};

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
            // Tags and the `data-component` attribute name lead selectors and
            // handles (`section[data-component="hero"]>div.cta`) but match
            // every file; the component name and classes after them don't.
            !/^(button|input|click|clicks|page|pages|http|https|with|from|that|div|span|data-component|section|main|article|header|footer|aside|form|label|svg|path|img)$/i.test(t),
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
  if (report.usages?.length) {
    // Where the value is set is the question; these say how widely and how.
    sections.push(
      "",
      "WHERE IT RENDERS (measured on the site's pages):",
      ...report.usages.map((u) => `- ${u.label}: ${usageFacts(u)}`),
    );
    if (report.usages.some((u) => u.handTyped)) {
      sections.push(
        "(hand-typed: written as a Tailwind arbitrary value such as text-[#555] or p-[13px], not a theme token)",
      );
    }
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

/**
 * What anyone picking the issue up — a developer, or the coding agent asked
 * to fix it — should do before changing code: find what renders the
 * evidence, rule out the detector's blind spot, and keep the change to this
 * problem. The full brief (fix-brief.ts) arrives with the fix request; this
 * is the part that belongs to the issue itself.
 */
function beforeFixing(report: Report, inv: Investigation): string[] {
  const blindSpot = detectionFor({
    source: report.kind === "design" ? "design" : "analytics",
    issue: report.issue,
    signalKind: report.signalKind,
  });
  return [
    "",
    "## Before fixing",
    `- Find the code that renders the evidence above${inv.verdict === "confirmed" && inv.files.length ? " — the files it was verified against are the place to start" : ""}.`,
    ...blindSpot.map((line) => `- Confirm it's real. ${line}`),
    ...(blindSpot.length ? [] : ["- Confirm it's real: reproduce it, or show it from the code."]),
    "- If it isn't real, or it's deliberate, close this issue with the reason rather than changing code to match the report.",
    "- Keep the fix to this problem; a pull request that fixes it should say `Fixes` and this issue's number, so merging it closes this.",
  ];
}

/**
 * Markdown body for a filed issue, sized to the verdict behind it. `brief`
 * is the fix request, when filing is what starts the agent (a workflow that
 * only hears new issues): it goes last, after the footer, under a rule.
 */
function issueBody(
  report: Report,
  inv: Investigation,
  fileUrl: (path: string) => string,
  brief?: string,
): string {
  const lines = [report.issue, "", evidenceLine(report)];
  if (report.suggestion) {
    lines.push("", `**Suggested fix (from the design review):** ${report.suggestion}`);
  }
  // A design report shows where its values render — pictures where GitHub
  // can fetch them, the facts either way (shared/design-evidence.ts).
  lines.push(...whereItRendersMarkdown(report.usages));
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
  lines.push(...beforeFixing(report, inv));
  const source = report.kind === "design" ? "design review" : "analytics dashboard";
  const observed =
    report.kind === "design"
      ? "measured on the site's rendered pages"
      : "observed in real user-behavior data";
  lines.push(
    "",
    "---",
    inv.verdict === "confirmed"
      ? `${FILED_FOOTER}${source} — ${observed} and confirmed against the source code._`
      : `${FILED_FOOTER}${source} — ${observed}._`,
  );
  if (brief) lines.push("", "---", "", brief);
  return lines.join("\n");
}

/** How a filing may start a fix. */
export interface FileOptions {
  /**
   * File and fix: start the agent as the issue is filed. Only a workflow that
   * hears new issues and not comments needs this — anywhere else a fix is a
   * separate Create fix, and this is ignored.
   */
  startFix?: boolean;
}

/**
 * File a bug from one report — after verifying it against the source (see the
 * module doc for the pipeline). Returns the issue on success, the stored issue
 * when this evidence was already filed, or `not-a-bug` with the verdict's
 * reasoning when the code disproves the report.
 *
 * Filing never starts a fix on its own unless the workflow makes it: the
 * body carries no trigger phrase. A fix rides on the filing only for File
 * and fix (or automatic dispatch) under a workflow that hears new issues
 * only, and always under one in automation mode, which runs on every new
 * issue regardless. With automatic dispatch on and a workflow that hears
 * comments, a verified filing is followed straight away by Create fix.
 */
async function fileReport(report: Report, opts: FileOptions = {}): Promise<CreateIssueResult> {
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

  // An earlier attempt may have created the issue without us hearing back
  // (the request failed after GitHub acted on it). Find it before filing again.
  const earlier = await findRecentGithubIssue((i) => filedFor(report, i.body));
  if (earlier) {
    await recordLog(key, {
      url: earlier.url,
      number: earlier.number,
      issue: report.issue,
      filedAt: earlier.createdAt,
    });
    return { ok: true, url: earlier.url, number: earlier.number };
  }

  const inv = await investigate(report);
  if (inv.verdict === "rejected") {
    await recordLog(key, { rejected: true, reason: inv.reasoning });
    return { ok: false, error: "not-a-bug", message: inv.reasoning };
  }

  // Automatic dispatch only hands over what the source confirmed; File and
  // fix is the owner's call either way.
  const { settings } = await resolveSettings();
  const autoFix = settings.dispatchAuto === true && inv.verdict === "confirmed";
  const atFiling = await prepareFixAtFiling({
    want: opts.startFix === true || autoFix,
    source: report.kind,
    evidence: report.evidence,
    claim: report.issue,
    signalKind: report.signalKind,
    verified: inv.verdict,
  });

  let issue: { url: string; number: number };
  try {
    const status = await getGithubStatus();
    const fileUrl = (path: string) =>
      status
        ? `https://github.com/${status.repo}/blob/${status.defaultBranch}/${path}`
        : path;
    const created = await createGithubIssue({
      title: (inv.verdict === "confirmed" && inv.title) || report.issue,
      body: issueBody(report, inv, fileUrl, atFiling.start ? atFiling.brief : undefined),
      labels: atFiling.start ? ["bug", atFiling.label] : ["bug"],
    });
    issue = { url: created.url, number: created.number };
    await recordLog(key, {
      ...issue,
      issue: report.issue,
      verdict: inv.verdict,
      filedAt: Date.now(),
      source: report.kind,
      evidence: report.evidence,
      ...(report.signalKind ? { signalKind: report.signalKind } : {}),
    });
  } catch (err) {
    return {
      ok: false,
      error: "github-error",
      message: err instanceof Error ? err.message : "Could not create the issue.",
    };
  }

  // The issue exists; from here a fix that doesn't start is said, not thrown.
  if (atFiling.start) {
    return { ok: true, ...issue, fix: await atFiling.record(issue.number) };
  }
  if (atFiling.error) return { ok: true, ...issue, fixError: atFiling.error };
  if (autoFix) {
    const fix = await dispatchFix(issue.number, { auto: true });
    // Only a fix that was possible and didn't happen is worth a word; a
    // workflow that can't take separate fixes was answered above.
    if (fix.ok) return { ok: true, ...issue, fix: fix.run };
    if (fix.error !== "on-filing" && fix.error !== "not-ready") return { ok: true, ...issue, fixError: fix.message };
  }
  return { ok: true, ...issue };
}

/** File a bug from one summary loss. */
export async function createIssueFromLoss(loss: Loss, opts: FileOptions = {}): Promise<CreateIssueResult> {
  return fileReport({ ...loss, kind: "loss" }, opts);
}

/**
 * Where a design issue's cited values render, for its body and its
 * verification: looked up from the current measurements and snapshots, never
 * taken from the browser. An enrichment — a store that can't answer leaves
 * the filing to go ahead without it.
 */
async function designUsages(issue: DesignIssue): Promise<PolishdDesignUsage[]> {
  try {
    const [data, snapshots] = await Promise.all([getDesignData(), listSnapshots()]);
    return designUsagesFor(issue, data, snapshots);
  } catch {
    return [];
  }
}

/**
 * File a bug from one design-review issue — the same verify-then-file pipeline
 * with the design framing: the evidence is a measured design token rather than
 * an analytics identifier, so verification searches the source for wherever
 * that value is produced. The filed issue shows where the value renders — a
 * picture of the element carrying it when a snapshot took one that GitHub can
 * fetch, and the facts behind it either way.
 */
export async function createIssueFromDesignIssue(
  issue: DesignIssue,
  opts: FileOptions = {},
): Promise<CreateIssueResult> {
  return fileReport({ ...issue, kind: "design", usages: await designUsages(issue) }, opts);
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
      const res = await createIssueFromLoss({ ...loss, signalKind: loss.signal?.kind });
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
