/**
 * Polishd — GitHub API client (server only).
 *
 * A thin client over GitHub's REST API for the repo the owner connected during
 * onboarding. Capabilities, all scoped to that one repo: list, read and search
 * source (Git trees/blobs, Contents and code-search APIs — lets the AI layer
 * scan the codebase and ground its findings in real code even where the source
 * tree isn't on disk, e.g. Vercel), create branches,
 * open pull requests, and file issues — then read those issues back, which is
 * what the dashboard's Issues tab lists. The "loss → verified bug"
 * orchestration that uses this client lives in issues.ts; the Fix dispatch
 * card's reads (workflow files, assignable actors, an issue's activity) and
 * writes (comment, assign, close) are at the bottom, used by dispatch.ts.
 *
 * The token lives in the same server-side settings blob as the model API key
 * and never reaches the browser; the client only sees a "connected" flag. A
 * fine-grained PAT with Contents (read), Issues (write), and Pull requests
 * (write) on the one repo is all it needs.
 */
import {
  ISSUE_PAGE_SIZE,
  MAX_ISSUE_PAGES,
  keepPaging,
  worthListing,
} from "./issue-pages";
import { Lru } from "./lru";
import { resolveSettings } from "./settings";
import {
  workflowPaths,
  type DispatchActivity,
  type DispatchPendingPull,
  type DispatchWorkflowFile,
} from "./dispatch-readiness";
import type {
  PolishdGithubIssue,
  PolishdGithubStatus,
  VerifyGithubResult,
} from "./types";

/**
 * GitHub's REST base. `POLISHD_GITHUB_API` points it elsewhere — a GitHub
 * Enterprise Server's `https://ghe.example.com/api/v3`.
 */
const API = (process.env.POLISHD_GITHUB_API?.trim() || "https://api.github.com").replace(/\/+$/, "");

/** The connected repo + token, or null when either half is missing. */
async function connection(): Promise<{ repo: string; token: string } | null> {
  const { settings } = await resolveSettings();
  const repo = settings.githubRepo?.trim();
  const token = settings.githubToken?.trim();
  if (!repo || !token) return null;
  return { repo, token };
}

/** True when both a repo and a token are configured. */
export async function isGithubConnected(): Promise<boolean> {
  return (await connection()) !== null;
}

/** How long one GitHub read may take before it's abandoned. */
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Bounds on a request: `timeoutMs` for this one call, `signal` for the work
 * it's part of (a caller's overall budget). Either aborting fails the call.
 * Reads get `REQUEST_TIMEOUT_MS` by default; writes get no timer unless one
 * is passed — abandoning a create GitHub finishes anyway is how an issue
 * gets filed twice.
 */
export interface GithubRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** One GitHub API call. Throws with GitHub's own message on non-2xx, or on timeout. */
async function gh<T>(
  token: string,
  method: string,
  path: string,
  body?: unknown,
  opts: GithubRequestOptions = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? (method === "GET" ? REQUEST_TIMEOUT_MS : undefined);
  const signals = [
    ...(timeoutMs !== undefined ? [AbortSignal.timeout(timeoutMs)] : []),
    ...(opts.signal ? [opts.signal] : []),
  ];
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
    signal: signals.length ? AbortSignal.any(signals) : undefined,
  });
  if (!res.ok) {
    let message = `GitHub responded ${res.status}`;
    try {
      const err = (await res.json()) as { message?: string };
      if (err.message) message = `GitHub: ${err.message} (${res.status})`;
    } catch {
      /* keep the status-only message */
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

// ── Verify (onboarding) ──────────────────────────────────────────────────────

interface RepoResponse {
  full_name: string;
  default_branch: string;
  has_issues: boolean;
  permissions?: { push?: boolean };
}

/**
 * Check the saved token against the saved repo: does it exist, can we read it,
 * can we push (branches/PRs), are issues enabled? Called right after the owner
 * saves the connection so bad tokens fail at setup, not at first use.
 */
export async function verifyGithubConnection(): Promise<VerifyGithubResult> {
  const conn = await connection();
  if (!conn) {
    return {
      ok: false,
      error: "not-connected",
      message: "Add a repository and access token first.",
    };
  }
  try {
    const repo = await gh<RepoResponse>(conn.token, "GET", `/repos/${conn.repo}`);
    return {
      ok: true,
      status: {
        repo: repo.full_name,
        defaultBranch: repo.default_branch,
        canPush: repo.permissions?.push === true,
        issuesEnabled: repo.has_issues,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: "github-error",
      message: err instanceof Error ? err.message : "Could not reach GitHub.",
    };
  }
}

/** The verified connection status, or null when not connected / unreachable. */
export async function getGithubStatus(): Promise<PolishdGithubStatus | null> {
  const res = await verifyGithubConnection();
  return res.ok ? res.status : null;
}

// ── Read source ──────────────────────────────────────────────────────────────

/**
 * Read one file from the connected repo (default branch unless `ref` given).
 * Returns null when the path doesn't exist or nothing is connected — callers
 * treat GitHub as a fallback source tree, not a hard dependency.
 */
export async function readGithubFile(
  path: string,
  ref?: string,
): Promise<string | null> {
  const conn = await connection();
  if (!conn) return null;
  try {
    const file = await gh<{ content?: string; encoding?: string }>(
      conn.token,
      "GET",
      `/repos/${conn.repo}/contents/${encodeURI(path)}${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`,
    );
    if (file.encoding !== "base64" || typeof file.content !== "string") return null;
    return Buffer.from(file.content, "base64").toString("utf8");
  } catch {
    return null;
  }
}

/** Every file on the repo's default branch, from one recursive tree listing. */
export interface GithubTree {
  /** The repo as GitHub reports it. */
  repo: string;
  /** The branch the listing was taken from. */
  ref: string;
  files: { path: string; size: number; sha: string }[];
  /** True when GitHub cut the listing short (repos past ~100k entries). */
  truncated: boolean;
}

// Reads of source are repeated on every summary and scan, and most of what
// they return can't change: a commit's listing and a blob's content are fixed
// by their sha. Only the default branch's name and head are asked each time.

/** The repo's full name and default branch, re-checked every few minutes. */
const branchCache = new Lru<{ repo: string; ref: string }>({ maxEntries: 8, ttlMs: 10 * 60_000 });
/** Listings by `repo@commit` — a few, since a big repo's listing is big. */
const treeCache = new Lru<GithubTree>({ maxEntries: 2 });
/** File contents by blob sha, up to a few MB of text. */
const blobCache = new Lru<string>({ maxEntries: 5_000, maxSize: 8_000_000, sizeOf: (s) => s.length });

/**
 * List the default branch's files. Asks for the branch's head commit (one
 * call; two when the branch name isn't cached) and lists it only when that
 * commit hasn't been listed already. This is what lets the codebase scan run
 * where the source isn't on disk. Null when nothing is connected; throws with
 * GitHub's message otherwise, so a token without Contents (read) fails the
 * scan with a reason.
 */
export async function readGithubTree(opts: GithubRequestOptions = {}): Promise<GithubTree | null> {
  const conn = await connection();
  if (!conn) return null;
  let branch = branchCache.get(conn.repo);
  if (!branch) {
    const repo = await gh<RepoResponse>(conn.token, "GET", `/repos/${conn.repo}`, undefined, opts);
    branch = { repo: repo.full_name, ref: repo.default_branch };
    branchCache.set(conn.repo, branch);
  }
  const head = await gh<{ object: { sha: string } }>(
    conn.token,
    "GET",
    `/repos/${conn.repo}/git/ref/heads/${encodeURIComponent(branch.ref)}`,
    undefined,
    opts,
  );
  const key = `${conn.repo}@${head.object.sha}`;
  const cached = treeCache.get(key);
  if (cached) return cached;
  const tree = await gh<{
    tree: { path: string; type: string; size?: number; sha: string }[];
    truncated: boolean;
  }>(
    conn.token,
    "GET",
    `/repos/${conn.repo}/git/trees/${head.object.sha}?recursive=1`,
    undefined,
    opts,
  );
  const listing: GithubTree = {
    repo: branch.repo,
    ref: branch.ref,
    files: tree.tree
      .filter((e) => e.type === "blob")
      .map((e) => ({ path: e.path, size: e.size ?? 0, sha: e.sha })),
    truncated: tree.truncated,
  };
  treeCache.set(key, listing);
  return listing;
}

/** How many blob reads run at once. */
const BLOB_FETCH_CONCURRENCY = 8;

/**
 * Read file contents by blob sha (from `readGithubTree`), a few at a time,
 * from the cache where they've been read before. A blob that can't be read
 * (an error, a timeout, the caller's budget running out) is simply absent
 * from the map — one unreadable file shouldn't sink a scan of sixty, and the
 * caller can see which are missing.
 */
export async function readGithubBlobs(
  shas: string[],
  opts: GithubRequestOptions = {},
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(shas)];
  const missing: string[] = [];
  for (const sha of unique) {
    const hit = blobCache.get(sha);
    if (hit !== undefined) out.set(sha, hit);
    else missing.push(sha);
  }
  if (!missing.length) return out;
  const conn = await connection();
  if (!conn) return out;
  for (let i = 0; i < missing.length; i += BLOB_FETCH_CONCURRENCY) {
    if (opts.signal?.aborted) break; // out of budget: the rest stay unread
    const slice = missing.slice(i, i + BLOB_FETCH_CONCURRENCY);
    await Promise.all(
      slice.map(async (sha) => {
        try {
          const blob = await gh<{ content?: string; encoding?: string }>(
            conn.token,
            "GET",
            `/repos/${conn.repo}/git/blobs/${sha}`,
            undefined,
            opts,
          );
          if (blob.encoding === "base64" && typeof blob.content === "string") {
            const text = Buffer.from(blob.content, "base64").toString("utf8");
            blobCache.set(sha, text);
            out.set(sha, text);
          }
        } catch {
          /* skip this file */
        }
      }),
    );
  }
  return out;
}

/**
 * Find files in the connected repo whose content matches the given terms
 * (ANDed), via GitHub's code search. Returns file paths, best matches first,
 * or [] on any failure — search is an enrichment, never a hard dependency.
 */
export async function searchGithubCode(terms: string[], max = 3): Promise<string[]> {
  const conn = await connection();
  if (!conn || terms.length === 0) return [];
  try {
    const q = encodeURIComponent(`${terms.join(" ")} repo:${conn.repo}`);
    const res = await gh<{ items?: { path: string }[] }>(
      conn.token,
      "GET",
      `/search/code?q=${q}&per_page=${max}`,
    );
    return (res.items ?? []).map((i) => i.path).slice(0, max);
  } catch {
    return [];
  }
}

// ── Branches & pull requests ─────────────────────────────────────────────────

/**
 * Create a branch off the repo's default branch (or `from`). Returns the new
 * branch name. Throws on failure — callers surface GitHub's message.
 */
export async function createGithubBranch(
  name: string,
  from?: string,
): Promise<string> {
  const conn = await connection();
  if (!conn) throw new Error("GitHub is not connected.");
  const base =
    from ??
    (await gh<RepoResponse>(conn.token, "GET", `/repos/${conn.repo}`)).default_branch;
  const ref = await gh<{ object: { sha: string } }>(
    conn.token,
    "GET",
    `/repos/${conn.repo}/git/ref/heads/${encodeURIComponent(base)}`,
  );
  await gh(conn.token, "POST", `/repos/${conn.repo}/git/refs`, {
    ref: `refs/heads/${name}`,
    sha: ref.object.sha,
  });
  return name;
}

/**
 * Open a pull request from `head` into `base` (default branch when omitted).
 * Returns the PR's URL and number. Throws on failure.
 */
export async function createGithubPullRequest(input: {
  title: string;
  body?: string;
  head: string;
  base?: string;
}): Promise<{ url: string; number: number }> {
  const conn = await connection();
  if (!conn) throw new Error("GitHub is not connected.");
  const base =
    input.base ??
    (await gh<RepoResponse>(conn.token, "GET", `/repos/${conn.repo}`)).default_branch;
  const pr = await gh<{ html_url: string; number: number }>(
    conn.token,
    "POST",
    `/repos/${conn.repo}/pulls`,
    { title: input.title, body: input.body ?? "", head: input.head, base },
  );
  return { url: pr.html_url, number: pr.number };
}

// ── Issues ───────────────────────────────────────────────────────────────────

/** The issue payload GitHub returns, in the shape this client cares about. */
interface IssueResponse {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: string;
  state_reason?: string | null;
  labels?: (string | { name?: string })[];
  user?: { login?: string } | null;
  assignees?: { login?: string }[] | null;
  comments?: number;
  created_at: string;
  updated_at: string;
  closed_at?: string | null;
  /** Present when the "issue" is a pull request (the issues API lists both). */
  pull_request?: unknown;
}

function toIssue(raw: IssueResponse): PolishdGithubIssue {
  return {
    number: raw.number,
    title: raw.title,
    body: raw.body ?? "",
    url: raw.html_url,
    state: raw.state === "closed" ? "closed" : "open",
    stateReason: raw.state_reason ?? undefined,
    labels: (raw.labels ?? [])
      .map((l) => (typeof l === "string" ? l : l.name))
      .filter((n): n is string => typeof n === "string" && n.length > 0),
    author: raw.user?.login ?? undefined,
    assignees: (raw.assignees ?? [])
      .map((a) => a.login)
      .filter((n): n is string => typeof n === "string" && n.length > 0),
    comments: raw.comments ?? 0,
    createdAt: Date.parse(raw.created_at),
    updatedAt: Date.parse(raw.updated_at),
    closedAt: raw.closed_at ? Date.parse(raw.closed_at) : undefined,
  };
}

/**
 * Read one issue by number. Returns null when it can't be read — deleted,
 * transferred, or the token lost access — so a single missing issue never
 * takes down the list that contains it.
 */
export async function readGithubIssue(number: number): Promise<PolishdGithubIssue | null> {
  const conn = await connection();
  if (!conn) return null;
  try {
    return toIssue(
      await gh<IssueResponse>(conn.token, "GET", `/repos/${conn.repo}/issues/${number}`),
    );
  } catch {
    return null;
  }
}

/** How many individual issue reads run at once, when it comes to that. */
const ISSUE_FETCH_CONCURRENCY = 6;

/**
 * Read a known set of issues by number, in as few API calls as possible.
 *
 * The naive way — one call per number — is what the repo's own issue list
 * saves us from: it returns whole issue objects, body and all, a hundred at a
 * time, so a single call usually answers for every issue polishd has ever
 * filed. When to stop asking for pages is its own rule, in issue-pages.ts.
 *
 * Anything the pages didn't reach is read individually afterwards, which is
 * also the whole strategy when there's only one number to find.
 *
 * Numbers that can't be read at all (deleted, transferred, token access
 * narrowed) are simply absent from the returned map.
 */
export async function readGithubIssues(
  numbers: number[],
): Promise<Map<number, PolishdGithubIssue>> {
  const found = new Map<number, PolishdGithubIssue>();
  const conn = await connection();
  if (!conn || numbers.length === 0) return found;

  const wanted = new Set(numbers);
  const oldestWanted = Math.min(...numbers);

  let pagesRead = 0;
  let morePages = worthListing(wanted.size);
  while (morePages) {
    let batch: IssueResponse[];
    try {
      batch = await gh<IssueResponse[]>(
        conn.token,
        "GET",
        `/repos/${conn.repo}/issues?state=all&per_page=${ISSUE_PAGE_SIZE}&page=${pagesRead + 1}`,
      );
    } catch {
      break; // fall through to the per-issue reads
    }
    pagesRead++;
    let lowestSeen = Infinity;
    for (const raw of batch) {
      if (wanted.has(raw.number)) found.set(raw.number, toIssue(raw));
      lowestSeen = Math.min(lowestSeen, raw.number);
    }
    morePages = keepPaging({
      pagesRead,
      batchSize: batch.length,
      lowestSeen,
      oldestWanted,
      outstanding: wanted.size - found.size,
    });
  }

  const missing = numbers.filter((n) => !found.has(n));
  for (let i = 0; i < missing.length; i += ISSUE_FETCH_CONCURRENCY) {
    const slice = missing.slice(i, i + ISSUE_FETCH_CONCURRENCY);
    for (const issue of await Promise.all(slice.map((n) => readGithubIssue(n)))) {
      if (issue) found.set(issue.number, issue);
    }
  }
  return found;
}

/** How many of the newest issues `findRecentGithubIssue` looks through. */
const RECENT_ISSUES = 50;

/**
 * The newest issue among the repo's latest that `match` accepts, or null —
 * including when the list can't be read. This is how a filing whose outcome
 * was never heard (the request failed after GitHub may already have created
 * the issue) is found again instead of being filed a second time.
 */
export async function findRecentGithubIssue(
  match: (issue: PolishdGithubIssue) => boolean,
): Promise<PolishdGithubIssue | null> {
  const conn = await connection();
  if (!conn) return null;
  try {
    const batch = await gh<IssueResponse[]>(
      conn.token,
      "GET",
      `/repos/${conn.repo}/issues?state=all&sort=created&direction=desc&per_page=${RECENT_ISSUES}`,
    );
    for (const raw of batch) {
      if (raw.pull_request) continue;
      const issue = toIssue(raw);
      if (match(issue)) return issue;
    }
  } catch {
    /* unreadable: nothing found */
  }
  return null;
}

/** File an issue in the connected repo. Throws on failure. */
export async function createGithubIssue(input: {
  title: string;
  body?: string;
  labels?: string[];
}): Promise<{ url: string; number: number; nodeId?: string }> {
  const conn = await connection();
  if (!conn) throw new Error("GitHub is not connected.");
  const issue = await gh<{ html_url: string; number: number; node_id?: string }>(
    conn.token,
    "POST",
    `/repos/${conn.repo}/issues`,
    { title: input.title, body: input.body ?? "", labels: input.labels },
  );
  return { url: issue.html_url, number: issue.number, nodeId: issue.node_id };
}

/** Comment on an issue. Throws on failure. */
export async function createGithubIssueComment(number: number, body: string): Promise<void> {
  const conn = await connection();
  if (!conn) throw new Error("GitHub is not connected.");
  await gh(conn.token, "POST", `/repos/${conn.repo}/issues/${number}/comments`, { body });
}

/**
 * Close an issue, with a comment first when one is given. The comment is
 * best-effort; the close is what matters and is what throws.
 */
export async function closeGithubIssue(number: number, comment?: string): Promise<void> {
  const conn = await connection();
  if (!conn) throw new Error("GitHub is not connected.");
  if (comment) {
    try {
      await createGithubIssueComment(number, comment);
    } catch {
      /* the close still goes ahead */
    }
  }
  await gh(conn.token, "PATCH", `/repos/${conn.repo}/issues/${number}`, {
    state: "closed",
    state_reason: "completed",
  });
}

// ── Fix dispatch: what the repo has ─────────────────────────────────────────

/** The repo facts the dispatch readiness check starts from. Throws on failure. */
export async function readGithubRepoFacts(): Promise<{
  repo: string;
  defaultBranch: string;
  canWrite: boolean | null;
}> {
  const conn = await connection();
  if (!conn) throw new Error("GitHub is not connected.");
  const repo = await gh<RepoResponse>(conn.token, "GET", `/repos/${conn.repo}`);
  return {
    repo: repo.full_name,
    defaultBranch: repo.default_branch,
    canWrite: typeof repo.permissions?.push === "boolean" ? repo.permissions.push : null,
  };
}

/**
 * Every file under `.github/workflows/` on the default branch, with its
 * text, plus the branch they were read from. Throws when the tree can't be
 * listed; a workflow whose blob can't be read is left out.
 */
export async function readGithubWorkflowFiles(): Promise<{
  ref: string;
  workflows: DispatchWorkflowFile[];
}> {
  const tree = await readGithubTree();
  if (!tree) throw new Error("GitHub is not connected.");
  const wanted = new Set(workflowPaths(tree.files.map((f) => f.path)));
  const entries = tree.files.filter((f) => wanted.has(f.path));
  const blobs = await readGithubBlobs(entries.map((f) => f.sha));
  const workflows: DispatchWorkflowFile[] = [];
  for (const f of entries) {
    const text = blobs.get(f.sha);
    if (text !== undefined) workflows.push({ path: f.path, text });
  }
  return { ref: tree.ref, workflows };
}

/** How many open pull requests are looked at for an unmerged workflow. */
const WORKFLOW_PULL_CANDIDATES = 3;

/**
 * Open pull requests that add a Claude workflow — what `/install-github-app`
 * leaves behind until it's merged. Best-effort: [] when the list can't be
 * read. Only pull requests whose branch or title mention Claude have their
 * files read, and at most a few of them.
 */
export async function findGithubWorkflowPulls(): Promise<DispatchPendingPull[]> {
  const conn = await connection();
  if (!conn) return [];
  try {
    const pulls = await gh<
      { number: number; title: string; html_url: string; head?: { ref?: string } }[]
    >(conn.token, "GET", `/repos/${conn.repo}/pulls?state=open&per_page=50`);
    const candidates = pulls
      .filter((p) => /claude/i.test(p.head?.ref ?? "") || /claude/i.test(p.title))
      .slice(0, WORKFLOW_PULL_CANDIDATES);
    const out: DispatchPendingPull[] = [];
    for (const p of candidates) {
      const files = await gh<{ filename: string; status?: string }[]>(
        conn.token,
        "GET",
        `/repos/${conn.repo}/pulls/${p.number}/files?per_page=100`,
      );
      if (workflowPaths(files.map((f) => f.filename)).length) {
        out.push({ number: p.number, title: p.title, url: p.html_url });
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** The GraphQL endpoint's reply shape. A 200 can still carry errors. */
interface GraphqlResponse<T> {
  data?: T;
  errors?: { message?: string }[];
}

async function graphql<T>(token: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await gh<GraphqlResponse<T>>(token, "POST", "/graphql", { query, variables }, {
    timeoutMs: REQUEST_TIMEOUT_MS,
  });
  if (res.errors?.length || !res.data) {
    throw new Error(`GitHub GraphQL: ${res.errors?.[0]?.message ?? "no data"}`);
  }
  return res.data;
}

/** The login GitHub lists the Copilot coding agent under. */
const COPILOT_AGENT_LOGIN = "copilot-swe-agent";

/**
 * The Copilot coding agent's node id, if it can be assigned issues on the
 * connected repo — GitHub's documented check, `suggestedActors` with the
 * CAN_BE_ASSIGNED capability. Null when the token can't run GraphQL (or the
 * query fails for any reason), which the caller shows as "couldn't ask"
 * rather than "no".
 */
export async function findCopilotAgent(): Promise<{ assignable: boolean; id?: string } | null> {
  const conn = await connection();
  if (!conn) return null;
  const [owner, name] = conn.repo.split("/");
  try {
    const data = await graphql<{
      repository?: {
        suggestedActors?: { nodes?: ({ login?: string; id?: string } | null)[] };
      } | null;
    }>(
      conn.token,
      `query($owner: String!, $name: String!) {
        repository(owner: $owner, name: $name) {
          suggestedActors(capabilities: [CAN_BE_ASSIGNED], first: 100) {
            nodes { login ... on Bot { id } ... on User { id } }
          }
        }
      }`,
      { owner, name },
    );
    const nodes = data.repository?.suggestedActors?.nodes;
    if (!nodes) return null;
    const agent = nodes.find((n) => n?.login === COPILOT_AGENT_LOGIN);
    return agent ? { assignable: true, id: agent.id } : { assignable: false };
  } catch {
    return null;
  }
}

/**
 * Assign an issue to the Copilot coding agent, the way GitHub's docs say to:
 * `replaceActorsForAssignable` with the agent's id. Returns false when the
 * mutation can't run — the test then says Copilot's test is manual.
 */
export async function assignGithubIssueToCopilot(issueNodeId: string, agentId: string): Promise<boolean> {
  const conn = await connection();
  if (!conn) return false;
  try {
    const data = await graphql<{
      replaceActorsForAssignable?: {
        assignable?: { assignees?: { nodes?: ({ login?: string } | null)[] } } | null;
      } | null;
    }>(
      conn.token,
      `mutation($issue: ID!, $actors: [ID!]!) {
        replaceActorsForAssignable(input: { assignableId: $issue, actorIds: $actors }) {
          assignable { ... on Issue { assignees(first: 10) { nodes { login } } } }
        }
      }`,
      { issue: issueNodeId, actors: [agentId] },
    );
    const assignees = data.replaceActorsForAssignable?.assignable?.assignees?.nodes ?? [];
    return assignees.some((a) => a?.login?.toLowerCase().startsWith("copilot"));
  } catch {
    return false;
  }
}

/** One comment or timeline entry, as GitHub returns it. */
interface ActivityResponse {
  event?: string;
  created_at?: string;
  user?: { login?: string; type?: string } | null;
  actor?: { login?: string; type?: string } | null;
}

function toActivity(raw: ActivityResponse, kind: string): DispatchActivity | null {
  const who = raw.user ?? raw.actor;
  const login = who?.login;
  if (!login) return null;
  return {
    login,
    isBot: who?.type === "Bot" || login.endsWith("[bot]"),
    kind,
    at: raw.created_at ? Date.parse(raw.created_at) : 0,
  };
}

/**
 * What has happened on an issue: its comments, and — when asked — its
 * timeline too, which is where Copilot's reaction (a linked pull request)
 * shows up rather than as a comment. Throws when the comments can't be read;
 * a timeline that can't be read is left out.
 */
export async function readGithubIssueActivity(
  number: number,
  opts: { timeline?: boolean } = {},
): Promise<DispatchActivity[]> {
  const conn = await connection();
  if (!conn) throw new Error("GitHub is not connected.");
  const comments = await gh<ActivityResponse[]>(
    conn.token,
    "GET",
    `/repos/${conn.repo}/issues/${number}/comments?per_page=100`,
  );
  const out = comments.map((c) => toActivity(c, "comment")).filter((a): a is DispatchActivity => a !== null);
  if (opts.timeline) {
    try {
      const events = await gh<ActivityResponse[]>(
        conn.token,
        "GET",
        `/repos/${conn.repo}/issues/${number}/timeline?per_page=100`,
      );
      for (const e of events) {
        if (e.event === "commented") continue; // already in the comments
        const a = toActivity(e, e.event ?? "event");
        if (a) out.push(a);
      }
    } catch {
      /* the comments alone will do */
    }
  }
  return out;
}
