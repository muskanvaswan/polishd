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
 * orchestration that uses this client lives in issues.ts.
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
import type {
  PolishdGithubIssue,
  PolishdGithubStatus,
  VerifyGithubResult,
} from "./types";

const API = "https://api.github.com";

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

/** How long one GitHub request may take before it's abandoned. */
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Bounds on a request: `timeoutMs` for this one call, `signal` for the work
 * it's part of (a caller's overall budget). Either aborting fails the call.
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
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? REQUEST_TIMEOUT_MS);
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
    signal: opts.signal ? AbortSignal.any([timeout, opts.signal]) : timeout,
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

/** File an issue in the connected repo. Throws on failure. */
export async function createGithubIssue(input: {
  title: string;
  body?: string;
  labels?: string[];
}): Promise<{ url: string; number: number }> {
  const conn = await connection();
  if (!conn) throw new Error("GitHub is not connected.");
  const issue = await gh<{ html_url: string; number: number }>(
    conn.token,
    "POST",
    `/repos/${conn.repo}/issues`,
    { title: input.title, body: input.body ?? "", labels: input.labels },
  );
  return { url: issue.html_url, number: issue.number };
}
