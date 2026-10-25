/**
 * Tests for the fix brief and what polishd reads back from the agent.
 *
 * Run with `npm test`. The brief is the prompt a coding agent works from, so
 * its load-bearing lines are pinned: the trigger phrase first (the Action's
 * `if:` only hears it there), scope → real → feasible before any change,
 * `Fixes #N` as the pull request's first line, and a verdict block the
 * parser below can read. Getting the parser wrong is quiet — an unreadable
 * verdict leaves an actionable saying "agent working" forever.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AGENT_VERDICTS,
  FIX_REQUEST_MARKER,
  branchFromComment,
  closesIssue,
  fixLinkFromComment,
  fixBrief,
  parseAgentVerdict,
  polishdPullBody,
  polishdPullTitle,
  withClosingReference,
  type FixBriefInput,
} from "./fix-brief.ts";

const BASE: FixBriefInput = {
  issueNumber: 12,
  agent: "claude-code-action",
  triggerPhrase: "@claude",
  source: "loss",
  evidence: "button.buy-now",
  claim: "Visitors click the Buy button and nothing happens",
  signalKind: "dead_click",
  verified: "confirmed",
  defaultBranch: "main",
};

// ── The brief ────────────────────────────────────────────────────────────────

test("the Action's brief opens with its trigger phrase", () => {
  const brief = fixBrief(BASE);
  assert.ok(brief.startsWith("@claude polishd is asking you to fix #12"));
  assert.ok(brief.trimEnd().endsWith(FIX_REQUEST_MARKER));
});

test("Copilot's brief carries no phrase: the assignment starts it", () => {
  const brief = fixBrief({ ...BASE, agent: "copilot" });
  assert.ok(brief.startsWith("Copilot: polishd is asking you to fix #12"));
  assert.doesNotMatch(brief, /@claude/);
  // Copilot opens its own pull request; only the Action is told polishd will.
  assert.doesNotMatch(brief, /polishd opens the pull request from it/);
  assert.match(fixBrief(BASE), /push the branch and say so: the pull request is opened from it, linked to #12, from polishd's dashboard/);
});

test("the brief asks for scope, realness and feasibility before a fix", () => {
  const brief = fixBrief(BASE);
  const scope = brief.indexOf("**Scope it.**");
  const real = brief.indexOf("**Confirm it's real.**");
  const feasible = brief.indexOf("**Check it's feasible.**");
  const fix = brief.indexOf("**Fix it.**");
  assert.ok(scope > 0 && scope < real && real < feasible && feasible < fix, "four steps, in order");
  assert.match(brief, /stop at the first one that fails/);
  assert.match(brief, /change nothing/);
  for (const v of ["needs_info", "not_real", "deliberate", "infeasible"]) assert.match(brief, new RegExp(`\`${v}\``));
});

test("the finding's detector and its blind spot are spelled out", () => {
  assert.match(fixBrief(BASE), /\*\*Dead click\*\*.*Blind spot: handlers attached through React's `onClick`/);
  const design = fixBrief({ ...BASE, source: "design", evidence: "#888888 on #0a0a0a", signalKind: undefined });
  assert.match(design, /\*\*Design measurement\*\*/);
  assert.match(design, /measurements of the pages as visitors' browsers rendered them/);
});

test("the verification behind the filing changes what the agent is told to trust", () => {
  assert.match(fixBrief(BASE), /found code that explains it/);
  assert.match(fixBrief({ ...BASE, verified: "inconclusive" }), /couldn't confirm the report against the source/);
});

test("the Fix it step carries the practice for each kind of bug, the finding's own kind first", () => {
  const loss = fixBrief(BASE);
  const interaction = loss.indexOf("*Interaction* — something users DO fails");
  const design = loss.indexOf("*Design* — something users SEE is wrong");
  assert.ok(interaction > loss.indexOf("**Fix it.**") && design > interaction, "an analytics finding leads with interaction");
  assert.match(loss, /WAI-ARIA Authoring Practices/);
  assert.match(loss, /WCAG 2\.2 \(1\.4\.3 text contrast/);
  assert.match(loss, /naming the guideline the fix follows/);
  const fromDesign = fixBrief({ ...BASE, source: "design", evidence: "#888888 on #0a0a0a" });
  assert.ok(fromDesign.indexOf("*Design* —") < fromDesign.indexOf("*Interaction* —"), "a design finding leads with design");
});

test("the pull request's first line links and closes the issue", () => {
  const brief = fixBrief(BASE);
  assert.match(brief, /The body's first line is `Fixes #12`, on its own/);
  assert.match(brief, /branched from `main`/);
});

test("in an issue body the brief says 'this issue', since there's no number yet", () => {
  const brief = fixBrief({ ...BASE, issueNumber: undefined });
  assert.match(brief, /fix this issue/);
  assert.match(brief, /`Fixes #<this issue's number>`/);
  assert.doesNotMatch(brief, /#12/);
});

test("evidence with a backtick survives as inline code", () => {
  assert.match(fixBrief({ ...BASE, evidence: "a`b" }), /- Evidence: `` a`b ``/);
});

test("the brief's own verdict template never parses as a verdict", () => {
  // polishd's comment carries the template; the parser must not take it for
  // the agent's answer if it ever sees it.
  assert.equal(parseAgentVerdict(fixBrief(BASE), 1), null);
});

// ── Reading the verdict ──────────────────────────────────────────────────────

const reply = (json: string, lang = "json") =>
  `**Claude finished @owner's task** in 2m —— [View job](https://github.com/acme/site/actions/runs/1)\n\n---\nDone.\n\n\`\`\`${lang}\n${json}\n\`\`\``;

test("a fenced verdict is read, with its branch, pull request and files", () => {
  const v = parseAgentVerdict(
    reply(
      '{ "polishd_verdict": "fixed", "reason": "Made the div a button.", "title": "fix: make Buy a button", "branch": "claude/issue-12-20261025-1200", "pr": null, "files": ["app/buy.tsx"] }',
    ),
    1000,
  );
  assert.deepEqual(v, {
    verdict: "fixed",
    reason: "Made the div a button.",
    title: "fix: make Buy a button",
    branch: "claude/issue-12-20261025-1200",
    files: ["app/buy.tsx"],
    at: 1000,
  });
});

test("every verdict kind is accepted; anything else isn't", () => {
  for (const kind of AGENT_VERDICTS) {
    assert.equal(parseAgentVerdict(reply(`{"polishd_verdict":"${kind}","reason":"r"}`), 1)?.verdict, kind);
  }
  assert.equal(parseAgentVerdict(reply('{"polishd_verdict":"done","reason":"r"}'), 1), null);
  assert.equal(parseAgentVerdict(reply('{"polishd_verdict": "fixed", '), 1), null, "malformed JSON");
});

test("the last verdict block wins, and a pr number or string both read", () => {
  const body = `${reply('{"polishd_verdict":"needs_info","reason":"first"}')}\n\nLater:\n${reply('{"polishd_verdict":"fixed","reason":"second","pr":"#41"}', "")}`;
  const v = parseAgentVerdict(body, 1);
  assert.equal(v?.verdict, "fixed");
  assert.equal(v?.reason, "second");
  assert.equal(v?.pr, 41);
});

test("a verdict without fences is still found", () => {
  const v = parseAgentVerdict('All done. {"polishd_verdict": "not_real", "reason": "There is an onClick."}', 5);
  assert.equal(v?.verdict, "not_real");
  assert.equal(v?.reason, "There is an onClick.");
});

test("untrusted fields are cleaned: control characters, length, a bad branch", () => {
  const v = parseAgentVerdict(
    reply(
      JSON.stringify({
        polishd_verdict: "fixed",
        reason: `line one\nline\u0007two ${"x".repeat(600)}`,
        branch: "../../etc",
        files: ["", "a.ts", 3],
      }),
    ),
    1,
  )!;
  assert.doesNotMatch(v.reason, /[\n\u0007]/);
  assert.ok(v.reason.length <= 400);
  assert.equal(v.branch, undefined);
  assert.deepEqual(v.files, ["a.ts"]);
});

// ── The agent's branch ───────────────────────────────────────────────────────

test("the branch is read off the tracking comment's links", () => {
  const comment =
    "**Claude finished @owner's task** —— [View job](https://github.com/acme/site/actions/runs/9) • " +
    "[`claude/issue-12-20261025-1200`](https://github.com/acme/site/tree/claude/issue-12-20261025-1200) • " +
    "[Create PR ➔](https://github.com/acme/site/compare/main...claude/issue-12-20261025-1200?quick_pull=1&title=x)";
  assert.equal(branchFromComment(comment, { issueNumber: 12, defaultBranch: "main" }), "claude/issue-12-20261025-1200");
});

test("a branch naming this issue beats another, and the default branch never counts", () => {
  const comment =
    "See https://github.com/acme/site/tree/main and https://github.com/acme/site/tree/claude/issue-7-1 " +
    "and https://github.com/acme/site/tree/claude%2Fissue-12-1";
  assert.equal(branchFromComment(comment, { issueNumber: 12, defaultBranch: "main" }), "claude/issue-12-1");
  assert.equal(branchFromComment("https://github.com/acme/site/tree/main", { defaultBranch: "main" }), undefined);
  assert.equal(branchFromComment("no links here"), undefined);
});

test("only the Create PR link says a fix is ready, not the branch link shown while working", () => {
  const working =
    "**Claude is working…** —— [View job](https://github.com/acme/site/actions/runs/9) • " +
    "[`claude/issue-12-20261025-1200`](https://github.com/acme/site/tree/claude/issue-12-20261025-1200)";
  assert.equal(fixLinkFromComment(working, { issueNumber: 12 }), undefined);
  const done = `${working} • [Create PR ➔](https://github.com/acme/site/compare/main...claude/issue-12-20261025-1200?quick_pull=1&title=fix)`;
  assert.deepEqual(fixLinkFromComment(done, { issueNumber: 12, defaultBranch: "main" }), {
    branch: "claude/issue-12-20261025-1200",
    url: "https://github.com/acme/site/compare/main...claude/issue-12-20261025-1200?quick_pull=1&title=fix",
  });
});

// ── Linking the pull request ─────────────────────────────────────────────────

test("closing keywords link the issue; a mention doesn't", () => {
  for (const body of ["Fixes #12", "fixes: #12", "Closes acme/site#12", "Resolved #12.", "fix https://github.com/acme/site/issues/12"]) {
    assert.equal(closesIssue(body, 12, "acme/site"), true, body);
  }
  for (const body of ["Refs #12", "Fixes #123", "Fixes other/repo#12", "#12", "prefix #12"]) {
    assert.equal(closesIssue(body, 12, "acme/site"), false, body);
  }
});

test("Fixes #N goes first, and only when it's missing", () => {
  assert.equal(withClosingReference("Made Buy a button.", 12), "Fixes #12\n\nMade Buy a button.");
  assert.equal(withClosingReference("", 12), "Fixes #12");
  assert.equal(withClosingReference("Closes #12\n\nstuff", 12), null);
});

test("a pull request polishd opens says where it came from and links the issue", () => {
  const body = polishdPullBody({
    issueNumber: 12,
    agent: "claude-code-action",
    branch: "claude/issue-12-1",
    verdict: { verdict: "fixed", reason: "Made Buy a button.", files: ["app/buy.tsx"], at: 1 },
  });
  assert.ok(body.startsWith("Fixes #12\n"));
  assert.equal(closesIssue(body, 12), true);
  assert.match(body, /Made Buy a button\./);
  assert.match(body, /`app\/buy\.tsx`/);
  assert.match(body, /the branch Claude pushed for #12/);
  assert.equal(polishdPullTitle(12, "Buy does nothing", { verdict: "fixed", reason: "", title: "fix: Buy", files: [], at: 1 }), "fix: Buy");
  assert.equal(polishdPullTitle(12, "Buy does nothing"), "fix: Buy does nothing");
  assert.equal(polishdPullTitle(12, ""), "fix: #12");
  assert.ok(polishdPullTitle(12, "x".repeat(200)).length <= 72);
});
