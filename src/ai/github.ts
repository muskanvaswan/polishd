/**
 * Polishd — GitHub API client (server only).
 *
 * A thin client over GitHub's REST API for the repo the owner connected during
 * onboarding. Capabilities, all scoped to that one repo: read and search source
 * (Contents + code-search APIs — lets the AI layer ground its findings in real
 * code even where the source tree isn't on disk, e.g. Vercel), create branches,
 * open pull requests, and file issues. The "loss → verified bug" orchestration
 * that uses this client lives in issues.ts.
 *
 * The token lives in the same server-side settings blob as the model API key
 * and never reaches the browser; the client only sees a "connected" flag. A
 * fine-grained PAT with Contents (read), Issues (write), and Pull requests
 * (write) on the one repo is all it needs.
 */
import { resolveSettings } from "./settings";
import type { PolishdGithubStatus, VerifyGithubResult } from "./types";

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

/** One GitHub API call. Throws with GitHub's own message on non-2xx. */
async function gh<T>(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
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
