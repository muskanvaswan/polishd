/**
 * Polishd — fix dispatch: what the repo has, and the live test (server only).
 *
 * Two things the Settings tab's Fix dispatch card does, both against the
 * connected repo through github.ts:
 *
 *   • The check. Read the repo's facts (default branch, the token user's
 *     access), every workflow file on the default branch, whether Copilot's
 *     agent is assignable, and any unmerged pull request that adds a Claude
 *     workflow — then hand all of it to the pure judgement in
 *     dispatch-readiness.ts and store what it says. A failed check keeps the
 *     previous result and records why.
 *
 *   • The live test. The one thing the token can't read is whether the Claude
 *     GitHub App is installed and the secret exists, so the test files an
 *     issue the way a dispatch would (the trigger phrase in the body or in a
 *     comment after, per the plan; an assignment, for Copilot), and watches
 *     for the agent's reply. Polling is split into short calls the card
 *     repeats — a server action that sleeps for three minutes outlives most
 *     hosts' function limits — and the issue number is stored the moment the
 *     issue exists, so a poll can resume after the page is gone. However it
 *     ends, polishd closes the issue with a comment saying why; a test issue
 *     is never left open silently.
 *
 * Nothing here dispatches a real fix: that's fix-dispatch.ts, which asks
 * this module's stored judgement whether it may, and how.
 */
import { getMeta, setMeta } from "../server/store";
import {
  DISPATCH_TEST_TIMEOUT_MS,
  analyzeDispatchReadiness,
  dispatchTestCloseComment,
  dispatchTestIssue,
  findAgentReply,
  type DispatchRepoFacts,
} from "./dispatch-readiness";
import {
  assignGithubIssueToCopilot,
  closeGithubIssue,
  createGithubIssue,
  createGithubIssueComment,
  findCopilotAgent,
  findGithubWorkflowPulls,
  isGithubConnected,
  readGithubIssue,
  readGithubIssueActivity,
  readGithubRepoFacts,
  readGithubWorkflowFiles,
} from "./github";
import type {
  CheckDispatchResult,
  DispatchTestResult,
  PolishdDispatchState,
  PolishdDispatchTest,
} from "./types";

const DISPATCH_KEY = "dispatch_state";

/**
 * What's stored: the public state plus the facts the last check judged, so a
 * test's outcome can refresh the "Not checkable here" row without another
 * round of reads. The facts never leave the server.
 */
type StoredDispatch = PolishdDispatchState & { facts?: DispatchRepoFacts };

async function loadStored(): Promise<StoredDispatch> {
  const raw = await getMeta(DISPATCH_KEY);
  if (!raw) return { readiness: null };
  try {
    const parsed = JSON.parse(raw) as Partial<StoredDispatch> | null;
    if (typeof parsed !== "object" || parsed === null) return { readiness: null };
    return { ...parsed, readiness: parsed.readiness ?? null };
  } catch {
    return { readiness: null };
  }
}

async function saveStored(state: StoredDispatch): Promise<void> {
  await setMeta(DISPATCH_KEY, JSON.stringify(state));
}

function publicState(stored: StoredDispatch): PolishdDispatchState {
  const { facts: _facts, ...rest } = stored;
  return rest;
}

/** The stored state, as the card first renders it. */
export async function loadDispatchState(): Promise<PolishdDispatchState> {
  return publicState(await loadStored());
}

/** Re-judge the stored facts with the test as it now stands. */
function withTest(stored: StoredDispatch, test: PolishdDispatchTest): StoredDispatch {
  const next: StoredDispatch = { ...stored, test };
  if (stored.facts) {
    const facts = { ...stored.facts, lastTest: test };
    next.facts = facts;
    next.readiness = analyzeDispatchReadiness(facts);
  }
  return next;
}

const NOT_CONNECTED = "Connect a GitHub repository and token first.";

// ── The check ────────────────────────────────────────────────────────────────

/**
 * Read the repo and judge it. Four reads run together; the pull-request and
 * Copilot lookups degrade on their own (to none, and to "couldn't ask"), so
 * only the repo and its tree can fail the check.
 */
export async function checkDispatchReadiness(): Promise<CheckDispatchResult> {
  const prev = await loadStored();
  if (!(await isGithubConnected())) {
    return { ok: false, error: "not-connected", message: NOT_CONNECTED, state: publicState(prev) };
  }
  try {
    const [repo, files, copilot, pendingPulls] = await Promise.all([
      readGithubRepoFacts(),
      readGithubWorkflowFiles(),
      findCopilotAgent(),
      findGithubWorkflowPulls(),
    ]);
    const facts: DispatchRepoFacts = {
      repo: repo.repo,
      defaultBranch: repo.defaultBranch,
      treeRef: files.ref,
      canWrite: repo.canWrite,
      workflows: files.workflows,
      copilotAssignable: copilot ? copilot.assignable : null,
      pendingPulls,
      lastTest: prev.test,
    };
    const next: StoredDispatch = {
      ...prev,
      facts,
      readiness: analyzeDispatchReadiness(facts),
      checkedAt: Date.now(),
      checkError: undefined,
    };
    await saveStored(next);
    return { ok: true, state: publicState(next) };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not reach GitHub.";
    const next: StoredDispatch = { ...prev, checkError: message };
    await saveStored(next);
    return { ok: false, error: "github-error", message, state: publicState(next) };
  }
}

// ── The live test ────────────────────────────────────────────────────────────

/** Close the test issue; false when GitHub wouldn't let us, so the card can say so. */
async function closeTestIssue(number: number, comment: string): Promise<boolean> {
  try {
    await closeGithubIssue(number, comment);
    return true;
  } catch {
    return false;
  }
}

/**
 * File the test issue and start watching it. Returns as soon as the issue
 * exists (and has been commented on or assigned, as the plan requires); the
 * card polls from there. A test already running is returned as it is.
 */
export async function startDispatchTest(): Promise<DispatchTestResult> {
  let stored = await loadStored();
  if (!(await isGithubConnected())) {
    return { ok: false, error: "not-connected", message: NOT_CONNECTED, state: publicState(stored) };
  }
  if (stored.test?.status === "running") return { ok: true, state: publicState(stored) };

  if (!stored.readiness) {
    const checked = await checkDispatchReadiness();
    if (!checked.ok) return { ...checked, error: checked.error === "not-connected" ? "not-connected" : "github-error" };
    stored = await loadStored();
  }
  const readiness = stored.readiness;
  if (!readiness) {
    return { ok: false, error: "not-checked", message: "Check the repository first.", state: publicState(stored) };
  }
  const plan = readiness.plan;
  if (plan.agent === "none") {
    return {
      ok: false,
      error: "no-agent",
      message: "Nothing to test yet — no coding agent was found. Set one up below, then re-check.",
      state: publicState(stored),
    };
  }

  const text = dispatchTestIssue(plan);
  let issue: Awaited<ReturnType<typeof createGithubIssue>>;
  try {
    issue = await createGithubIssue({ title: text.title, body: text.body });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not file the test issue.";
    return { ok: false, error: "github-error", message, state: publicState(stored) };
  }

  // Stored before anything else: from here on the issue exists, and the
  // number is what lets a later poll find and close it.
  let test: PolishdDispatchTest = {
    issueNumber: issue.number,
    issueUrl: issue.url,
    startedAt: Date.now(),
    status: "running",
    agent: plan.agent,
    mode: plan.mode,
  };
  stored = withTest(stored, test);
  await saveStored(stored);

  if (text.comment) {
    try {
      await createGithubIssueComment(issue.number, text.comment);
    } catch (err) {
      const closed = await closeTestIssue(
        issue.number,
        "polishd couldn't post the trigger comment, so this test can't run. Closing.",
      );
      test = { ...test, status: "failed", reason: "unreadable", closedAt: closed ? Date.now() : undefined, leftOpen: !closed };
      stored = withTest(stored, test);
      await saveStored(stored);
      const message = err instanceof Error ? err.message : "Could not comment on the test issue.";
      return { ok: false, error: "github-error", message, state: publicState(stored) };
    }
  }

  if (plan.agent === "copilot") {
    const agent = await findCopilotAgent();
    const assigned =
      agent?.assignable && agent.id && issue.nodeId
        ? await assignGithubIssueToCopilot(issue.nodeId, agent.id)
        : false;
    if (!assigned) {
      const closed = await closeTestIssue(issue.number, dispatchTestCloseComment("copilot-manual"));
      test = {
        ...test,
        status: "failed",
        reason: "copilot-manual",
        closedAt: closed ? Date.now() : undefined,
        leftOpen: !closed,
      };
      stored = withTest(stored, test);
      await saveStored(stored);
    }
  }

  return { ok: true, state: publicState(stored) };
}

/**
 * One look at the running test: has the agent replied, has someone else
 * closed the issue, has the deadline passed? Each outcome closes the issue
 * (when polishd can) and is stored; "still running" stores nothing. Safe to
 * call from a fresh page — the test is found by its stored issue number.
 */
export async function pollDispatchTest(): Promise<DispatchTestResult> {
  const stored = await loadStored();
  const test = stored.test;
  if (!test) {
    return { ok: false, error: "no-test", message: "No test has been sent.", state: publicState(stored) };
  }
  if (test.status !== "running") return { ok: true, state: publicState(stored) };
  if (!(await isGithubConnected())) {
    return { ok: false, error: "not-connected", message: NOT_CONNECTED, state: publicState(stored) };
  }

  const elapsed = Date.now() - test.startedAt;
  const issue = await readGithubIssue(test.issueNumber);
  if (!issue) {
    if (elapsed < DISPATCH_TEST_TIMEOUT_MS) {
      return {
        ok: false,
        error: "github-error",
        message: `Couldn't read issue #${test.issueNumber} just now. Check again in a moment.`,
        state: publicState(stored),
      };
    }
    // Past the deadline and still unreadable: give up, and say the issue may be open.
    const next = withTest(stored, { ...test, status: "failed", reason: "unreadable", leftOpen: true });
    await saveStored(next);
    return { ok: true, state: publicState(next) };
  }

  let activity;
  try {
    activity = await readGithubIssueActivity(test.issueNumber, { timeline: test.agent === "copilot" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not read the test issue's comments.";
    return { ok: false, error: "github-error", message, state: publicState(stored) };
  }

  const reply = findAgentReply(test.agent, activity);
  let outcome: PolishdDispatchTest;
  if (reply) {
    const closed =
      issue.state === "closed" ||
      (await closeTestIssue(test.issueNumber, dispatchTestCloseComment("passed", reply.at - test.startedAt)));
    outcome = {
      ...test,
      status: "passed",
      repliedAt: reply.at,
      replyFrom: reply.login,
      closedAt: issue.state === "closed" ? issue.closedAt : closed ? Date.now() : undefined,
      leftOpen: !closed,
    };
  } else if (issue.state === "closed") {
    outcome = { ...test, status: "failed", reason: "closed-elsewhere", closedAt: issue.closedAt };
  } else if (elapsed >= DISPATCH_TEST_TIMEOUT_MS) {
    const closed = await closeTestIssue(test.issueNumber, dispatchTestCloseComment("timeout"));
    outcome = { ...test, status: "failed", reason: "timeout", closedAt: closed ? Date.now() : undefined, leftOpen: !closed };
  } else {
    return { ok: true, state: publicState(stored) };
  }

  const next = withTest(stored, outcome);
  await saveStored(next);
  return { ok: true, state: publicState(next) };
}
