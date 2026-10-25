/**
 * Tests for reading an issue's thread out of GitHub's GraphQL answer, and for
 * where a fix stands given that thread and polishd's own record.
 *
 * Run with `npm test`. The fixture follows the shape GitHub returned for the
 * query in issue-thread.ts when it was run against a live repository: bots
 * named without "[bot]" and typed `Bot`, pull requests arriving both as
 * closing references and as cross-references, a closing event with its
 * reason upper-cased.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { FIX_REQUEST_MARKER } from "./fix-brief.ts";
import {
  FIX_STALL_MS,
  createPrAction,
  fixActions,
  fixPulls,
  fixStatus,
  isFixActive,
  offersSuggestFix,
} from "./fix-status.ts";
import { commentText, issueThreadsQuery, normalizeIssueThread, type RawIssueThread } from "./issue-thread.ts";
import type { PolishdFixRun, PolishdIssueThread } from "./types.ts";

const T0 = Date.UTC(2026, 9, 25, 12);
const iso = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();

const PR_AGENT = {
  __typename: "PullRequest",
  number: 41,
  title: "fix: make Buy a button",
  url: "https://github.com/acme/site/pull/41",
  state: "OPEN",
  isDraft: false,
  merged: false,
  mergedAt: null,
  createdAt: iso(20),
  updatedAt: iso(25),
  headRefName: "claude/issue-12-20261025-1200",
  author: { login: "muskan", __typename: "User" },
};

const PR_MENTION = {
  ...PR_AGENT,
  number: 39,
  title: "chore: tidy buttons",
  url: "https://github.com/acme/site/pull/39",
  headRefName: "chore/buttons",
  createdAt: iso(5),
  updatedAt: iso(6),
};

const CLAUDE_COMMENT =
  "**Claude finished @muskan's task** in 3m —— [View job](https://github.com/acme/site/actions/runs/9) • " +
  "[`claude/issue-12-20261025-1200`](https://github.com/acme/site/tree/claude/issue-12-20261025-1200) • " +
  "[Create PR ➔](https://github.com/acme/site/compare/main...claude/issue-12-20261025-1200?quick_pull=1)\n\n---\n" +
  "The Buy control was a `div` with an onClick.\n\n```json\n" +
  '{ "polishd_verdict": "fixed", "reason": "Made Buy a real button.", "branch": "claude/issue-12-20261025-1200", "pr": null, "files": ["app/buy.tsx"] }\n```';

const RAW: RawIssueThread = {
  number: 12,
  closedByPullRequestsReferences: { nodes: [] },
  timelineItems: {
    nodes: [
      { __typename: "LabeledEvent", createdAt: iso(0), actor: { login: "muskan", __typename: "User" }, label: { name: "bug" } },
      {
        __typename: "CrossReferencedEvent",
        createdAt: iso(5),
        willCloseTarget: false,
        isCrossRepository: false,
        actor: { login: "teammate", __typename: "User" },
        source: PR_MENTION,
      },
      {
        __typename: "IssueComment",
        url: "https://github.com/acme/site/issues/12#issuecomment-1",
        body: `@claude polishd is asking you to fix #12…\n\n${FIX_REQUEST_MARKER}`,
        createdAt: iso(10),
        updatedAt: iso(10),
        author: { login: "muskan", __typename: "User" },
      },
      {
        __typename: "IssueComment",
        url: "https://github.com/acme/site/issues/12#issuecomment-2",
        body: CLAUDE_COMMENT,
        createdAt: iso(11),
        updatedAt: iso(15),
        author: { login: "claude", __typename: "Bot" },
      },
      {
        __typename: "CrossReferencedEvent",
        createdAt: iso(20),
        willCloseTarget: true,
        isCrossRepository: false,
        actor: { login: "muskan", __typename: "User" },
        source: PR_AGENT,
      },
      {
        __typename: "CrossReferencedEvent",
        createdAt: iso(21),
        willCloseTarget: true,
        isCrossRepository: true,
        actor: { login: "stranger", __typename: "User" },
        source: { ...PR_AGENT, number: 41, url: "https://github.com/other/fork/pull/41" },
      },
    ],
  },
};

const RUN: PolishdFixRun = {
  issueNumber: 12,
  agent: "claude-code-action",
  mode: "comment",
  requestedAt: T0 + 10 * 60_000,
};

// ── The query ────────────────────────────────────────────────────────────────

test("the query asks for each issue under its own alias, and nothing else", () => {
  const q = issueThreadsQuery([12, 7, -1, 2.5]);
  assert.match(q, /i12: issue\(number: 12\) \{ \.\.\.Thread \}/);
  assert.match(q, /i7: issue\(number: 7\)/);
  assert.doesNotMatch(q, /number: -1|number: 2\.5/);
  assert.match(q, /closedByPullRequestsReferences\(first: 10, includeClosedPrs: true\)/);
  assert.match(q, /willCloseTarget isCrossRepository/);
});

// ── Reading the answer ───────────────────────────────────────────────────────

test("pull requests are merged across references, other repositories left out", () => {
  const t = normalizeIssueThread(RAW, { defaultBranch: "main" })!;
  assert.deepEqual(
    t.pulls.map((p) => [p.number, p.closes, p.url]),
    [
      [41, true, "https://github.com/acme/site/pull/41"],
      [39, false, "https://github.com/acme/site/pull/39"],
    ],
  );
  assert.equal(t.pulls[0].state, "open");
  assert.equal(t.pulls[0].branch, "claude/issue-12-20261025-1200");
});

test("a closing reference anywhere makes a pull request close the issue", () => {
  const t = normalizeIssueThread({
    ...RAW,
    closedByPullRequestsReferences: { nodes: [{ ...PR_MENTION }] },
  })!;
  assert.equal(t.pulls.find((p) => p.number === 39)?.closes, true);
});

test("the agent's verdict and branch are read from its comment, never polishd's", () => {
  const t = normalizeIssueThread(RAW, { defaultBranch: "main" })!;
  assert.equal(t.verdict?.verdict, "fixed");
  assert.equal(t.verdict?.reason, "Made Buy a real button.");
  // The verdict is dated by the comment's last edit — the agent's answer.
  assert.equal(t.verdict?.at, T0 + 15 * 60_000);
  assert.equal(t.agentBranch, "claude/issue-12-20261025-1200");
  const comments = t.events.filter((e) => e.kind === "comment");
  assert.deepEqual(
    comments.map((c) => c.kind === "comment" && [c.author, c.isBot, c.isAgent, c.fromPolishd]),
    [
      ["muskan", false, false, true],
      ["claude", true, true, false],
    ],
  );
});

test("events come out oldest first, closes and reasons normalized", () => {
  const t = normalizeIssueThread({
    number: 3,
    timelineItems: {
      nodes: [
        { __typename: "ClosedEvent", createdAt: iso(9), stateReason: "COMPLETED", actor: { login: "muskan" }, closer: { __typename: "PullRequest", number: 41 } },
        { __typename: "AssignedEvent", createdAt: iso(1), actor: { login: "muskan" }, assignee: { login: "Copilot" } },
        { __typename: "ReopenedEvent", createdAt: iso(10), actor: { login: "muskan" } },
        null,
        { __typename: "SomethingNew", createdAt: iso(2) },
      ],
    },
  })!;
  assert.deepEqual(
    t.events.map((e) => e.kind),
    ["assigned", "closed", "reopened"],
  );
  const closed = t.events[1];
  assert.ok(closed.kind === "closed" && closed.reason === "completed" && closed.byPull === 41);
  assert.deepEqual(t.pulls, []);
});

test("a deleted issue (null) or a malformed node reads as nothing", () => {
  assert.equal(normalizeIssueThread(null), null);
  assert.equal(normalizeIssueThread({}), null);
});

test("a comment reaches the dashboard as clipped plain text", () => {
  const text = commentText(CLAUDE_COMMENT);
  assert.match(text, /^Claude finished @muskan's task in 3m —— View job • claude\/issue-12/);
  assert.doesNotMatch(text, /polishd_verdict|```|\]\(/);
  assert.ok(commentText("x ".repeat(400)).length <= 320);
  assert.equal(commentText("<!-- hidden -->Hello <b>there</b>"), "Hello there");
});

// ── Where the fix stands ─────────────────────────────────────────────────────

const thread = (over: Partial<PolishdIssueThread> = {}): PolishdIssueThread => ({
  ...normalizeIssueThread(RAW, { defaultBranch: "main" })!,
  ...over,
});
/** The agent's answer stripped back to nothing: no verdict, no branch, no fix link. */
const BARE = { verdict: undefined, agentBranch: undefined, fixLink: undefined } as const;
const BRANCH = "claude/issue-12-20261025-1200";

test("the Create PR link is read as the fix being ready", () => {
  const t = thread();
  assert.deepEqual(t.fixLink, {
    branch: BRANCH,
    url: `https://github.com/acme/site/compare/main...${BRANCH}?quick_pull=1`,
    at: T0 + 15 * 60_000,
  });
});

test("an open pull request on the agent's branch is the fix; a mention isn't", () => {
  const s = fixStatus({ run: RUN, thread: thread(), now: T0 + 30 * 60_000 })!;
  assert.equal(s.stage, "pr-open");
  assert.equal(s.pull?.number, 41);
  assert.deepEqual(
    fixPulls(thread(), RUN).map((p) => p.number),
    [41],
  );
});

test("merged beats open, and is reported whoever opened it", () => {
  const t = thread({
    pulls: [
      { ...thread().pulls[0], state: "merged", mergedAt: T0 },
      { ...thread().pulls[0], number: 50, state: "open", updatedAt: T0 + 99 },
    ],
  });
  assert.equal(fixStatus({ thread: t })?.stage, "merged");
});

test("no request and nothing carrying a fix says nothing", () => {
  assert.equal(fixStatus({ thread: thread({ pulls: [], ...BARE }) }), null);
  assert.equal(fixStatus({}), null);
});

test("a request moves from requested to working to stalled", () => {
  const quiet = thread({ pulls: [], ...BARE, events: [] });
  assert.equal(fixStatus({ run: RUN, thread: quiet, now: RUN.requestedAt + 60_000 })?.stage, "requested");
  assert.equal(fixStatus({ run: RUN, thread: quiet, now: RUN.requestedAt + FIX_STALL_MS + 1 })?.stage, "stalled");
  // No thread at all (GraphQL unavailable): the run alone.
  assert.equal(fixStatus({ run: RUN, now: RUN.requestedAt + 1 })?.stage, "requested");

  // Answered, with the branch link it shows from the start — no fix yet.
  const answered = thread({ pulls: [], verdict: undefined, fixLink: undefined });
  const working = fixStatus({ run: RUN, thread: answered, now: T0 + 12 * 60_000 })!;
  assert.equal(working.stage, "working");
  assert.equal(working.branch, BRANCH);
  assert.equal(isFixActive(working), true);
  assert.equal(createPrAction(RUN, answered), null, "a branch link alone is no fix to open");
});

test("a declining verdict is the answer, unless it predates this request", () => {
  const declined = thread({
    pulls: [],
    fixLink: undefined,
    verdict: { verdict: "not_real", reason: "There's an onClick.", files: [], at: T0 + 15 * 60_000 },
  });
  const s = fixStatus({ run: RUN, thread: declined })!;
  assert.equal(s.stage, "declined");
  assert.equal(isFixActive(s), false);
  // Asked again after that verdict: the old answer doesn't count.
  const again = { ...RUN, requestedAt: T0 + 60 * 60_000 };
  assert.equal(fixStatus({ run: again, thread: { ...declined, events: [] }, now: again.requestedAt + 1 })?.stage, "requested");
});

test("a fix left on a branch with no pull request: Create PR opens it", () => {
  const t = thread({ pulls: [] });
  const s = fixStatus({ run: RUN, thread: t })!;
  assert.equal(s.stage, "branch");
  assert.equal(s.branch, BRANCH);
  // Nothing more to wait for from the agent; the next move is the owner's.
  assert.equal(isFixActive(s), false);
  assert.deepEqual(fixActions(RUN, t), { link: [], openFrom: BRANCH });
  assert.equal(createPrAction(RUN, t), "create");
});

test("the Create PR link alone is enough, with or without a verdict or a request", () => {
  const linkOnly = thread({ pulls: [], verdict: undefined });
  assert.equal(fixStatus({ run: RUN, thread: linkOnly })?.stage, "branch");
  // Someone started the agent by hand: the same button.
  assert.equal(fixStatus({ thread: linkOnly })?.stage, "branch");
  assert.equal(createPrAction(undefined, linkOnly), "create");
  // A fixed verdict naming the branch counts too, link or not.
  const verdictOnly = thread({ pulls: [], fixLink: undefined });
  assert.equal(fixActions(RUN, verdictOnly).openFrom, BRANCH);
});

test("a fix link from an earlier request doesn't count for this one", () => {
  const again = { ...RUN, requestedAt: T0 + 60 * 60_000 };
  const t = thread({ pulls: [], verdict: undefined, events: [] });
  assert.equal(fixStatus({ run: again, thread: t, now: again.requestedAt + 1 })?.stage, "requested");
  assert.equal(createPrAction(again, t), null);
});

test("a closed pull request on the branch was a decision: nothing to create", () => {
  const closed = thread({ pulls: [{ ...thread().pulls[0], state: "closed" }] });
  assert.equal(fixStatus({ run: RUN, thread: closed })?.stage, "pr-closed");
  assert.equal(createPrAction(RUN, closed), null);
});

test("an agent pull request without Fixes #N is linked; a teammate's never is", () => {
  const unlinked = thread({
    pulls: [{ ...thread().pulls[0], closes: false, author: "Copilot", authorIsBot: true, branch: "copilot/fix-12" }],
    ...BARE,
  });
  assert.deepEqual(fixActions(RUN, unlinked).link, [41]);
  assert.equal(createPrAction(RUN, unlinked), "link");
  // Once the line is there, the pull request closes the issue: nothing left.
  const linked = { ...unlinked, pulls: [{ ...unlinked.pulls[0], closes: true }] };
  assert.equal(createPrAction(RUN, linked), null);
  // A human's pull request that only mentions the issue is never edited.
  const human = thread({ pulls: [{ ...thread().pulls[1] }], ...BARE });
  assert.deepEqual(fixActions(RUN, human).link, []);
  assert.equal(createPrAction(RUN, human), null);
});

test("Suggest a fix is offered only where it's the one help there is", () => {
  const none = { trigger: "none" as const, paused: false };
  const ready = { trigger: "separate" as const, paused: false };
  // Nothing on GitHub, no agent: the panel is the help.
  assert.equal(offersSuggestFix(null, none), true);
  // An agent that can be asked, or that runs on every filing: Create fix's job.
  assert.equal(offersSuggestFix(null, ready), false);
  assert.equal(offersSuggestFix(null, { trigger: "every-filing", paused: false }), false);
  // Paused, or a workflow that can't start a fix on a filed issue: the panel again.
  assert.equal(offersSuggestFix(null, { ...ready, paused: true }), true);
  assert.equal(offersSuggestFix(null, { trigger: "on-filing", paused: false }), true);
  // A pull request carrying a fix, whoever opened it: nobody needs a plan.
  const pull = thread().pulls[0];
  assert.equal(offersSuggestFix({ stage: "pr-open", pull }, none), false);
  assert.equal(offersSuggestFix({ stage: "merged", pull: { ...pull, state: "merged" } }, none), false);
  // Closed without merging: the plan is useful again.
  assert.equal(offersSuggestFix({ stage: "pr-closed", pull: { ...pull, state: "closed" } }, none), true);
  // The agent was asked about this issue: its answer is the help.
  assert.equal(offersSuggestFix({ stage: "declined", run: RUN }, none), false);
});

test("a failed assignment is reported as failed", () => {
  const s = fixStatus({ run: { ...RUN, error: "couldn't assign" }, thread: thread({ pulls: [], ...BARE, events: [] }) });
  assert.equal(s?.stage, "failed");
});
