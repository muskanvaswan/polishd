/**
 * Polishd — the build the server is running (server only).
 *
 * The fallback for batches that arrive without a build of their own: a client
 * bundle built without `NEXT_PUBLIC_POLISHD_BUILD` (or Vercel's public commit
 * variable) doesn't know its build, but the server often does. Hosts set
 * their commit in the environment — Vercel, Netlify, Cloudflare, Railway,
 * Render and Heroku each under their own name, all read here — and
 * `POLISHD_BUILD` names it explicitly for anyone else. In development there
 * is no deployment, so the build is the checked-out commit, read from git.
 *
 * Server-stamped builds are an approximation of the client's: a tab left
 * open across a deploy keeps posting from the old bundle and is tagged with
 * the new build. That is why the client's own label wins when it has one.
 */
import { execFile } from "node:child_process";

import { sanitizeBuild } from "../shared/build";

/**
 * Where hosts put the commit, most specific first. The `NEXT_PUBLIC_` pair is
 * read on the server too so a host that set it for the client isn't stamped
 * differently by a server function that happens to see it as well.
 */
const BUILD_ENV_KEYS = [
  "POLISHD_BUILD",
  "NEXT_PUBLIC_POLISHD_BUILD",
  "VERCEL_GIT_COMMIT_SHA",
  "NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA",
  "COMMIT_REF", // Netlify
  "CF_PAGES_COMMIT_SHA", // Cloudflare Pages
  "RAILWAY_GIT_COMMIT_SHA",
  "RENDER_GIT_COMMIT",
  "HEROKU_SLUG_COMMIT",
  "SOURCE_VERSION", // Heroku build
  "GITHUB_SHA",
  "CI_COMMIT_SHA", // GitLab
];

/** The build named in the environment, or null when no host variable is set. */
export function buildFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  for (const key of BUILD_ENV_KEYS) {
    const value = sanitizeBuild(env[key]);
    if (value) return value;
  }
  return null;
}

/**
 * How long a development answer from git is trusted. The dev server outlives
 * many commits, so HEAD is re-read — but not per beacon.
 */
const GIT_TTL_MS = 15_000;

let gitBuild: { value: string | null; at: number } | null = null;
let gitPending: Promise<string | null> | null = null;

/** HEAD of the repository the app runs from, or null outside one. */
function readGitHead(): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      execFile(
        "git",
        ["rev-parse", "HEAD"],
        { cwd: process.cwd(), timeout: 2_000, windowsHide: true },
        (err, stdout) => resolve(err ? null : sanitizeBuild(stdout)),
      );
    } catch {
      resolve(null);
    }
  });
}

/**
 * The build to stamp on a batch that named none.
 *
 * The environment is read per call — it's cheap, and a serverless host sets it
 * before the first request. Git is only asked in development, where it's the
 * only source there is, and its answer is cached for a few seconds so a
 * page's worth of beacons costs one spawn at most. In production a missing
 * variable means no build, never a child process per request.
 */
export async function resolveServerBuild(): Promise<string | null> {
  const fromEnv = buildFromEnv();
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === "production") return null;

  const now = Date.now();
  if (gitBuild && now - gitBuild.at < GIT_TTL_MS) return gitBuild.value;
  if (!gitPending) {
    gitPending = readGitHead().then((value) => {
      gitBuild = { value, at: Date.now() };
      gitPending = null;
      return value;
    });
  }
  return gitPending;
}
