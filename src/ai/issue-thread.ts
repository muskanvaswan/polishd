/**
 * Polishd — what GitHub says has happened on a filed issue (pure).
 *
 * Filing is never the last anyone hears of an issue: an agent answers it, a
 * teammate opens a pull request for it, someone closes it. The Actionables
 * tab shows all of that whoever did it, and the fix loop needs it to know
 * where a fix stands. Both come from one GraphQL query per batch of issues —
 * the pull requests that reference each issue (with a closing keyword or
 * without), and the last few dozen entries of its timeline — rather than a
 * REST timeline call per issue.
 *
 * This module is the query and the reading of its answer; github.ts sends it.
 * The query was checked against GitHub's live schema, and the fixture in the
 * test file is the shape it returned. Comment bodies are read here in full,
 * for the agent's verdict and branch, and leave as clipped plain text.
 */
import { branchFromComment, FIX_REQUEST_MARKER, fixLinkFromComment, isAgentLogin, parseAgentVerdict } from "./fix-brief";
import type { PolishdIssueEvent, PolishdIssueThread, PolishdLinkedPull } from "./types";

/** How many timeline entries are read per issue. */
export const THREAD_EVENTS = 25;
/** How many issues one query asks about. */
export const THREAD_BATCH = 40;
/** How much of a comment the dashboard is sent. */
const COMMENT_CHARS = 320;

const PULL_FIELDS =
  "number title url state isDraft merged mergedAt createdAt updatedAt headRefName author { login __typename }";

/**
 * The query for a batch of issue numbers, one alias per issue (`i<number>`).
 * A number that isn't an issue (deleted, or a pull request) comes back null
 * with a NOT_FOUND error beside the rest of the data, which the caller keeps.
 */
export function issueThreadsQuery(numbers: readonly number[]): string {
  const aliases = numbers
    .filter((n) => Number.isInteger(n) && n > 0)
    .map((n) => `    i${n}: issue(number: ${n}) { ...Thread }`)
    .join("\n");
  return `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
${aliases}
  }
}
fragment Thread on Issue {
  number
  closedByPullRequestsReferences(first: 10, includeClosedPrs: true) { nodes { ${PULL_FIELDS} } }
  timelineItems(last: ${THREAD_EVENTS}, itemTypes: [ISSUE_COMMENT, CROSS_REFERENCED_EVENT, CONNECTED_EVENT, CLOSED_EVENT, REOPENED_EVENT, ASSIGNED_EVENT, LABELED_EVENT]) {
    nodes {
      __typename
      ... on IssueComment { url body createdAt updatedAt author { login __typename } }
      ... on CrossReferencedEvent { createdAt willCloseTarget isCrossRepository actor { login __typename } source { __typename ... on PullRequest { ${PULL_FIELDS} } } }
      ... on ConnectedEvent { createdAt actor { login __typename } subject { __typename ... on PullRequest { ${PULL_FIELDS} } } }
      ... on ClosedEvent { createdAt stateReason actor { login __typename } closer { __typename ... on PullRequest { number } } }
      ... on ReopenedEvent { createdAt actor { login __typename } }
      ... on AssignedEvent { createdAt actor { login __typename } assignee { __typename ... on User { login } ... on Bot { login } } }
      ... on LabeledEvent { createdAt actor { login __typename } label { name } }
    }
  }
}`;
}

// ── The answer, as GitHub sends it ───────────────────────────────────────────

interface RawActor {
  login?: string;
  __typename?: string;
}

interface RawPull {
  __typename?: string;
  number?: number;
  title?: string;
  url?: string;
  state?: string;
  isDraft?: boolean;
  merged?: boolean;
  mergedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  headRefName?: string;
  author?: RawActor | null;
}

interface RawNode {
  __typename?: string;
  url?: string;
  body?: string;
  createdAt?: string;
  updatedAt?: string;
  author?: RawActor | null;
  actor?: RawActor | null;
  willCloseTarget?: boolean;
  isCrossRepository?: boolean;
  source?: RawPull | null;
  subject?: RawPull | null;
  stateReason?: string | null;
  closer?: { __typename?: string; number?: number } | null;
  assignee?: { login?: string } | null;
  label?: { name?: string } | null;
}

export interface RawIssueThread {
  number?: number;
  closedByPullRequestsReferences?: { nodes?: (RawPull | null)[] | null } | null;
  timelineItems?: { nodes?: (RawNode | null)[] | null } | null;
}

function ms(s: string | null | undefined): number {
  const t = s ? Date.parse(s) : NaN;
  return Number.isFinite(t) ? t : 0;
}

/** GraphQL names an app "claude"; REST names it "claude[bot]". Either is a bot. */
function isBot(a: RawActor | null | undefined): boolean {
  return a?.__typename === "Bot" || !!a?.login?.endsWith("[bot]");
}

function toPull(raw: RawPull | null | undefined, closes: boolean): PolishdLinkedPull | null {
  if (!raw || (raw.__typename !== undefined && raw.__typename !== "PullRequest")) return null;
  if (typeof raw.number !== "number" || typeof raw.url !== "string") return null;
  return {
    number: raw.number,
    title: raw.title ?? `#${raw.number}`,
    url: raw.url,
    state: raw.merged ? "merged" : raw.state === "OPEN" ? "open" : "closed",
    draft: raw.isDraft === true,
    author: raw.author?.login,
    authorIsBot: isBot(raw.author),
    branch: raw.headRefName,
    closes,
    createdAt: ms(raw.createdAt),
    updatedAt: ms(raw.updatedAt),
    ...(raw.mergedAt ? { mergedAt: ms(raw.mergedAt) } : {}),
  };
}

/**
 * A comment as the dashboard shows it: plain text, clipped. Markup that
 * reads as noise out of context (HTML comments, images, link targets,
 * emphasis, fenced code) is reduced to its words.
 */
export function commentText(body: string): string {
  const t = body
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/(^|\s)#{1,6}\s+/g, "$1")
    .replace(/[*_`~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > COMMENT_CHARS ? `${t.slice(0, COMMENT_CHARS - 1).trimEnd()}…` : t;
}

/**
 * Read one issue's answer. Pull requests come from the closing references
 * and from every cross-reference or connection in the timeline, merged by
 * number (a closing link anywhere makes it `closes`); ones from other
 * repositories are left out, since nothing here can act on them. The verdict
 * and branch are the agent's newest — never read from polishd's own request,
 * whose template carries a block of its own.
 */
export function normalizeIssueThread(
  raw: RawIssueThread | null | undefined,
  opts: { defaultBranch?: string } = {},
): PolishdIssueThread | null {
  if (!raw || typeof raw.number !== "number") return null;
  const number = raw.number;
  const pulls = new Map<number, PolishdLinkedPull>();
  const addPull = (p: PolishdLinkedPull | null) => {
    if (!p) return;
    const seen = pulls.get(p.number);
    pulls.set(p.number, seen ? { ...seen, closes: seen.closes || p.closes } : p);
  };
  for (const p of raw.closedByPullRequestsReferences?.nodes ?? []) addPull(toPull(p, true));

  const events: PolishdIssueEvent[] = [];
  const agentComments: { body: string; at: number }[] = [];
  for (const node of raw.timelineItems?.nodes ?? []) {
    if (!node) continue;
    const at = ms(node.createdAt);
    const actor = node.actor?.login;
    switch (node.__typename) {
      case "IssueComment": {
        const body = node.body ?? "";
        const fromPolishd = body.includes(FIX_REQUEST_MARKER);
        const bot = isBot(node.author);
        const isAgent = bot && isAgentLogin(node.author?.login) && !fromPolishd;
        // An agent edits one comment as it works; its last edit is its answer.
        if (isAgent) agentComments.push({ body, at: ms(node.updatedAt) || at });
        events.push({
          kind: "comment",
          at,
          author: node.author?.login,
          isBot: bot,
          isAgent,
          fromPolishd,
          text: commentText(body),
          url: node.url ?? "",
        });
        break;
      }
      case "CrossReferencedEvent":
      case "ConnectedEvent": {
        if (node.isCrossRepository) break;
        const closes = node.__typename === "ConnectedEvent" || node.willCloseTarget === true;
        const pull = toPull(node.__typename === "ConnectedEvent" ? node.subject : node.source, closes);
        if (!pull) break;
        addPull(pull);
        events.push({ kind: "referenced", at, actor, pull: pull.number, closes });
        break;
      }
      case "ClosedEvent":
        events.push({
          kind: "closed",
          at,
          actor,
          ...(node.stateReason ? { reason: node.stateReason.toLowerCase() } : {}),
          ...(node.closer?.__typename === "PullRequest" && typeof node.closer.number === "number"
            ? { byPull: node.closer.number }
            : {}),
        });
        break;
      case "ReopenedEvent":
        events.push({ kind: "reopened", at, actor });
        break;
      case "AssignedEvent":
        events.push({ kind: "assigned", at, actor, ...(node.assignee?.login ? { assignee: node.assignee.login } : {}) });
        break;
      case "LabeledEvent":
        if (node.label?.name) events.push({ kind: "labeled", at, actor, label: node.label.name });
        break;
    }
  }

  agentComments.sort((a, b) => b.at - a.at);
  const where = { issueNumber: number, defaultBranch: opts.defaultBranch };
  let verdict: PolishdIssueThread["verdict"];
  let agentBranch: string | undefined;
  let fixLink: PolishdIssueThread["fixLink"];
  for (const c of agentComments) {
    verdict ??= parseAgentVerdict(c.body, c.at) ?? undefined;
    agentBranch ??= branchFromComment(c.body, where);
    if (!fixLink) {
      const link = fixLinkFromComment(c.body, where);
      if (link) fixLink = { ...link, at: c.at };
    }
  }
  agentBranch ??= fixLink?.branch ?? verdict?.branch;

  events.sort((a, b) => a.at - b.at);
  return {
    number,
    pulls: [...pulls.values()].sort((a, b) => b.updatedAt - a.updatedAt),
    events,
    ...(verdict ? { verdict } : {}),
    ...(agentBranch ? { agentBranch } : {}),
    ...(fixLink ? { fixLink } : {}),
  };
}
