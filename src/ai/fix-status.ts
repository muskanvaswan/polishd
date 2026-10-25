/**
 * Polishd — where a filed issue's fix stands (pure).
 *
 * Two sources, joined here: the run polishd stored when it asked an agent for
 * a fix (fix-dispatch.ts), and the issue's thread as GitHub reports it now
 * (issue-thread.ts) — the agent's comments and verdict, and every pull
 * request that references the issue. The thread is the truth about the work,
 * whoever did it: a pull request a teammate opened by hand shows up exactly
 * like one the agent opened. The run says only what polishd itself did, and
 * when, so a verdict from an earlier request isn't mistaken for the answer
 * to a later one.
 *
 * Nothing here acts. The agent works on GitHub whether or not the dashboard
 * is open, and the dashboard reads where it got to whenever it's opened.
 * When the agent left a fix on a branch with no pull request — the Action's
 * default — or opened one without `Fixes #N`, the actionable offers Create PR,
 * and `fixActions` is what that button does.
 *
 * Pure and type-only, so the dashboard's client list can import it and the
 * tests can pin it.
 */
import type {
  PolishdAgentVerdict,
  PolishdFixRun,
  PolishdFixStatus,
  PolishdFixTrigger,
  PolishdIssueThread,
  PolishdLinkedPull,
} from "./types";

/** A request with no answer after this long is called stalled. */
export const FIX_STALL_MS = 45 * 60_000;

/** A bot login that is a coding agent's: Claude's app or Copilot's. */
export function isAgentLogin(login: string | undefined): boolean {
  return !!login && /claude|copilot/i.test(login);
}

/** The agent's verdict, when it answers this request rather than an earlier one. */
function currentVerdict(
  run: PolishdFixRun | undefined,
  thread: PolishdIssueThread | undefined,
): PolishdAgentVerdict | undefined {
  const v = thread?.verdict;
  return v && (!run || v.at >= run.requestedAt) ? v : undefined;
}

/**
 * The branch with a fix ready on it: the agent's "Create PR" link — written
 * only once the branch has commits — or a `fixed` verdict that names one.
 * Under a request, only what came after it counts.
 */
function readyBranch(run: PolishdFixRun | undefined, thread: PolishdIssueThread | undefined): string | undefined {
  const link = thread?.fixLink;
  if (link && (!run || link.at >= run.requestedAt)) return link.branch;
  const verdict = currentVerdict(run, thread);
  return verdict?.verdict === "fixed" ? (verdict.branch ?? thread?.agentBranch) : undefined;
}

/**
 * The pull requests that carry a fix for the issue: one linked with a
 * closing keyword, one an agent opened, one on the agent's branch, or one
 * Create PR opened or linked. A pull request that only mentions the issue in
 * passing isn't one — it stays in the timeline as a reference.
 */
export function fixPulls(thread: PolishdIssueThread | undefined, run?: PolishdFixRun): PolishdLinkedPull[] {
  if (!thread) return [];
  const verdict = currentVerdict(run, thread);
  const branches = new Set([readyBranch(run, thread), thread.agentBranch].filter((b): b is string => !!b));
  return thread.pulls.filter(
    (p) =>
      p.closes ||
      (p.authorIsBot && isAgentLogin(p.author)) ||
      (!!p.branch && branches.has(p.branch)) ||
      p.number === run?.openedPull ||
      !!run?.linkedPulls?.includes(p.number) ||
      p.number === verdict?.pr,
  );
}

/**
 * Whether a pull request closes the issue. GitHub's word for it (`closes`)
 * arrives a few seconds after the pull request does — it records the
 * `Fixes #N` link asynchronously — so one polishd opened, or added the line
 * to, counts as linked from the moment polishd wrote it.
 */
export function isLinked(pull: PolishdLinkedPull, run?: PolishdFixRun): boolean {
  return pull.closes || pull.number === run?.openedPull || !!run?.linkedPulls?.includes(pull.number);
}

/** Merged beats open beats closed; the newest wins a tie. */
function primary(pulls: PolishdLinkedPull[]): PolishdLinkedPull | undefined {
  const rank = (p: PolishdLinkedPull) => (p.state === "merged" ? 0 : p.state === "open" ? 1 : 2);
  return [...pulls].sort((a, b) => rank(a) - rank(b) || b.updatedAt - a.updatedAt)[0];
}

/**
 * Where the fix stands, or null when there's nothing to say — no request
 * from polishd, and nothing on GitHub that carries a fix.
 */
export function fixStatus(input: {
  run?: PolishdFixRun;
  thread?: PolishdIssueThread;
  now?: number;
}): PolishdFixStatus | null {
  const { run, thread } = input;
  const now = input.now ?? Date.now();
  const verdict = currentVerdict(run, thread);
  const ready = readyBranch(run, thread);
  const pull = primary(fixPulls(thread, run));
  const base = { ...(verdict ? { verdict } : {}), ...(run ? { run } : {}) };

  if (pull?.state === "merged") return { stage: "merged", pull, ...base };
  if (pull?.state === "open") return { stage: "pr-open", pull, ...base };
  if (verdict && verdict.verdict !== "fixed") return { stage: "declined", ...(pull ? { pull } : {}), ...base };
  // A fix on a branch with no pull request on it. A closed one on that
  // branch was a decision, not a gap.
  if (ready && !(pull && pull.branch === ready)) return { stage: "branch", branch: ready, ...base };
  if (pull) return { stage: "pr-closed", pull, ...base };
  if (!run) return null;
  if (run.error) return { stage: "failed", ...base };

  const answeredAt = agentAnswered(run, thread);
  const branch = thread?.agentBranch;
  if (answeredAt) {
    return now - answeredAt > FIX_STALL_MS
      ? { stage: "stalled", ...base }
      : { stage: "working", ...(branch ? { branch } : {}), ...base };
  }
  return now - run.requestedAt > FIX_STALL_MS ? { stage: "stalled", ...base } : { stage: "requested", ...base };
}

/** When the agent first answered this request on the issue, or 0. */
function agentAnswered(run: PolishdFixRun, thread: PolishdIssueThread | undefined): number {
  for (const e of thread?.events ?? []) {
    if (e.kind === "comment" && e.isAgent && e.at >= run.requestedAt) return e.at;
  }
  return 0;
}

/** Whether the agent is still expected to answer — what the open dashboard keeps reading for. */
export function isFixActive(status: PolishdFixStatus | null): boolean {
  return !!status?.run && (status.stage === "requested" || status.stage === "working");
}

/** What Create PR does, as things stand. */
export interface FixActions {
  /** Agent pull requests to add `Fixes #N` to. */
  link: number[];
  /** A branch to open a pull request from. */
  openFrom?: string;
}

/**
 * The two steps the agent leaves undone: open the pull request from the
 * branch its fix is on, and add `Fixes #N` to an agent's pull request that
 * left it out. Only pull requests the agent opened, or that sit on its
 * branch, are ever edited — a teammate's pull request that mentions the
 * issue is theirs.
 */
export function fixActions(run: PolishdFixRun | undefined, thread: PolishdIssueThread | undefined): FixActions {
  if (!thread) return { link: [] };
  const verdict = currentVerdict(run, thread);
  const branches = new Set([readyBranch(run, thread), thread.agentBranch].filter((b): b is string => !!b));
  const link = fixPulls(thread, run)
    .filter(
      (p) =>
        p.state === "open" &&
        !isLinked(p, run) &&
        ((p.authorIsBot && isAgentLogin(p.author)) || (!!p.branch && branches.has(p.branch)) || p.number === verdict?.pr),
    )
    .map((p) => p.number);
  const status = fixStatus({ run, thread });
  return { link, ...(status?.stage === "branch" && status.branch ? { openFrom: status.branch } : {}) };
}

/**
 * Whether the drawer offers Suggest a fix — a plan from polishd's own model —
 * for an issue. Only where it's the one help there is: no pull request
 * carrying a fix is open or merged (whoever opened it), the agent wasn't
 * asked about this issue, and it can't be asked — none is set up, dispatch
 * is paused, or the workflow only hears new issues. Anywhere else, Create fix
 * does the job with the whole repository in hand.
 */
export function offersSuggestFix(
  fix: PolishdFixStatus | null,
  ctx: { trigger: PolishdFixTrigger; paused: boolean },
): boolean {
  if (fix?.stage === "pr-open" || fix?.stage === "merged") return false;
  if (fix?.run) return false;
  if (ctx.trigger === "every-filing") return false;
  return !(ctx.trigger === "separate" && !ctx.paused);
}

/** What the Create PR button will do, for its label — or null when there's nothing to do. */
export function createPrAction(
  run: PolishdFixRun | undefined,
  thread: PolishdIssueThread | undefined,
): "create" | "link" | null {
  const actions = fixActions(run, thread);
  return actions.openFrom ? "create" : actions.link.length ? "link" : null;
}
