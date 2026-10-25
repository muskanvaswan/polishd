/**
 * Polishd — what a coding agent is told when polishd asks it for a fix, and
 * what polishd reads back (pure).
 *
 * Create fix hands a filed issue to the agent the repo already runs — the
 * Claude Code GitHub Action, through a comment that starts with its trigger
 * phrase, or Copilot's coding agent, through a comment and an assignment.
 * The comment is the brief. It is written for an agent that can see the
 * source, which polishd's own model never fully could, so it doesn't ask for
 * a fix outright: it asks the agent to scope the problem, prove it real, and
 * judge whether one focused pull request can fix it — and to stop, changing
 * nothing, at the first of those that fails. The finding came from real
 * behaviour or real measurements, but a model read them; each detector's
 * blind spot is spelled out so the agent rules it out first.
 *
 * Then the pull request: its first line is `Fixes #N`, which is how GitHub
 * links it to the issue and closes the issue on merge. The Action pushes a
 * branch and leaves a "Create PR" link rather than opening one; that link is
 * what `fixLinkFromComment` reads, and what puts a Create PR button on the
 * actionable — `polishdPullBody` is the body of the pull request it opens,
 * and `withClosingReference` adds the line to an agent's pull request that
 * left it out.
 *
 * Last, a fenced JSON verdict, which `parseAgentVerdict` reads out of the
 * agent's comment so the Actionables tab can say "not real — the handler is
 * there" instead of "agent working" forever. Pure, so the wording and the
 * parsing are pinned by tests.
 */
import { detectionFor } from "../dashboard/fix-prompt";
import { BUG_CLASSES, type BugClass } from "./fix-practice";
import { isAgentLogin } from "./fix-status";
import type { PolishdAgentVerdict, PolishdAgentVerdictKind } from "./types";

/** The hidden line every fix request ends with, so polishd knows its own comments. */
export const FIX_REQUEST_MARKER = "<!-- polishd:fix-request -->";

export const AGENT_VERDICTS: readonly PolishdAgentVerdictKind[] = [
  "fixed",
  "not_real",
  "deliberate",
  "infeasible",
  "needs_info",
];

export type FixAgent = "claude-code-action" | "copilot";

export { isAgentLogin };

export function agentName(agent: FixAgent): string {
  return agent === "copilot" ? "Copilot" : "Claude";
}


export interface FixBriefInput {
  /**
   * The issue's number. Absent when the brief goes into the body of an issue
   * that doesn't exist yet (a workflow that only hears new issues): the
   * brief then says "this issue".
   */
  issueNumber?: number;
  agent: FixAgent;
  /** Put first, so the Action's `if:` hears it. Omitted for Copilot, which starts on assignment. */
  triggerPhrase?: string;
  /** Which review found it. */
  source: "loss" | "design";
  /** The citation it was found from. */
  evidence: string;
  /** The problem as the review stated it. */
  claim?: string;
  /** The analytics signal behind a loss ("dead_click"…), for its detector's blind spot. */
  signalKind?: string;
  /** Whether filing found code that explains it, or couldn't decide. */
  verified?: "confirmed" | "inconclusive";
  /** The branch pull requests go into. */
  defaultBranch: string;
}

/** Inline code that survives backticks in a citation copied from a page. */
function code(s: string): string {
  const longest = Math.max(0, ...(s.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longest + 1);
  const pad = longest > 0 || s.startsWith("`") || s.endsWith("`") ? " " : "";
  return `${fence}${pad}${s}${pad}${fence}`;
}

/**
 * The brief: the comment that asks for a fix, or — for a workflow that only
 * hears new issues — the part of the issue body that does.
 */
export function fixBrief(input: FixBriefInput): string {
  const n = input.issueNumber;
  const thisIssue = n ? `#${n}` : "this issue";
  const fixesLine = n ? `Fixes #${n}` : "Fixes #<this issue's number>";
  // The Action starts on its phrase, so it leads; Copilot starts on the
  // assignment that follows the comment, so the comment just names it.
  const addressee =
    input.agent === "copilot" ? "Copilot: " : input.triggerPhrase ? `${input.triggerPhrase} ` : "";
  const fromWhat =
    input.source === "design"
      ? "measurements of the pages as visitors' browsers rendered them"
      : "how real visitors used the live site";
  const verified =
    input.verified === "confirmed"
      ? "Before filing, polishd checked the report against this repository and found code that explains it — the issue's technical analysis says where. Check that reading; don't assume it."
      : input.verified === "inconclusive"
        ? "polishd couldn't confirm the report against the source before filing, so start from the evidence, not from any analysis in the issue."
        : "Start from the evidence, not from any analysis in the issue.";
  // Both kinds are offered — an analytics finding can be either — with the
  // one its source suggests first.
  const kinds: BugClass[] = input.source === "design" ? ["design", "interaction"] : ["interaction", "design"];
  const detection = detectionFor({
    source: input.source === "design" ? "design" : "analytics",
    issue: input.claim ?? "",
    signalKind: input.signalKind,
  });

  const lines = [
    `${addressee}polishd is asking you to fix ${thisIssue} — but only once you've confirmed it's real and can be fixed in one focused pull request.`,
    "",
    `polishd is the analytics and design-review tool installed in this app. It filed ${thisIssue} from ${fromWhat}, and a model read that data, so treat the report as a lead to check, not a fact. ${verified}`,
    "",
    `- Evidence: ${code(input.evidence.trim())}`,
    ...(input.claim?.trim() ? [`- Reported problem: ${input.claim.trim()}`] : []),
    "",
    "## Work in four steps, and stop at the first one that fails",
    "",
    `1. **Scope it.** Read ${n ? "the issue" : "this issue"} in full, then find the code responsible — the component, route, style or token that renders what the evidence names. Note the files. If nothing this repository renders matches the evidence, stop here: \`needs_info\`.`,
    `2. **Confirm it's real.** Reproduce it, or show it from the code.${detection.length ? " How it was detected, and what that can't see:" : ""}`,
    ...detection.map((d) => `   - ${d}`),
    "   If the code shows the report is wrong, stop: `not_real`. If it's real but clearly intended, stop: `deliberate`. Either way, change nothing.",
    "3. **Check it's feasible.** A fix belongs here only as one focused change: no new dependencies, no redesign, no edits to unrelated code, nothing that needs a product decision. If the proper fix is bigger than that, stop and say what it would take: `infeasible`.",
    "4. **Fix it.** First decide which kind of problem it is, and build the fix on the published practice for that kind:",
    ...kinds.map((k) => `   - *${k === "design" ? "Design" : "Interaction"}* — ${BUG_CLASSES[k].what}: lean on ${BUG_CLASSES[k].practice}.`),
    "   Make the smallest change that fixes the cause rather than the symptom. Reuse the site's existing components, tokens and scale instead of adding new values. Keep the build and existing tests passing, and add or update a test where this code has them. Check color changes in dark mode too, if the site has one.",
    "",
    "## The pull request",
    "",
    `- One pull request for ${thisIssue} alone, branched from ${code(input.defaultBranch)}.`,
    "- Title: `fix: <what changed>`, under 72 characters.",
    `- The body's first line is \`${fixesLine}\`, on its own — that's what links it to ${thisIssue} and closes it on merge.`,
    "- Then the root cause (file and line), what you changed and why — naming the guideline the fix follows — and how you verified it.",
    ...(input.agent === "claude-code-action"
      ? [`- If you can't open pull requests here, push the branch and say so: the pull request is opened from it, linked to ${thisIssue}, from polishd's dashboard.`]
      : []),
    "",
    "## End with a verdict",
    "",
    "Finish your reply with this block, filled in. polishd reads it back into its dashboard, so keep it valid JSON:",
    "",
    "```json",
    `{ "polishd_verdict": "${AGENT_VERDICTS.join(" | ")}", "reason": "One sentence: what you changed, or why you changed nothing.", "title": "fix: …", "branch": "the branch you pushed, or null", "pr": null, "files": ["path/you/changed/or/checked.tsx"] }`,
    "```",
    "",
    "`polishd_verdict` is exactly one of those five. `pr` is the number of the pull request you opened, or `null`. `files` lists what you changed, or what proves the verdict.",
    "",
    FIX_REQUEST_MARKER,
  ];
  return lines.join("\n");
}

// ── Reading the verdict back ─────────────────────────────────────────────────

const MAX_REASON = 400;
const MAX_TITLE = 120;
const MAX_FILES = 10;

/** One line of untrusted text, safe to show and to store. */
function clean(s: unknown, max: number): string {
  if (typeof s !== "string") return "";
  const t = s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** A branch name as git allows it, near enough. */
function cleanBranch(s: unknown): string | undefined {
  if (typeof s !== "string") return undefined;
  const t = s.trim();
  return /^[\w][\w./-]{0,199}$/.test(t) && !t.includes("..") ? t : undefined;
}

function toVerdict(obj: Record<string, unknown>, at: number): PolishdAgentVerdict | null {
  const kind = typeof obj.polishd_verdict === "string" ? obj.polishd_verdict.trim().toLowerCase() : "";
  if (!(AGENT_VERDICTS as readonly string[]).includes(kind)) return null;
  const pr = typeof obj.pr === "number" ? obj.pr : typeof obj.pr === "string" ? Number(obj.pr.replace(/^#/, "")) : NaN;
  const title = clean(obj.title, MAX_TITLE);
  return {
    verdict: kind as PolishdAgentVerdictKind,
    reason: clean(obj.reason, MAX_REASON),
    ...(title && title !== "fix: …" ? { title } : {}),
    ...(cleanBranch(obj.branch) ? { branch: cleanBranch(obj.branch) } : {}),
    ...(Number.isInteger(pr) && pr > 0 ? { pr } : {}),
    files: Array.isArray(obj.files)
      ? obj.files
          .map((f) => clean(f, 200))
          .filter((f) => f.length > 0)
          .slice(0, MAX_FILES)
      : [],
    at,
  };
}

function tryObject(raw: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(raw) as unknown;
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * The agent's verdict, from the last block in a comment that carries one: a
 * fenced block first, then a bare `{ … }` around the key for an agent that
 * dropped the fences. The brief's own template names all five verdicts in
 * one string, so it never parses as one. Null when there's none.
 */
export function parseAgentVerdict(body: string, at: number): PolishdAgentVerdict | null {
  const fenced = [...body.matchAll(/```[^\n`]*\n([\s\S]*?)```/g)].map((m) => m[1]);
  for (const raw of fenced.reverse()) {
    if (!raw.includes("polishd_verdict")) continue;
    const obj = tryObject(raw.trim());
    const v = obj && toVerdict(obj, at);
    if (v) return v;
  }
  const key = body.lastIndexOf('"polishd_verdict"');
  if (key < 0) return null;
  const open = body.lastIndexOf("{", key);
  const close = body.indexOf("}", key);
  if (open < 0 || close < 0) return null;
  const obj = tryObject(body.slice(open, close + 1));
  return obj ? toVerdict(obj, at) : null;
}

/**
 * The branch an agent's comment points at: the Action's tracking comment
 * links its branch (`/tree/<branch>`) and a "Create PR" compare link
 * (`/compare/<base>...<branch>`). One naming this issue wins; the default
 * branch never does.
 */
export function branchFromComment(
  body: string,
  opts: { issueNumber?: number; defaultBranch?: string } = {},
): string | undefined {
  const found: string[] = [];
  const add = (raw: string) => {
    let b: string;
    try {
      b = decodeURIComponent(raw);
    } catch {
      b = raw;
    }
    const clean = cleanBranch(b);
    if (clean && clean !== opts.defaultBranch && !found.includes(clean)) found.push(clean);
  };
  for (const m of body.matchAll(/github\.com\/[\w.-]+\/[\w.-]+\/compare\/[^\s)]*?\.\.\.([^\s)?#]+)/g)) add(m[1]);
  for (const m of body.matchAll(/github\.com\/[\w.-]+\/[\w.-]+\/tree\/([^\s)?#]+)/g)) add(m[1]);
  if (!found.length) return undefined;
  const n = opts.issueNumber;
  return (n ? found.find((b) => new RegExp(`(^|[/-])issue-${n}(-|$)`).test(b)) : undefined) ?? found[0];
}

/**
 * The fix an agent's comment says is ready: its "Create PR" link, a compare
 * link to the branch with the work on it. The Action writes that link only
 * once the branch has commits — the branch link it shows while it works is
 * no promise of a fix — so this, not `branchFromComment`, is what decides
 * there's a pull request to open.
 */
export function fixLinkFromComment(
  body: string,
  opts: { issueNumber?: number; defaultBranch?: string } = {},
): { branch: string; url: string } | undefined {
  const links: { branch: string; url: string }[] = [];
  for (const m of body.matchAll(/\[Create [^\]]*PR[^\]]*\]\((https?:\/\/[^\s)]+)\)/gi)) {
    const branch = branchFromComment(m[1], opts);
    if (branch) links.push({ branch, url: m[1] });
  }
  if (!links.length) return undefined;
  const n = opts.issueNumber;
  return (n ? links.find((l) => new RegExp(`(^|[/-])issue-${n}(-|$)`).test(l.branch)) : undefined) ?? links[0];
}

// ── Linking the pull request ─────────────────────────────────────────────────

const CLOSING =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b\s*:?\s+(?:https?:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/|([\w.-]+\/[\w.-]+)?#)(\d+)\b/gi;

/**
 * Whether a pull request body links the issue with a closing keyword — the
 * link GitHub shows under the issue's Development and acts on at merge.
 * A reference into another repository doesn't count; "Refs #12" doesn't
 * close anything.
 */
export function closesIssue(body: string, issueNumber: number, repo?: string): boolean {
  for (const m of body.matchAll(CLOSING)) {
    if (Number(m[3]) !== issueNumber) continue;
    const other = m[1] ?? m[2];
    if (!other || !repo || other.toLowerCase() === repo.toLowerCase()) return true;
  }
  return false;
}

/** The body with `Fixes #N` put first, or null when it already closes the issue. */
export function withClosingReference(body: string, issueNumber: number, repo?: string): string | null {
  if (closesIssue(body, issueNumber, repo)) return null;
  const rest = body.trim();
  return rest ? `Fixes #${issueNumber}\n\n${rest}` : `Fixes #${issueNumber}`;
}

/** The title of a pull request polishd opens from the agent's branch. */
export function polishdPullTitle(issueNumber: number, issueTitle: string, verdict?: PolishdAgentVerdict): string {
  if (verdict?.title) return verdict.title;
  if (!issueTitle.trim()) return `fix: #${issueNumber}`;
  const t = `fix: ${issueTitle.trim()}`;
  return t.length > 72 ? `${t.slice(0, 71).trimEnd()}…` : t;
}

/** The body of a pull request polishd opens from the agent's branch. */
export function polishdPullBody(input: {
  issueNumber: number;
  agent: FixAgent;
  branch: string;
  verdict?: PolishdAgentVerdict;
}): string {
  const lines = [`Fixes #${input.issueNumber}`, ""];
  if (input.verdict?.reason) lines.push(input.verdict.reason, "");
  if (input.verdict?.files.length) {
    lines.push(`**Files:** ${input.verdict.files.map((f) => code(f)).join(", ")}`, "");
  }
  lines.push(
    "---",
    `_Opened by polishd from ${code(input.branch)}, the branch ${agentName(input.agent)} pushed for #${input.issueNumber}. Review it like any other pull request._`,
  );
  return lines.join("\n");
}
