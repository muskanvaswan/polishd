/**
 * Polishd — handing a filed issue to the coding agent, and following it to a
 * pull request linked to the issue (server only).
 *
 * Filing and fixing are two decisions. Filing verifies a finding against the
 * source and puts it in the tracker (issues.ts); a fix is asked for after,
 * from the actionable, with **Create fix** — a comment that starts with the
 * Action's trigger phrase and carries the brief (fix-brief.ts), or, for
 * Copilot, the brief as a comment and then an assignment. Filed issues never
 * carry the phrase, so filing alone never starts a run.
 *
 * Two workflows don't allow that, and the readiness check says which
 * (`fixTrigger`): one that hears new issues but not comments can only be
 * reached as the issue is filed, so File and fix puts the phrase and the
 * brief in the body (`prepareFixAtFiling`); one in automation mode runs on
 * every new issue anyway, so each filing is recorded as the fix it starts.
 *
 * After the request, the agent works on GitHub whether or not the dashboard
 * is open, and polishd reads what it did from the issue's thread
 * (issue-thread.ts) when the tab or the issue is opened — whoever opens the
 * pull request. The Action pushes a branch and leaves a "Create PR" link
 * rather than opening one, so once that link is there the actionable offers
 * **Create PR** instead of Create fix: it opens the pull request from the
 * branch with `Fixes #N`, and adds the line to an agent's pull request that
 * left it out (`createFixPull`; the pure half is `fixActions`). polishd
 * writes nothing to a pull request without that click.
 *
 * Every request is gated the same way, manual or automatic: an agent the
 * readiness check says is ready, dispatch not paused, the daily cap not
 * spent, the issue polishd's and open, and no fix already under way.
 */
import { getMeta, setMeta } from "../server/store";
import { checkDispatchReadiness, loadDispatchState } from "./dispatch";
import { fixTriggerOf, isDispatchReady } from "./dispatch-readiness";
import { fixBrief, polishdPullBody, polishdPullTitle, withClosingReference, type FixAgent } from "./fix-brief";
import { fixActions, fixStatus } from "./fix-status";
import {
  addGithubIssueLabels,
  assignGithubIssueToCopilot,
  compareGithubBranches,
  createGithubIssueComment,
  createGithubPullRequest,
  findCopilotAgent,
  findGithubPullsForBranch,
  githubRepoName,
  isGithubConnected,
  readGithubIssue,
  readGithubIssueNodeId,
  readGithubIssueThreads,
  readGithubPull,
  readGithubRepoFacts,
  updateGithubPullBody,
} from "./github";
import { filedIssueNumbers, findFiledIssue, type FiledRecord } from "./issue-log";
import { evidenceFromBody } from "./issue-marker";
import { DISPATCH_DAILY_CAP_DEFAULT, DISPATCH_LABEL_DEFAULT, resolveSettings } from "./settings";
import type {
  DispatchFixError,
  DispatchFixResult,
  PolishdDispatchPlan,
  PolishdFixRun,
  PolishdFixStage,
  PolishdFixTrigger,
  PolishdIssueThread,
  RefreshFixesResult,
} from "./types";

const FIX_KEY = "fix_runs";
const DAY_MS = 86_400_000;
/** How many issues one refresh reads and reconciles. */
const MAX_REFRESH = 40;

const NOT_CONNECTED = "Connect a GitHub repository and token first.";

// ── The store ────────────────────────────────────────────────────────────────

/**
 * Runs by issue number, and the moments fixes were sent — kept apart, since a
 * second request for one issue replaces its run but still counts against
 * the day's cap.
 */
interface StoredFixes {
  runs: Record<string, PolishdFixRun>;
  sent: number[];
}

async function loadFixes(): Promise<StoredFixes> {
  const raw = await getMeta(FIX_KEY);
  if (!raw) return { runs: {}, sent: [] };
  try {
    const parsed = JSON.parse(raw) as Partial<StoredFixes> | null;
    return {
      runs: parsed && typeof parsed.runs === "object" && parsed.runs ? parsed.runs : {},
      sent: Array.isArray(parsed?.sent) ? parsed.sent.filter((t): t is number => typeof t === "number") : [],
    };
  } catch {
    return { runs: {}, sent: [] };
  }
}

/**
 * Write runs (and maybe a send) onto the store as it is now — re-read first,
 * so a request that landed while this one was talking to GitHub is kept.
 */
async function saveRuns(runs: PolishdFixRun[], opts: { sentAt?: number } = {}): Promise<void> {
  const stored = await loadFixes();
  for (const run of runs) stored.runs[String(run.issueNumber)] = run;
  const now = Date.now();
  stored.sent = stored.sent.filter((t) => now - t < DAY_MS);
  if (opts.sentAt !== undefined) stored.sent.push(opts.sentAt);
  await setMeta(FIX_KEY, JSON.stringify(stored));
}

function toRecord(stored: StoredFixes): Record<number, PolishdFixRun> {
  const out: Record<number, PolishdFixRun> = {};
  for (const run of Object.values(stored.runs)) out[run.issueNumber] = run;
  return out;
}

/** Every fix polishd has asked for, by issue number. */
export async function listFixRuns(): Promise<Record<number, PolishdFixRun>> {
  return toRecord(await loadFixes());
}

/**
 * What GitHub says about these filed issues now, for the Actionables tab:
 * their pull requests and timelines. Reads only. `error` when none could be
 * read — the tab then shows the tracker's state alone, and says why.
 */
export async function loadIssueThreads(
  numbers: number[],
): Promise<{ threads: Record<number, PolishdIssueThread>; error?: string }> {
  if (!numbers.length || !(await isGithubConnected())) return { threads: {} };
  const read = await readGithubIssueThreads(numbers);
  return { threads: Object.fromEntries(read.threads), ...(read.error ? { error: read.error } : {}) };
}

// ── The gate ─────────────────────────────────────────────────────────────────

type Gate =
  | { ok: true; plan: PolishdDispatchPlan; agent: FixAgent; trigger: PolishdFixTrigger; label: string; cap: number }
  | { ok: false; error: DispatchFixError; message: string };

/**
 * Whether a fix may be sent at all right now, and under which plan. A plan
 * stored before fix triggers existed — or none at all — is re-checked first:
 * it decides whether a fix is a comment or has to ride on the filing.
 */
async function dispatchGate(): Promise<Gate> {
  let state = await loadDispatchState();
  if (!state.readiness || !state.readiness.plan.fixTrigger) {
    state = (await checkDispatchReadiness()).state;
  }
  const readiness = state.readiness;
  const agent = readiness?.plan.agent;
  if (!readiness || !isDispatchReady(readiness.status) || !agent || agent === "none") {
    return {
      ok: false,
      error: "not-ready",
      message: "No coding agent is ready to take fixes yet. Set one up and test it under Settings → Fix dispatch.",
    };
  }
  const { settings } = await resolveSettings();
  if (settings.dispatchPaused) {
    return { ok: false, error: "paused", message: "Fix dispatch is paused. Unpause it under Settings → Fix dispatch." };
  }
  return {
    ok: true,
    plan: readiness.plan,
    agent,
    trigger: fixTriggerOf(readiness.plan),
    label: settings.dispatchLabel?.trim() || DISPATCH_LABEL_DEFAULT,
    cap: settings.dispatchDailyCap ?? DISPATCH_DAILY_CAP_DEFAULT,
  };
}

function capSpent(stored: StoredFixes, cap: number, now: number): string | null {
  const today = stored.sent.filter((t) => now - t < DAY_MS).length;
  return today >= cap
    ? `That's the ${cap} ${cap === 1 ? "fix" : "fixes"} allowed in a day. Raise the daily cap under Settings → Fix dispatch, or try again later.`
    : null;
}

/** The brief for a filed issue, from what polishd knows about how it was found. */
function briefFor(
  filed: Omit<FiledRecord, "evidence"> & { evidence: string },
  gate: Extract<Gate, { ok: true }>,
  issueNumber?: number,
): string {
  return fixBrief({
    issueNumber,
    agent: gate.agent,
    triggerPhrase: gate.plan.triggerPhrase,
    source: filed.source ?? "loss",
    evidence: filed.evidence,
    claim: filed.claim,
    signalKind: filed.signalKind,
    verified: filed.verdict,
    defaultBranch: gate.plan.defaultBranch,
  });
}

/** Why a fix can't be asked for again, by where the current one stands. */
const IN_FLIGHT: Partial<Record<PolishdFixStage, string>> = {
  requested: "A fix was asked for and the agent hasn't answered yet. Give it time — this checks back on its own.",
  working: "The agent is working on this one now.",
  branch: "The agent already left a fix on a branch for this. Create PR opens the pull request from it.",
  "pr-open": "A pull request for this issue is already open.",
  merged: "A pull request for this issue was already merged.",
};

// ── Create fix ───────────────────────────────────────────────────────────────

/**
 * Ask the agent to fix one filed issue: label it, post the brief, and — for
 * Copilot — assign it. The run is stored once the request is on GitHub; an
 * assignment that didn't take is stored with the reason, since the brief is
 * there and assigning by hand finishes the job.
 */
export async function dispatchFix(issueNumber: number, opts: { auto?: boolean } = {}): Promise<DispatchFixResult> {
  if (!(await isGithubConnected())) return { ok: false, error: "not-connected", message: NOT_CONNECTED };
  const filed = await findFiledIssue(issueNumber);
  if (!filed) return { ok: false, error: "not-found", message: `Issue #${issueNumber} isn't one polishd filed.` };

  const gate = await dispatchGate();
  if (!gate.ok) return gate;
  if (gate.trigger === "on-filing") {
    return {
      ok: false,
      error: "on-filing",
      message:
        "Your workflow only hears new issues, so a fix can't start on one already filed. Add issue_comment (created) to its on: block, or use File and fix on the next one.",
    };
  }
  if (gate.trigger === "every-filing") {
    return {
      ok: false,
      error: "on-filing",
      message: "Your workflow runs on every new issue, so this one's run started when it was filed.",
    };
  }

  const issue = await readGithubIssue(issueNumber);
  if (!issue) {
    return { ok: false, error: "github-error", message: `Couldn't read issue #${issueNumber} just now. Try again in a moment.` };
  }
  if (issue.state === "closed") {
    return { ok: false, error: "closed", message: `Issue #${issueNumber} is closed. Reopen it on GitHub to ask for a fix.` };
  }

  const stored = await loadFixes();
  const prev = stored.runs[String(issueNumber)];
  const { threads } = await readGithubIssueThreads([issueNumber]);
  const status = fixStatus({ run: prev, thread: threads.get(issueNumber) });
  const busy = status && IN_FLIGHT[status.stage];
  if (busy) return { ok: false, error: "in-flight", message: busy };

  const now = Date.now();
  const spent = capSpent(stored, gate.cap, now);
  if (spent) return { ok: false, error: "cap", message: spent };

  // Older filings kept neither the citation as written nor which review it
  // came from; the body's evidence line still has both.
  const marked = evidenceFromBody(issue.body);
  const evidence =
    marked && marked.evidence.trim().toLowerCase() === filed.evidence.trim().toLowerCase() ? marked.evidence : filed.evidence;
  const source = filed.source ?? marked?.kind ?? "loss";
  const brief = briefFor({ ...filed, evidence, source }, gate, issueNumber);

  try {
    await addGithubIssueLabels(issueNumber, [gate.label]);
  } catch {
    /* the label is a courtesy; the request doesn't hang on it */
  }

  let comment: { url: string };
  try {
    comment = await createGithubIssueComment(issueNumber, brief);
  } catch (err) {
    return {
      ok: false,
      error: "github-error",
      message: err instanceof Error ? err.message : "Couldn't post the fix request.",
    };
  }

  let run: PolishdFixRun = {
    issueNumber,
    agent: gate.agent,
    mode: gate.agent === "copilot" ? "assign" : "comment",
    requestedAt: now,
    ...(comment.url ? { commentUrl: comment.url } : {}),
    ...(opts.auto ? { auto: true } : {}),
  };
  if (gate.agent === "copilot") {
    const [copilot, nodeId] = await Promise.all([findCopilotAgent(), readGithubIssueNodeId(issueNumber)]);
    const assigned =
      copilot?.assignable && copilot.id && nodeId ? await assignGithubIssueToCopilot(nodeId, copilot.id) : false;
    if (!assigned) {
      run = {
        ...run,
        error: "polishd couldn't assign the issue to Copilot through the API. Assign it to Copilot on GitHub — the brief is already on the issue.",
      };
    }
  }

  await saveRuns([run], { sentAt: now });
  return { ok: true, run };
}

// ── A fix that rides on the filing ───────────────────────────────────────────

export type FixAtFiling =
  | { start: false; error?: string }
  | {
      start: true;
      /** Appended to the issue body. */
      brief: string;
      /** Added to the issue's labels. */
      label: string;
      /** Store the run, once the issue exists. */
      record: (issueNumber: number) => Promise<PolishdFixRun>;
    };

/**
 * Decide, before an issue is filed, whether filing it starts a fix — and
 * with which brief. Only a workflow whose trigger is the filing itself has
 * anything to say here: one that hears new issues only, when the owner asked
 * (File and fix, or automatic dispatch); one in automation mode, always,
 * since its run starts regardless. Anything else files plain, and Create fix
 * comes after.
 */
export async function prepareFixAtFiling(input: {
  want: boolean;
  source: "loss" | "design";
  evidence: string;
  claim?: string;
  signalKind?: string;
  verified?: "confirmed" | "inconclusive";
}): Promise<FixAtFiling> {
  if (!(await isGithubConnected())) return { start: false };
  // Only a filing that could start a fix needs the gate's reads.
  const state = await loadDispatchState();
  const stored = fixTriggerOf(state.readiness?.plan);
  if (!input.want && stored !== "every-filing") return { start: false };

  const gate = await dispatchGate();
  if (!gate.ok) {
    // Automation mode starts its run whatever polishd thinks; only an explicit
    // ask is owed an answer.
    return input.want ? { start: false, error: gate.message } : { start: false };
  }
  const every = gate.trigger === "every-filing";
  if (!every && gate.trigger !== "on-filing") return { start: false };
  if (!every) {
    const spent = capSpent(await loadFixes(), gate.cap, Date.now());
    if (spent) return { start: false, error: spent };
  }

  return {
    start: true,
    brief: briefFor(input, gate),
    label: gate.label,
    record: async (issueNumber: number) => {
      const now = Date.now();
      const run: PolishdFixRun = {
        issueNumber,
        agent: gate.agent,
        mode: "body",
        requestedAt: now,
        ...(every || !input.want ? { auto: true } : {}),
      };
      await saveRuns([run], { sentAt: now });
      return run;
    },
  };
}

// ── Following the fix ────────────────────────────────────────────────────────

/**
 * Read where these filed issues' fixes stand: their threads from GitHub, and
 * the runs polishd stored. Reads only — what the Actionables tab asks when an
 * issue is opened, when Check GitHub is pressed, and now and then while the
 * agent is still expected to answer. Numbers polishd didn't file are ignored.
 */
export async function readFixes(numbers: number[]): Promise<RefreshFixesResult> {
  if (!(await isGithubConnected())) return { ok: false, message: NOT_CONNECTED };
  const ours = await filedIssueNumbers();
  const wanted = [...new Set(numbers)].filter((n) => ours.has(n)).slice(0, MAX_REFRESH);
  const [read, stored] = await Promise.all([readGithubIssueThreads(wanted), loadFixes()]);
  const runs: Record<number, PolishdFixRun> = {};
  for (const n of wanted) {
    const run = stored.runs[String(n)];
    if (run) runs[n] = run;
  }
  return {
    ok: true,
    runs,
    threads: Object.fromEntries(read.threads),
    ...(read.error ? { threadError: read.error } : {}),
  };
}

/**
 * Create PR: the two steps the agent leaves undone, on the owner's click.
 * Opens the pull request from the branch the agent's fix is on — its "Create
 * PR" link, or the branch its `fixed` verdict names — with `Fixes #N` first,
 * and adds `Fixes #N` to an agent's pull request that left it out. Each write
 * checks first: a pull request already open for the branch is linked rather
 * than opened twice, and a branch with no commits ahead of the default branch
 * opens nothing. Works for a run polishd sent and for one someone started by
 * hand.
 */
export async function createFixPull(issueNumber: number): Promise<RefreshFixesResult> {
  if (!(await isGithubConnected())) return { ok: false, message: NOT_CONNECTED };
  if (!(await findFiledIssue(issueNumber))) return { ok: false, message: `Issue #${issueNumber} isn't one polishd filed.` };
  const read = await readGithubIssueThreads([issueNumber]);
  const thread = read.threads.get(issueNumber);
  if (!thread) return { ok: false, message: read.error ?? `Couldn't read issue #${issueNumber} just now.` };

  const run = (await loadFixes()).runs[String(issueNumber)];
  const actions = fixActions(run, thread);
  if (!actions.link.length && !actions.openFrom) {
    return { ok: false, message: "There's no fix on a branch to open, and no agent pull request to link." };
  }
  const repo = (await githubRepoName()) ?? undefined;
  let next = run;
  const failures: string[] = [];

  const link = async (pull: number) => {
    const cur = await readGithubPull(pull);
    if (cur.state !== "open") return;
    const body = withClosingReference(cur.body, issueNumber, repo);
    if (body !== null) await updateGithubPullBody(pull, body);
    if (next && !next.linkedPulls?.includes(pull)) next = { ...next, linkedPulls: [...(next.linkedPulls ?? []), pull] };
  };

  for (const pull of actions.link) {
    try {
      await link(pull);
    } catch (err) {
      failures.push(`Couldn't link pull request #${pull}: ${err instanceof Error ? err.message : "GitHub refused"}.`);
    }
  }

  const branch = actions.openFrom;
  if (branch) {
    try {
      const existing = (await findGithubPullsForBranch(branch)).filter((p) => p.state === "open");
      if (existing.length) {
        // Opened by hand since the page last looked: link it instead.
        for (const p of existing) await link(p.number);
      } else {
        const base =
          (await loadDispatchState()).readiness?.plan.defaultBranch ?? (await readGithubRepoFacts()).defaultBranch;
        const ahead = await compareGithubBranches(base, branch);
        if (ahead === null) {
          failures.push(`The branch ${branch} isn't on GitHub any more.`);
        } else if (ahead === 0) {
          failures.push(`The branch ${branch} has no commits ahead of ${base} yet.`);
        } else {
          const issue = await readGithubIssue(issueNumber);
          const verdict = thread.verdict && (!run || thread.verdict.at >= run.requestedAt) ? thread.verdict : undefined;
          const agent: FixAgent = run?.agent ?? (/copilot/i.test(branch) ? "copilot" : "claude-code-action");
          const opened = await createGithubPullRequest({
            title: polishdPullTitle(issueNumber, issue?.title ?? "", verdict),
            body: polishdPullBody({ issueNumber, agent, branch, verdict }),
            head: branch,
            base,
          });
          if (next) next = { ...next, openedPull: opened.number };
        }
      }
    } catch (err) {
      failures.push(err instanceof Error ? err.message : "Couldn't open the pull request.");
    }
  }

  if (next && next !== run) await saveRuns([next]);
  const fresh = (await readGithubIssueThreads([issueNumber])).threads.get(issueNumber) ?? thread;
  const done = fixActions(next, fresh);
  // Something that was asked for and is still undone is worth saying, even
  // when the other half worked.
  if (failures.length && (done.openFrom || done.link.length)) return { ok: false, message: failures.join(" ") };
  return {
    ok: true,
    runs: next ? { [issueNumber]: next } : {},
    threads: { [issueNumber]: fresh },
  };
}
