/**
 * Polishd — is the connected repo ready to receive fixes? (pure)
 *
 * The fix loop polishd is building toward hands a verified issue to a coding
 * agent the owner already runs on the repo — the Claude Code GitHub Action
 * first, the Copilot coding agent second — and reads the verdict back. Before
 * any of that, the Settings tab needs to say plainly what the repo has: which
 * agent, how it fires, what phrase it listens for, how it's billed, and what
 * would stop a dispatch. This module is that judgement, as a function of the
 * repo's files and a few facts the API reports, so it can be tested against
 * fixtures and never guesses from the network.
 *
 * What it reads is what GitHub's docs say the Action keys on: the `on:`
 * events (issues `opened` means the trigger phrase can go in the body;
 * `issue_comment` only means polishd has to comment after filing), the job's
 * `if:` condition and the `trigger_phrase` input (the phrase), whether a
 * `prompt` input is present (automation mode: every issue starts a run), and
 * which secret input the step passes (how runs are billed). Nothing here
 * needs Actions, Secrets or Administration permission, and two things can't
 * be read at all with the token the owner has — whether the Claude GitHub
 * App is installed and whether the secret exists — which is what the live
 * test is for.
 *
 * Also here: the workflow polishd recommends, the prefilled new-file link
 * that creates it, and the text of the test issue. Pure, so the card can
 * build the link in the browser from the owner's radio choice.
 */
import type {
  PolishdDispatchAgent,
  PolishdDispatchMode,
  PolishdDispatchPlan,
  PolishdDispatchReadiness,
  PolishdDispatchRow,
  PolishdDispatchSecret,
  PolishdDispatchStatus,
  PolishdDispatchTest,
} from "./types";
import { asList, asMap, asString, parseWorkflowYaml, type YamlishValue } from "./workflow-yaml";

// ── Input ────────────────────────────────────────────────────────────────────

export interface DispatchWorkflowFile {
  /** Repo path, e.g. ".github/workflows/claude.yml". */
  path: string;
  text: string;
}

/** An open pull request that adds a workflow — `/install-github-app` opens one. */
export interface DispatchPendingPull {
  number: number;
  title: string;
  url: string;
}

export interface DispatchRepoFacts {
  /** "owner/repo", as GitHub reports it. */
  repo: string;
  defaultBranch: string;
  /** The branch the tree and the workflow texts were read from. */
  treeRef: string;
  /** Write access of the token's user, from the repo's `permissions`; null when absent. */
  canWrite: boolean | null;
  /** Every file under `.github/workflows/`, with its text. */
  workflows: DispatchWorkflowFile[];
  /** Whether `copilot-swe-agent` is among the repo's assignable actors; null when the token couldn't ask. */
  copilotAssignable: boolean | null;
  /** Open pull requests that add a Claude workflow but aren't merged. */
  pendingPulls?: DispatchPendingPull[];
  /** The last live test, which is the only evidence for what can't be read. */
  lastTest?: PolishdDispatchTest;
}

/** The workflow files in a tree listing — what the server reads the text of. */
export function workflowPaths(files: string[]): string[] {
  return files.filter((p) => /^\.github\/workflows\/[^/]+\.ya?ml$/i.test(p));
}

// ── Reading one workflow ─────────────────────────────────────────────────────

/** Default trigger phrase of `anthropics/claude-code-action`. */
export const DEFAULT_TRIGGER_PHRASE = "@claude";

/** The facts one workflow file yields. Everything absent means "couldn't tell". */
export interface WorkflowFacts {
  path: string;
  /** The `uses:` line names `anthropics/claude-code-action`. */
  usesClaude: boolean;
  actionVersion?: string;
  /** Which events it listens for, per the `on:` block. */
  issuesOpened: boolean;
  issuesAssigned: boolean;
  issueCommentCreated: boolean;
  /** Set when `on:` was readable at all. */
  eventsKnown: boolean;
  /** The `trigger_phrase` input, when passed. */
  triggerPhraseInput?: string;
  /** The phrases the job's or step's `if:` tests for, in order. */
  ifPhrases: string[];
  /** A `prompt` (or legacy `direct_prompt`) input is passed: automation mode. */
  automationMode: boolean;
  secretKind: PolishdDispatchSecret;
}

const CLAUDE_ACTION_RE = /^anthropics\/claude-code-action(?:@([^\s]+))?$/;
const PHRASE_RE =
  /contains\(\s*github\.event\.(?:issue|comment|review|pull_request)\.(?:body|title)\s*,\s*(['"])(.*?)\1\s*\)/g;

/**
 * The `types` an event is listened for: null when the event isn't in `on:`,
 * [] when it is with no `types` filter (every type), else the listed types.
 */
function eventTypes(on: YamlishValue | undefined, event: string): string[] | null {
  if (on === undefined || on === null) return null;
  if (typeof on === "string") return on === event ? [] : null;
  const list = asList(on);
  if (list) return list.some((v) => v === event) ? [] : null;
  const map = asMap(on);
  if (!map || !(event in map)) return null;
  const cfg = asMap(map[event]);
  const types = cfg ? asList(cfg.types) : null;
  if (!types) return [];
  return types.filter((t): t is string => typeof t === "string");
}

function listens(types: string[] | null, type: string): boolean {
  return types !== null && (types.length === 0 || types.includes(type));
}

function phrasesIn(condition: string | null): string[] {
  if (!condition) return [];
  const out: string[] = [];
  for (const m of condition.matchAll(PHRASE_RE)) {
    const phrase = m[2].trim();
    if (phrase && !out.includes(phrase)) out.push(phrase);
  }
  return out;
}

/** Read the facts the plan needs out of one workflow file. */
export function readWorkflow(file: DispatchWorkflowFile): WorkflowFacts {
  const root = asMap(parseWorkflowYaml(file.text));
  // YAML 1.1 readers turn a bare `on` key into `true`; a file written to
  // survive that spells it "on" in quotes, which the reader gives back as on.
  const on = root ? (root.on ?? root.true) : undefined;
  const facts: WorkflowFacts = {
    path: file.path,
    usesClaude: false,
    issuesOpened: listens(eventTypes(on, "issues"), "opened"),
    issuesAssigned: listens(eventTypes(on, "issues"), "assigned"),
    issueCommentCreated: listens(eventTypes(on, "issue_comment"), "created"),
    eventsKnown: on !== undefined && on !== null,
    ifPhrases: [],
    automationMode: false,
    secretKind: "unknown",
  };
  const jobs = root ? asMap(root.jobs) : null;
  if (!jobs) return facts;

  for (const job of Object.values(jobs)) {
    const jobMap = asMap(job);
    if (!jobMap) continue;
    const steps = asList(jobMap.steps) ?? [];
    for (const step of steps) {
      const stepMap = asMap(step);
      const uses = stepMap ? asString(stepMap.uses) : null;
      const m = uses ? CLAUDE_ACTION_RE.exec(uses.trim()) : null;
      if (!m || !stepMap) continue;
      facts.usesClaude = true;
      facts.actionVersion = m[1];
      const withMap = asMap(stepMap.with) ?? {};
      const envMap = asMap(stepMap.env) ?? {};
      const phrase = asString(withMap.trigger_phrase);
      if (phrase) facts.triggerPhraseInput = phrase.trim();
      facts.ifPhrases = [
        ...phrasesIn(asString(jobMap.if)),
        ...phrasesIn(asString(stepMap.if)),
      ].filter((p, i, all) => all.indexOf(p) === i);
      const prompt = withMap.prompt ?? withMap.direct_prompt;
      facts.automationMode = typeof prompt === "string" ? prompt.trim().length > 0 : prompt !== undefined && prompt !== null;
      const oauth = "claude_code_oauth_token" in withMap || "CLAUDE_CODE_OAUTH_TOKEN" in envMap;
      const apiKey = "anthropic_api_key" in withMap || "ANTHROPIC_API_KEY" in envMap;
      facts.secretKind = oauth && apiKey ? "both" : oauth ? "oauth-token" : apiKey ? "api-key" : "unknown";
      return facts; // the first Claude step decides; a second one is rare and odd
    }
  }
  return facts;
}

// ── The plan ─────────────────────────────────────────────────────────────────

/** Rank the Claude workflows: one that hears new issues beats comments-only. */
function rank(w: WorkflowFacts): number {
  return w.issuesOpened ? 3 : w.issueCommentCreated ? 2 : w.issuesAssigned ? 1 : 0;
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Judge the repo. Pure: every fact comes in through `facts`. */
export function analyzeDispatchReadiness(facts: DispatchRepoFacts): PolishdDispatchReadiness {
  const read = facts.workflows.map(readWorkflow);
  const claude = read.filter((w) => w.usesClaude).sort((a, b) => rank(b) - rank(a));
  const chosen = claude[0];
  const pending = facts.pendingPulls ?? [];
  const warnings: string[] = [];
  const rows: PolishdDispatchRow[] = [];

  const agent: PolishdDispatchAgent = chosen
    ? "claude-code-action"
    : facts.copilotAssignable
      ? "copilot"
      : "none";

  // How a filed issue would reach the agent.
  let mode: PolishdDispatchMode = "none";
  if (chosen) {
    mode = chosen.issuesOpened ? "body" : chosen.issueCommentCreated ? "comment" : "none";
  } else if (agent === "copilot") {
    mode = "assign";
  }

  const triggerPhrase = chosen
    ? (chosen.triggerPhraseInput ?? chosen.ifPhrases[0] ?? DEFAULT_TRIGGER_PHRASE)
    : DEFAULT_TRIGGER_PHRASE;

  const plan: PolishdDispatchPlan = {
    agent,
    mode,
    triggerPhrase,
    workflowPath: chosen?.path,
    actionVersion: chosen?.actionVersion,
    secretKind: chosen?.secretKind ?? "unknown",
    defaultBranch: facts.defaultBranch,
    copilotAssignable: facts.copilotAssignable,
  };

  // ── Rows ──────────────────────────────────────────────────────────────────
  const copilotNote =
    facts.copilotAssignable === true
      ? "Copilot's coding agent can be assigned here too."
      : facts.copilotAssignable === false
        ? "Copilot's coding agent isn't assignable on this repo."
        : "Couldn't ask whether Copilot is assignable — the token can't run GraphQL.";

  if (chosen) {
    rows.push({
      label: "Agent",
      value: `anthropics/claude-code-action${chosen.actionVersion ? `@${chosen.actionVersion}` : ""} in ${chosen.path}`,
      detail: `The Claude Code GitHub Action, on the default branch ${facts.defaultBranch}. ${copilotNote}`,
      tone: "ok",
    });
    if (mode === "body") {
      rows.push({
        label: "How it fires",
        value: "Listens for new issues",
        detail: `The workflow runs when an issue is opened, so polishd will put ${triggerPhrase} in the issue body and the run starts on filing.`,
        tone: "ok",
      });
    } else if (mode === "comment") {
      rows.push({
        label: "How it fires",
        value: "Comments only",
        detail: `The workflow doesn't hear new issues, only comments, so polishd will add a comment with ${triggerPhrase} right after filing.`,
        tone: "neutral",
      });
    } else {
      rows.push({
        label: "How it fires",
        value: chosen.eventsKnown
          ? chosen.issuesAssigned
            ? "On assignment only"
            : "Neither new issues nor comments"
          : "Couldn't read the on: block",
        detail: chosen.eventsKnown
          ? "Nothing polishd files would start it. Add issues (opened) or issue_comment (created) to its on: block."
          : "The workflow's events couldn't be read, so polishd can't tell what would start it.",
        tone: "bad",
      });
    }
    rows.push({
      label: "Trigger phrase",
      value: triggerPhrase,
      detail: chosen.triggerPhraseInput
        ? "From the step's trigger_phrase input."
        : chosen.ifPhrases[0]
          ? "From the job's if: condition."
          : "The Action's default — the workflow sets none.",
      tone: "neutral",
    });
    const billing: Record<PolishdDispatchSecret, PolishdDispatchRow> = {
      "oauth-token": {
        label: "Billing path",
        value: "Subscription token",
        detail:
          "The step passes claude_code_oauth_token, so runs draw on your Claude plan's usage limits.",
        tone: "neutral",
      },
      "api-key": {
        label: "Billing path",
        value: "API key",
        detail:
          "The step passes anthropic_api_key, so runs are metered API usage — covered by a Max or Team plan's monthly credit when the Console organization is linked.",
        tone: "neutral",
      },
      both: {
        label: "Billing path",
        value: "Both inputs",
        detail:
          "The step passes both claude_code_oauth_token and anthropic_api_key. The Action uses one of them; the other is dead weight.",
        tone: "warn",
      },
      unknown: {
        label: "Billing path",
        value: "Couldn't tell",
        detail:
          "The step passes neither claude_code_oauth_token nor anthropic_api_key — a cloud provider, or a secret the workflow doesn't name. Runs may not authenticate at all.",
        tone: "warn",
      },
    };
    rows.push(billing[chosen.secretKind]);
  } else if (agent === "copilot") {
    rows.push({
      label: "Agent",
      value: "Copilot coding agent",
      detail:
        "Assignable on this repo. No Claude Code workflow was found on the default branch; Copilot is the fallback.",
      tone: "ok",
    });
    rows.push({
      label: "How it fires",
      value: "On assignment",
      detail: "polishd will assign each issue to Copilot right after filing; Copilot answers with a pull request.",
      tone: "neutral",
    });
    rows.push({
      label: "Billing path",
      value: "Copilot premium requests",
      detail: "Each session spends premium requests on the Copilot plan of whoever assigns the issue.",
      tone: "neutral",
    });
  } else {
    rows.push({
      label: "Agent",
      value: "None found",
      detail: `No workflow under .github/workflows/ on ${facts.defaultBranch} uses anthropics/claude-code-action. ${copilotNote}`,
      tone: pending.length ? "warn" : "bad",
    });
  }

  rows.push(
    facts.canWrite === true
      ? {
          label: "Your access",
          value: "Write",
          detail:
            "The token's user has write access, which the Action requires of whoever opens or comments on the issue.",
          tone: "ok",
        }
      : facts.canWrite === false
        ? {
            label: "Your access",
            value: "No write access",
            detail:
              "The Action ignores issues and comments from users without write access, so anything polishd files as this user would be ignored.",
            tone: "bad",
          }
        : {
            label: "Your access",
            value: "Couldn't tell",
            detail: "GitHub didn't report the token user's permissions on the repo.",
            tone: "warn",
          },
  );

  const test = facts.lastTest;
  rows.push(
    test?.status === "passed" && test.repliedAt
      ? {
          label: "Not checkable here",
          value: "GitHub App installed · secret present",
          detail: `Verified by the live test on ${isoDay(test.repliedAt)}: the agent replied, which it can only do with the App installed and the secret in place.`,
          tone: "ok",
        }
      : test?.status === "failed"
        ? {
            label: "Not checkable here",
            value: "GitHub App installed · secret present — not confirmed",
            detail: `The live test on ${isoDay(test.startedAt)} got no reply. Neither can be read with this token; the test is the only evidence.`,
            tone: "warn",
          }
        : {
            label: "Not checkable here",
            value: "GitHub App installed · secret present — not yet tested",
            detail:
              "Neither can be read with this token (it would need Administration and Secrets permission). Send a test issue to find out.",
            tone: "neutral",
          },
  );

  // ── Warnings ──────────────────────────────────────────────────────────────
  if (chosen?.automationMode) {
    warnings.push(
      `${chosen.path} passes a prompt input, so the Action runs in automation mode: every issue it hears about starts a run, trigger phrase or not — including every issue polishd files.`,
    );
  }
  if (chosen && chosen.triggerPhraseInput && chosen.ifPhrases.length && !chosen.ifPhrases.includes(chosen.triggerPhraseInput)) {
    warnings.push(
      `The job's if: condition looks for ${chosen.ifPhrases.join(" or ")} but the step's trigger_phrase is ${chosen.triggerPhraseInput}. An issue has to contain both to start a run; polishd will use ${chosen.triggerPhraseInput}.`,
    );
  }
  if (chosen && facts.treeRef !== facts.defaultBranch) {
    warnings.push(
      `${chosen.path} was read from ${facts.treeRef}, not the default branch ${facts.defaultBranch}. GitHub runs issue-event workflows only from the default branch, so issue events never reach it there.`,
    );
  }
  for (const pr of pending) {
    warnings.push(
      `Pull request #${pr.number} ("${pr.title}") adds a Claude workflow but isn't merged. GitHub runs issue-event workflows only from the default branch, so issue events never reach it until it lands on ${facts.defaultBranch}.`,
    );
  }
  if (chosen && mode === "none") {
    warnings.push(
      `${chosen.path} listens for neither new issues nor comments, so nothing polishd files could start it.`,
    );
  }
  if (facts.canWrite === false) {
    warnings.push(
      `The token's user has no write access to ${facts.repo}. The Action only answers users with write access, so it would ignore every issue polishd files.`,
    );
  }
  if (claude.length > 1) {
    warnings.push(
      `${claude.length} workflows use the Action (${claude.map((w) => w.path).join(", ")}); polishd follows ${chosen!.path}. The others may run on the same issues.`,
    );
  }

  // ── Status ────────────────────────────────────────────────────────────────
  let status: PolishdDispatchStatus;
  if (chosen) {
    const blocked = mode === "none" || facts.canWrite === false || facts.treeRef !== facts.defaultBranch;
    status = blocked ? "needs-attention" : "ready-claude";
  } else if (pending.length) {
    status = "needs-attention";
  } else if (agent === "copilot") {
    status = facts.canWrite === false ? "needs-attention" : "ready-copilot";
  } else {
    status = "not-set-up";
  }

  return {
    status,
    plan,
    rows,
    warnings,
    canWrite: facts.canWrite,
    otherWorkflows: claude.slice(1).map((w) => w.path),
  };
}

/** The pill's words for each status. */
export const DISPATCH_STATUS_LABEL: Record<PolishdDispatchStatus, string> = {
  "not-set-up": "Not set up",
  "ready-claude": "Ready via Claude Code Action",
  "ready-copilot": "Ready via Copilot",
  "needs-attention": "Needs attention",
};

/** True when a dispatch could reach an agent as things stand. */
export function isDispatchReady(status: PolishdDispatchStatus | undefined): boolean {
  return status === "ready-claude" || status === "ready-copilot";
}

// ── Setup: links and the recommended workflow ────────────────────────────────

export type DispatchSecretChoice = "oauth-token" | "api-key";

/** The repository secret each billing choice needs, by name. */
export const DISPATCH_SECRET_NAME: Record<DispatchSecretChoice, string> = {
  "oauth-token": "CLAUDE_CODE_OAUTH_TOKEN",
  "api-key": "ANTHROPIC_API_KEY",
};

/** The Action's input each billing choice is passed through. */
export const DISPATCH_SECRET_INPUT: Record<DispatchSecretChoice, string> = {
  "oauth-token": "claude_code_oauth_token",
  "api-key": "anthropic_api_key",
};

export const CLAUDE_APP_INSTALL_URL = "https://github.com/apps/claude/installations/new";
/** GitHub's docs for the agent, which they now file under "cloud agent". */
export const COPILOT_AGENT_DOCS_URL =
  "https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent";
export const CLAUDE_WORKFLOW_PATH = ".github/workflows/claude.yml";

export function actionsSecretUrl(repo: string): string {
  return `https://github.com/${repo}/settings/secrets/actions/new`;
}

export function copilotAgentSettingsUrl(repo: string): string {
  return `https://github.com/${repo}/settings/copilot/coding_agent`;
}

/**
 * The workflow polishd recommends: the stock example from
 * anthropics/claude-code-action, with the secret line matching the owner's
 * billing choice and a turn cap on every run.
 */
export function recommendedWorkflow(opts: { secret: DispatchSecretChoice; maxTurns?: number }): string {
  const secret = DISPATCH_SECRET_NAME[opts.secret];
  const input = DISPATCH_SECRET_INPUT[opts.secret];
  const maxTurns = opts.maxTurns ?? 30;
  return [
    "name: Claude Code",
    "",
    "on:",
    "  issue_comment:",
    "    types: [created]",
    "  pull_request_review_comment:",
    "    types: [created]",
    "  issues:",
    "    types: [opened, assigned]",
    "  pull_request_review:",
    "    types: [submitted]",
    "",
    "jobs:",
    "  claude:",
    "    if: |",
    "      (github.event_name == 'issue_comment' && contains(github.event.comment.body, '@claude')) ||",
    "      (github.event_name == 'pull_request_review_comment' && contains(github.event.comment.body, '@claude')) ||",
    "      (github.event_name == 'pull_request_review' && contains(github.event.review.body, '@claude')) ||",
    "      (github.event_name == 'issues' && (contains(github.event.issue.body, '@claude') || contains(github.event.issue.title, '@claude')))",
    "    runs-on: ubuntu-latest",
    "    permissions:",
    "      contents: read",
    "      pull-requests: read",
    "      issues: read",
    "      id-token: write",
    "      actions: read",
    "    steps:",
    "      - name: Checkout repository",
    "        uses: actions/checkout@v6",
    "        with:",
    "          fetch-depth: 1",
    "",
    "      - name: Run Claude Code",
    "        id: claude",
    "        uses: anthropics/claude-code-action@v1",
    "        with:",
    `          ${input}: \${{ secrets.${secret} }}`,
    `          claude_args: "--max-turns ${maxTurns}"`,
    "",
  ].join("\n");
}

/** Encode a path for a URL while keeping its slashes readable. */
function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/**
 * GitHub's new-file page, prefilled: `/new/<branch>?filename=…&value=…`
 * opens the editor on that path with the contents in place, so the owner
 * only has to press Commit.
 */
export function newWorkflowFileUrl(opts: {
  repo: string;
  branch: string;
  yaml: string;
  path?: string;
}): string {
  const path = opts.path ?? CLAUDE_WORKFLOW_PATH;
  return `https://github.com/${opts.repo}/new/${encodePath(opts.branch)}?filename=${encodePath(path)}&value=${encodeURIComponent(opts.yaml)}`;
}

// ── The live test ────────────────────────────────────────────────────────────

export const DISPATCH_TEST_TITLE = "polishd dispatch test";
export const DISPATCH_TEST_TIMEOUT_MS = 3 * 60_000;

/** The footer every test issue carries, so it's never mistaken for a bug. */
export const DISPATCH_TEST_FOOTER = "_Filed by polishd as a dispatch test. polishd closes it itself._";

/**
 * The issue (and, in comment mode, the comment) that tests the wiring. The
 * trigger phrase goes wherever the plan says the workflow hears it; the ask
 * is one line back and no changes.
 */
export function dispatchTestIssue(plan: Pick<PolishdDispatchPlan, "agent" | "mode" | "triggerPhrase">): {
  title: string;
  body: string;
  comment?: string;
} {
  const ask =
    "This is a connectivity test from polishd, the analytics dashboard connected to this repository. " +
    "Reply with one line to confirm you can see this issue, and change nothing — no files, no branches, no pull requests.";
  if (plan.agent === "copilot") {
    return {
      title: DISPATCH_TEST_TITLE,
      body: `${ask}\n\n${DISPATCH_TEST_FOOTER}`,
    };
  }
  if (plan.mode === "comment") {
    return {
      title: DISPATCH_TEST_TITLE,
      body: `${ask}\n\n${DISPATCH_TEST_FOOTER}`,
      comment: `${plan.triggerPhrase} ${ask}`,
    };
  }
  return {
    title: DISPATCH_TEST_TITLE,
    body: `${plan.triggerPhrase} ${ask}\n\n${DISPATCH_TEST_FOOTER}`,
  };
}

/** One thing that happened on the test issue, as GitHub lists it. */
export interface DispatchActivity {
  login: string;
  /** GitHub's user type is "Bot" for apps; a login ending in "[bot]" means the same. */
  isBot: boolean;
  /** "comment" for a comment; anything else is a timeline event by that actor. */
  kind: string;
  at: number;
}

/**
 * The agent's reply, if it's in the activity: for the Action, a comment from
 * a bot whose login contains "claude"; for Copilot, anything but the
 * assignment itself from a bot whose login contains "copilot".
 */
export function findAgentReply(
  agent: PolishdDispatchAgent,
  activity: DispatchActivity[],
): DispatchActivity | null {
  const word = agent === "copilot" ? "copilot" : "claude";
  const hits = activity
    .filter((a) => a.isBot && a.login.toLowerCase().includes(word))
    .filter((a) => (agent === "copilot" ? a.kind !== "assigned" && a.kind !== "unassigned" : a.kind === "comment"))
    .sort((a, b) => a.at - b.at);
  return hits[0] ?? null;
}

/** What polishd says when it closes the test issue. */
export function dispatchTestCloseComment(outcome: "passed" | "timeout" | "copilot-manual", replyMs?: number): string {
  if (outcome === "passed") {
    const secs = replyMs !== undefined ? Math.max(1, Math.round(replyMs / 1000)) : undefined;
    return `Test passed${secs !== undefined ? ` — the agent replied in ${secs}s` : ""}. Closing; nothing else to do here.`;
  }
  if (outcome === "copilot-manual") {
    return "polishd couldn't assign this issue to Copilot through the API, so Copilot's test is manual: assign any issue to Copilot on GitHub to try it. Closing.";
  }
  return "No reply within three minutes. Closing — the Fix dispatch card in the polishd dashboard lists the likely causes.";
}

/** Why a test gets no reply, most likely first. */
export const DISPATCH_TEST_FAILURE_CAUSES: readonly string[] = [
  "The Claude GitHub App isn't installed on this repository (or not for this repository).",
  "The repository secret the workflow names isn't set, or is set under another name.",
  "The workflow isn't on the default branch — a pull request adds it but isn't merged.",
  "The token's user has no write access, so the Action ignored the issue.",
];
