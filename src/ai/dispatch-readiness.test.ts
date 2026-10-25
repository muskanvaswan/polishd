/**
 * Tests for the dispatch readiness judgement and the workflow reader under it.
 *
 * Run with `npm test`. Everything here is pure, so the fixtures are workflow
 * files as owners actually write them — the stock example from
 * anthropics/claude-code-action with its inline and commented-out lines, a
 * comments-only variant, automation mode, a custom phrase, a subscription
 * token — and a few spellings YAML allows that a line reader has to survive.
 *
 * Getting these wrong is quiet: a misread `on:` block makes polishd put the
 * trigger phrase where the workflow never looks, every filed issue returns
 * 201, and nothing ever starts a run.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DISPATCH_SECRET_NAME,
  DISPATCH_TEST_TITLE,
  analyzeDispatchReadiness,
  dispatchTestCloseComment,
  dispatchTestIssue,
  findAgentReply,
  isDispatchReady,
  newWorkflowFileUrl,
  readWorkflow,
  recommendedWorkflow,
  workflowPaths,
  type DispatchRepoFacts,
} from "./dispatch-readiness.ts";
import { parseWorkflowYaml } from "./workflow-yaml.ts";

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** examples/claude.yml from anthropics/claude-code-action, comments and all. */
const STOCK = `name: Claude Code

on:
  issue_comment:
    types: [created]
  pull_request_review_comment:
    types: [created]
  issues:
    types: [opened, assigned]
  pull_request_review:
    types: [submitted]

jobs:
  claude:
    if: |
      (github.event_name == 'issue_comment' && contains(github.event.comment.body, '@claude')) ||
      (github.event_name == 'pull_request_review_comment' && contains(github.event.comment.body, '@claude')) ||
      (github.event_name == 'pull_request_review' && contains(github.event.review.body, '@claude')) ||
      (github.event_name == 'issues' && (contains(github.event.issue.body, '@claude') || contains(github.event.issue.title, '@claude')))
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: read
      issues: read
      id-token: write
      actions: read # Required for Claude to read CI results on PRs
    steps:
      - name: Checkout repository
        uses: actions/checkout@v5
        with:
          fetch-depth: 1

      - name: Run Claude Code
        id: claude
        uses: anthropics/claude-code-action@v1
        with:
          anthropic_api_key: \${{ secrets.ANTHROPIC_API_KEY }}

          # This is an optional setting that allows Claude to read CI results on PRs
          additional_permissions: |
            actions: read

          # Optional: Give a custom prompt to Claude. If this is not specified, Claude will perform the instructions specified in the comment that tagged it.
          # prompt: 'Update the pull request description to include a summary of changes.'

          # Optional: Add claude_args to customize behavior and configuration
          # claude_args: '--allowed-tools Bash(gh pr:*)'
`;

const COMMENTS_ONLY = `name: Claude
on:
  issue_comment:
    types: [created]
jobs:
  claude:
    if: contains(github.event.comment.body, '@claude')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: anthropics/claude-code-action@v1
        with:
          anthropic_api_key: \${{ secrets.ANTHROPIC_API_KEY }}
`;

const AUTOMATION = `on:
  issues:
    types: [opened]
jobs:
  triage:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: anthropics/claude-code-action@v1
        with:
          prompt: "Triage this issue and add labels."
          anthropic_api_key: \${{ secrets.ANTHROPIC_API_KEY }}
`;

const CUSTOM_PHRASE = `on:
  issues:
    types: [opened]
  issue_comment:
    types: [created]
jobs:
  claude:
    if: contains(github.event.issue.body, '/claude') || contains(github.event.comment.body, '/claude')
    runs-on: ubuntu-latest
    steps:
      - uses: anthropics/claude-code-action@v1.0.5
        with:
          trigger_phrase: "/claude"
          anthropic_api_key: \${{ secrets.ANTHROPIC_API_KEY }}
`;

const OAUTH = `on:
  issues:
    types: [opened]
jobs:
  claude:
    runs-on: ubuntu-latest
    steps:
      - uses: anthropics/claude-code-action@v1
        with:
          claude_code_oauth_token: \${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
`;

const CI_ONLY = `name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - run: npm test
`;

function facts(over: Partial<DispatchRepoFacts> = {}): DispatchRepoFacts {
  return {
    repo: "acme/site",
    defaultBranch: "main",
    treeRef: "main",
    canWrite: true,
    workflows: [],
    copilotAssignable: false,
    ...over,
  };
}

const wf = (path: string, text: string) => ({ path, text });

// ── The reader ───────────────────────────────────────────────────────────────

test("the stock workflow reads back: events, phrase from if:, api key, no prompt", () => {
  const w = readWorkflow(wf(".github/workflows/claude.yml", STOCK));
  assert.equal(w.usesClaude, true);
  assert.equal(w.actionVersion, "v1");
  assert.equal(w.issuesOpened, true);
  assert.equal(w.issuesAssigned, true);
  assert.equal(w.issueCommentCreated, true);
  assert.deepEqual(w.ifPhrases, ["@claude"]);
  assert.equal(w.triggerPhraseInput, undefined);
  assert.equal(w.automationMode, false, "the commented-out prompt line is a comment");
  assert.equal(w.secretKind, "api-key");
});

test("a comments-only workflow doesn't hear new issues", () => {
  const w = readWorkflow(wf(".github/workflows/claude.yml", COMMENTS_ONLY));
  assert.equal(w.issuesOpened, false);
  assert.equal(w.issueCommentCreated, true);
});

test("a prompt input is automation mode", () => {
  assert.equal(readWorkflow(wf("w.yml", AUTOMATION)).automationMode, true);
});

test("trigger_phrase and the pinned version are read", () => {
  const w = readWorkflow(wf("w.yml", CUSTOM_PHRASE));
  assert.equal(w.triggerPhraseInput, "/claude");
  assert.deepEqual(w.ifPhrases, ["/claude"]);
  assert.equal(w.actionVersion, "v1.0.5");
});

test("claude_code_oauth_token is the subscription path", () => {
  assert.equal(readWorkflow(wf("w.yml", OAUTH)).secretKind, "oauth-token");
});

test("a workflow without the Action is not a Claude workflow", () => {
  const w = readWorkflow(wf("ci.yml", CI_ONLY));
  assert.equal(w.usesClaude, false);
  assert.equal(w.issuesOpened, false);
});

test("flow and scalar on: blocks mean every type", () => {
  const flow = readWorkflow(wf("w.yml", "on: [issues, issue_comment]\njobs: {}\n"));
  assert.equal(flow.issuesOpened, true);
  assert.equal(flow.issueCommentCreated, true);
  const scalar = readWorkflow(wf("w.yml", "on: issues\n"));
  assert.equal(scalar.issuesOpened, true);
  assert.equal(scalar.issueCommentCreated, false);
  const block = readWorkflow(wf("w.yml", "on:\n  - issues\n  - issue_comment\n"));
  assert.equal(block.issuesOpened, true);
});

test("an issues event with no types filter hears opened; one filtered to closed doesn't", () => {
  assert.equal(readWorkflow(wf("w.yml", "on:\n  issues:\njobs: {}\n")).issuesOpened, true);
  assert.equal(readWorkflow(wf("w.yml", "on:\n  issues:\n    types: [closed]\n")).issuesOpened, false);
});

test("a quoted \"on\" key and a sequence at the key's own indent both read", () => {
  const text = `"on":
  issues:
    types:
    - opened
jobs:
  claude:
    runs-on: ubuntu-latest
    steps:
    - uses: anthropics/claude-code-action@v1
      with:
        anthropic_api_key: \${{ secrets.ANTHROPIC_API_KEY }}
`;
  const w = readWorkflow(wf("w.yml", text));
  assert.equal(w.issuesOpened, true);
  assert.equal(w.usesClaude, true);
  assert.equal(w.secretKind, "api-key");
});

test("the reader survives what it doesn't understand", () => {
  assert.equal(parseWorkflowYaml(""), null);
  assert.equal(parseWorkflowYaml("# just a comment\n"), null);
  const w = readWorkflow(wf("w.yml", "on: &anchor\n  issues: *anchor\njobs: !!map\n  - not: [a mapping\n"));
  assert.equal(w.usesClaude, false);
  // A plain scalar folded over lines, and a secret named through env.
  const text = `on:
  issues:
    types: [opened]
jobs:
  claude:
    if: contains(github.event.issue.body,
      '@bot')
    steps:
      - uses: anthropics/claude-code-action@v1
        env:
          ANTHROPIC_API_KEY: \${{ secrets.KEY }}
`;
  const read = readWorkflow(wf("w.yml", text));
  assert.deepEqual(read.ifPhrases, ["@bot"]);
  assert.equal(read.secretKind, "api-key");
});

test("workflowPaths keeps only yaml files directly under .github/workflows", () => {
  assert.deepEqual(
    workflowPaths([
      ".github/workflows/claude.yml",
      ".github/workflows/ci.yaml",
      ".github/workflows/old/ci.yml",
      ".github/dependabot.yml",
      "src/app.ts",
    ]),
    [".github/workflows/claude.yml", ".github/workflows/ci.yaml"],
  );
});

// ── The plan ─────────────────────────────────────────────────────────────────

test("the stock workflow is ready: body mode, @claude, api key", () => {
  const r = analyzeDispatchReadiness(facts({ workflows: [wf(".github/workflows/claude.yml", STOCK)] }));
  assert.equal(r.status, "ready-claude");
  assert.equal(r.plan.agent, "claude-code-action");
  assert.equal(r.plan.mode, "body");
  assert.equal(r.plan.triggerPhrase, "@claude");
  assert.equal(r.plan.secretKind, "api-key");
  assert.equal(r.plan.workflowPath, ".github/workflows/claude.yml");
  assert.equal(r.plan.actionVersion, "v1");
  assert.deepEqual(r.warnings, []);
  const labels = r.rows.map((row) => row.label);
  assert.deepEqual(labels, [
    "Agent",
    "How it fires",
    "Trigger phrase",
    "Billing path",
    "Your access",
    "Not checkable here",
  ]);
  assert.match(r.rows[1].detail ?? "", /put @claude in the issue body/);
  assert.match(r.rows[3].detail ?? "", /metered/);
  assert.match(r.rows[5].value, /not yet tested/);
  assert.equal(isDispatchReady(r.status), true);
});

test("comments only means polishd comments after filing", () => {
  const r = analyzeDispatchReadiness(facts({ workflows: [wf(".github/workflows/claude.yml", COMMENTS_ONLY)] }));
  assert.equal(r.status, "ready-claude");
  assert.equal(r.plan.mode, "comment");
  assert.match(r.rows[1].detail ?? "", /add a comment with @claude/);
});

test("automation mode is a warning, not a block", () => {
  const r = analyzeDispatchReadiness(facts({ workflows: [wf(".github/workflows/triage.yml", AUTOMATION)] }));
  assert.equal(r.status, "ready-claude");
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /automation mode/);
  assert.match(r.warnings[0], /every issue polishd files/);
});

test("a custom phrase is followed, and the subscription path is named", () => {
  const custom = analyzeDispatchReadiness(facts({ workflows: [wf("w.yml", CUSTOM_PHRASE)] }));
  assert.equal(custom.plan.triggerPhrase, "/claude");
  assert.deepEqual(custom.warnings, [], "if: and trigger_phrase agree");
  const oauth = analyzeDispatchReadiness(facts({ workflows: [wf("w.yml", OAUTH)] }));
  assert.equal(oauth.plan.secretKind, "oauth-token");
  assert.match(oauth.rows[3].detail ?? "", /plan's usage limits/);
});

test("an if: phrase that differs from trigger_phrase is called out", () => {
  const text = CUSTOM_PHRASE.replace(/'\/claude'/g, "'@claude'");
  const r = analyzeDispatchReadiness(facts({ workflows: [wf("w.yml", text)] }));
  assert.equal(r.plan.triggerPhrase, "/claude");
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /has to contain both/);
});

test("no workflows and no Copilot is not set up", () => {
  const r = analyzeDispatchReadiness(facts({ workflows: [wf(".github/workflows/ci.yml", CI_ONLY)] }));
  assert.equal(r.status, "not-set-up");
  assert.equal(r.plan.agent, "none");
  assert.equal(r.plan.mode, "none");
  assert.equal(r.rows[0].value, "None found");
  assert.equal(isDispatchReady(r.status), false);
});

test("Copilot assignable with no Claude workflow is ready via Copilot", () => {
  const r = analyzeDispatchReadiness(facts({ copilotAssignable: true }));
  assert.equal(r.status, "ready-copilot");
  assert.equal(r.plan.agent, "copilot");
  assert.equal(r.plan.mode, "assign");
});

test("a Claude workflow wins over Copilot, and says Copilot is there too", () => {
  const r = analyzeDispatchReadiness(facts({ workflows: [wf("w.yml", STOCK)], copilotAssignable: true }));
  assert.equal(r.plan.agent, "claude-code-action");
  assert.equal(r.plan.copilotAssignable, true);
  assert.match(r.rows[0].detail ?? "", /Copilot's coding agent can be assigned here too/);
});

test("a token that can't run GraphQL leaves Copilot unknown, not false", () => {
  const r = analyzeDispatchReadiness(facts({ copilotAssignable: null }));
  assert.equal(r.status, "not-set-up");
  assert.match(r.rows[0].detail ?? "", /Couldn't ask whether Copilot/);
});

test("an unmerged pull request that adds the workflow needs attention", () => {
  const r = analyzeDispatchReadiness(
    facts({ pendingPulls: [{ number: 12, title: "Add Claude Code GitHub Workflow", url: "https://github.com/acme/site/pull/12" }] }),
  );
  assert.equal(r.status, "needs-attention");
  assert.match(r.warnings[0], /#12/);
  assert.match(r.warnings[0], /only from the default branch/);
});

test("a workflow read off another branch never gets issue events", () => {
  const r = analyzeDispatchReadiness(facts({ treeRef: "develop", workflows: [wf("w.yml", STOCK)] }));
  assert.equal(r.status, "needs-attention");
  assert.match(r.warnings[0], /not the default branch main/);
});

test("no write access blocks, whatever the workflow says", () => {
  const r = analyzeDispatchReadiness(facts({ canWrite: false, workflows: [wf("w.yml", STOCK)] }));
  assert.equal(r.status, "needs-attention");
  assert.equal(r.rows[4].value, "No write access");
  assert.match(r.warnings[0], /no write access/);
});

test("a workflow that hears neither issues nor comments can't be started", () => {
  const text = STOCK.replace("  issues:\n    types: [opened, assigned]\n", "").replace(
    "  issue_comment:\n    types: [created]\n",
    "",
  );
  const r = analyzeDispatchReadiness(facts({ workflows: [wf("w.yml", text)] }));
  assert.equal(r.status, "needs-attention");
  assert.equal(r.plan.mode, "none");
  assert.equal(r.rows[1].tone, "bad");
});

test("two Claude workflows: the one hearing issues is followed, the other named", () => {
  const r = analyzeDispatchReadiness(
    facts({
      workflows: [
        wf(".github/workflows/comments.yml", COMMENTS_ONLY),
        wf(".github/workflows/claude.yml", STOCK),
      ],
    }),
  );
  assert.equal(r.plan.workflowPath, ".github/workflows/claude.yml");
  assert.deepEqual(r.otherWorkflows, [".github/workflows/comments.yml"]);
  assert.match(r.warnings[0], /2 workflows use the Action/);
});

test("the last live test is the only evidence for the App and the secret", () => {
  const base = { issueNumber: 7, issueUrl: "u", agent: "claude-code-action" as const, mode: "body" as const };
  const passed = analyzeDispatchReadiness(
    facts({
      workflows: [wf("w.yml", STOCK)],
      lastTest: { ...base, status: "passed", startedAt: Date.UTC(2026, 9, 25), repliedAt: Date.UTC(2026, 9, 25, 12) },
    }),
  );
  assert.equal(passed.rows[5].tone, "ok");
  assert.match(passed.rows[5].detail ?? "", /2026-10-25/);
  const failed = analyzeDispatchReadiness(
    facts({ workflows: [wf("w.yml", STOCK)], lastTest: { ...base, status: "failed", startedAt: Date.UTC(2026, 9, 24), reason: "timeout" } }),
  );
  assert.equal(failed.rows[5].tone, "warn");
  assert.match(failed.rows[5].detail ?? "", /2026-10-24/);
});

// ── Setup: the recommended workflow and its link ─────────────────────────────

test("the recommended workflow reads back as ready, for either secret", () => {
  for (const secret of ["api-key", "oauth-token"] as const) {
    const yaml = recommendedWorkflow({ secret });
    assert.match(yaml, new RegExp(`secrets\\.${DISPATCH_SECRET_NAME[secret]}`));
    assert.match(yaml, /actions\/checkout@v6/);
    assert.match(yaml, /fetch-depth: 1/);
    assert.match(yaml, /anthropics\/claude-code-action@v1/);
    assert.match(yaml, /--max-turns/);
    const r = analyzeDispatchReadiness(facts({ workflows: [wf(".github/workflows/claude.yml", yaml)] }));
    assert.equal(r.status, "ready-claude");
    assert.equal(r.plan.mode, "body");
    assert.equal(r.plan.triggerPhrase, "@claude");
    assert.equal(r.plan.secretKind, secret);
    assert.deepEqual(r.warnings, []);
  }
  assert.notEqual(recommendedWorkflow({ secret: "api-key" }), recommendedWorkflow({ secret: "oauth-token" }));
});

test("the new-file link prefills the path and the contents", () => {
  const yaml = recommendedWorkflow({ secret: "api-key" });
  const url = newWorkflowFileUrl({ repo: "acme/site", branch: "main", yaml });
  assert.ok(url.startsWith("https://github.com/acme/site/new/main?filename=.github/workflows/claude.yml&value="));
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get("filename"), ".github/workflows/claude.yml");
  assert.equal(parsed.searchParams.get("value"), yaml);
  // A branch with a slash keeps it; a space in one is encoded.
  assert.ok(newWorkflowFileUrl({ repo: "a/b", branch: "release/1.0", yaml: "" }).includes("/new/release/1.0?"));
  assert.ok(newWorkflowFileUrl({ repo: "a/b", branch: "my branch", yaml: "" }).includes("/new/my%20branch?"));
});

// ── The live test ────────────────────────────────────────────────────────────

test("the test issue puts the phrase where the workflow hears it", () => {
  const body = dispatchTestIssue({ agent: "claude-code-action", mode: "body", triggerPhrase: "@claude" });
  assert.equal(body.title, DISPATCH_TEST_TITLE);
  assert.ok(body.body.startsWith("@claude "));
  assert.equal(body.comment, undefined);
  assert.match(body.body, /change nothing/);

  const comment = dispatchTestIssue({ agent: "claude-code-action", mode: "comment", triggerPhrase: "/claude" });
  assert.ok(!comment.body.includes("/claude"), "the body stays quiet in comment mode");
  assert.ok(comment.comment?.startsWith("/claude "));

  const copilot = dispatchTestIssue({ agent: "copilot", mode: "assign", triggerPhrase: "@claude" });
  assert.ok(!copilot.body.includes("@claude"));
  assert.equal(copilot.comment, undefined);
});

test("the agent's reply is a bot comment with the agent's name in its login", () => {
  const activity = [
    { login: "muskanvaswan", isBot: false, kind: "comment", at: 10 },
    { login: "github-actions[bot]", isBot: true, kind: "comment", at: 11 },
    { login: "claude[bot]", isBot: true, kind: "comment", at: 12 },
    { login: "claude[bot]", isBot: true, kind: "comment", at: 9 },
  ];
  assert.equal(findAgentReply("claude-code-action", activity)?.at, 9, "the earliest reply counts");
  assert.equal(findAgentReply("copilot", activity), null);
  const copilot = [
    { login: "copilot-swe-agent[bot]", isBot: true, kind: "assigned", at: 1 },
    { login: "copilot-swe-agent[bot]", isBot: true, kind: "cross-referenced", at: 2 },
  ];
  assert.equal(findAgentReply("copilot", copilot)?.at, 2, "the assignment itself isn't a reply");
  // A human named claude is not the agent.
  assert.equal(findAgentReply("claude-code-action", [{ login: "claude-fan", isBot: false, kind: "comment", at: 1 }]), null);
});

test("the closing comments say what happened", () => {
  assert.match(dispatchTestCloseComment("passed", 42_000), /replied in 42s/);
  assert.match(dispatchTestCloseComment("timeout"), /No reply within three minutes/);
  assert.match(dispatchTestCloseComment("copilot-manual"), /manual/);
});
