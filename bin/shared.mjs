/**
 * Shared helpers for the `polishd` CLI. Node builtins only.
 *
 * `init` and `doctor` have to agree exactly about where things live and which
 * Next major is installed — a doctor that inspected different paths than init
 * wrote would be worse than no doctor at all.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

export const c = {
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  warn: (s) => `\x1b[33m${s}\x1b[0m`,
  err: (s) => `\x1b[31m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

export function readJSON(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** Where the app's code lives: `src/app` layout or root `app`. */
export function detectLayout(cwd) {
  const hasSrcApp = existsSync(join(cwd, "src", "app"));
  const hasRootApp = existsSync(join(cwd, "app"));
  return {
    found: hasSrcApp || hasRootApp,
    hasSrcApp,
    base: hasSrcApp ? "src" : "",
    appDir: hasSrcApp ? join("src", "app") : "app",
  };
}

/**
 * Which Next major is actually installed.
 *
 * Two things hang on it: whether the version loads `instrumentation-client.ts`
 * at all (see {@link nextLoadsClientInstrumentation}), and, for an app that
 * already has a proxy, which file name it loads — 16+ loads `proxy.ts`, 15
 * loads `middleware.ts`.
 */
export function detectNextMajor(cwd) {
  // Prefer the resolved install. A declared range ("^16", "latest", "canary")
  // does not tell you what is actually in node_modules.
  const direct = readJSON(join(cwd, "node_modules", "next", "package.json"));
  if (direct?.version) {
    const major = Number.parseInt(direct.version, 10);
    if (Number.isFinite(major)) {
      return { major, version: direct.version, source: "node_modules" };
    }
  }
  // Hoisted / pnpm / workspace installs won't be at that path.
  try {
    const require = createRequire(join(cwd, "package.json"));
    const resolved = readJSON(require.resolve("next/package.json"));
    if (resolved?.version) {
      const major = Number.parseInt(resolved.version, 10);
      if (Number.isFinite(major)) {
        return { major, version: resolved.version, source: "node_modules" };
      }
    }
  } catch {
    // `next` not installed yet, or its exports map hides package.json.
  }
  // Last resort: the declared range. Better than guessing blind.
  const pkg = readJSON(join(cwd, "package.json"));
  const range =
    pkg?.dependencies?.next ?? pkg?.devDependencies?.next ?? pkg?.peerDependencies?.next;
  if (typeof range === "string") {
    const major = Number.parseInt(range.replace(/^[^\d]*/, ""), 10);
    if (Number.isFinite(major)) return { major, version: range, source: "package.json" };
  }
  return { major: null, version: null, source: null };
}

/**
 * Whether an existing install is JavaScript: none of the files init writes
 * exist as TypeScript, but at least one exists as JavaScript. A TS project, a
 * fresh one, or a mixed one stays TypeScript, which is also init's default.
 */
export function detectJsInstall(cwd, base, appDir) {
  const stems = [
    join(base, "proxy"),
    join(base, "middleware"),
    join(base, "instrumentation-client"),
    join(appDir, "api", "polishd", "route"),
  ];
  const has = (exts) =>
    stems.some((stem) => exts.some((ext) => existsSync(join(cwd, `${stem}.${ext}`)))) ||
    exts.some((ext) => existsSync(join(cwd, appDir, "polishd", `page.${ext}x`)));
  return !has(["ts"]) && has(["js"]);
}

/**
 * The proxy's `config.matcher`, as written.
 *
 * Read from the `config` declaration, not the first `matcher:` in the file:
 * a proxy merged with `composePolishd(handler, { matcher: "/admin/:path*" })`
 * has a second one, and that one is the handler's scope, not what Next reads.
 *
 * Returns null when there is no matcher, `{ literal: false }` for a reference
 * (an identifier Next cannot statically read), else the literal's source.
 */
export function findConfigMatcher(src) {
  const at = src.search(/\bconst\s+config\b/);
  if (at === -1) return null;
  const m = src
    .slice(at)
    .match(/\bmatcher\s*:\s*(\[[^\]]*\]|["'`][^"'`]*["'`]|[A-Za-z_$][\w$.]*)/);
  if (!m) return null;
  return { literal: !/^[A-Za-z_$]/.test(m[1]), text: m[1] };
}

/**
 * Could this matcher literal run the proxy on an /api path?
 *
 * An entry is safe when a negative lookahead excludes `api`, when it is just
 * `/`, or when its literal prefix — everything before the first parameter or
 * group — already rules /api out (`/admin/:path*`, `/admin(.*)`). Anything
 * else — `/:path*`, `/(.*)`, `/a(.*)` — can reach /api. Strings that aren't
 * paths (`has` conditions) are ignored.
 */
export function matcherTouchesApi(literal) {
  const entries = [...literal.matchAll(/(["'`])((?:(?!\1).)*)\1/g)]
    .map((m) => m[2])
    .filter((s) => s.startsWith("/"));
  return entries.some((s) => {
    if (/\(\?!.*\bapi\b/.test(s) || s === "/") return false;
    const prefix = s.match(/^[^:(*?[{+\\]*/)[0];
    return "/api/".startsWith(prefix) || prefix === "/api" || prefix.startsWith("/api/");
  });
}

/**
 * The proxy file this app should have, given its Next major.
 * An undetermined version is treated as modern, which is also what init writes.
 */
export function proxyShape(next, base, codeExt) {
  const useMiddleware = next.major !== null && next.major <= 15;
  const name = useMiddleware ? "middleware" : "proxy";
  const other = useMiddleware ? "proxy" : "middleware";
  return {
    useMiddleware,
    name,
    other,
    path: join(base, `${name}.${codeExt}`),
    otherPath: join(base, `${other}.${codeExt}`),
  };
}

const NEXT_CONFIGS = ["next.config.ts", "next.config.mts", "next.config.mjs", "next.config.js", "next.config.cjs"];

/**
 * Whether the app turns on Cache Components (`cacheComponents: true`, top
 * level since Next 16, under `experimental` before it). It changes what the
 * route and page may declare: Next rejects `runtime` and `dynamic` there, and
 * the dashboard has to render inside `<Suspense>`. Read from the config's
 * source, so a value computed at load time (an env check) reads as off.
 */
export function detectCacheComponents(cwd) {
  for (const name of NEXT_CONFIGS) {
    const src = readText(join(cwd, name));
    if (src !== null) return { on: /\bcacheComponents\s*:\s*true\b/.test(src), file: name };
  }
  return { on: false, file: null };
}

/** The first Next that loads `instrumentation-client.ts`, which starts capture. */
export const MIN_NEXT = { major: 15, minor: 3 };

/**
 * Whether the detected Next loads `instrumentation-client.ts`. Below 15.3 Next
 * ignores the file, so `initPolishd()` never runs: no error, no events, an
 * empty dashboard. `null` when it can't be told — nothing detected, or only a
 * declared range, which may resolve to something newer.
 */
export function nextLoadsClientInstrumentation(next) {
  if (next.major === null || next.source !== "node_modules") return null;
  const [major, minor] = next.version.split(".").map((n) => Number.parseInt(n, 10));
  return major > MIN_NEXT.major || (major === MIN_NEXT.major && minor >= MIN_NEXT.minor);
}

export const MIN_NODE = { major: 22, minor: 5 };

export function nodeVersionOk() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  return major > MIN_NODE.major || (major === MIN_NODE.major && minor >= MIN_NODE.minor);
}

/** The dist path Tailwind must be told to scan (v4 `@source`, v3 `content`). */
export const DIST_GLOB = "node_modules/@polishd/next/dist";

// ── Defaults file, GitHub token, Fix workflow ─────────────────────────────────

/** Committed site settings the dashboard opens with. Never a secret. */
export const DEFAULTS_FILE = "polishd.defaults.json";

/**
 * The file's sections and keys, and the keys that would put a secret in git.
 * Mirrors parsePolishdDefaults in src/ai/settings.ts; a test keeps them equal.
 */
export const DEFAULTS_KEYS = {
  ai: ["provider", "model", "baseUrl", "apiKeyEnv", "instructions", "refresh"],
  site: ["description", "audience", "values", "sourceDirs"],
  github: ["repo", "autoIssues"],
  fix: ["auto", "label", "dailyCap"],
};
export const DEFAULTS_SECRET_KEYS = ["ai.apiKey", "ai.key", "github.token", "github.githubToken"];

/**
 * What doctor can tell about a parsed defaults file without the package:
 * secrets that would sit in git, and keys it doesn't know (usually typos).
 * The values themselves are checked when the page registers the file.
 */
export function defaultsFileProblems(raw) {
  const secrets = [];
  const unknown = [];
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { secrets, unknown, notObject: true };
  }
  for (const [section, value] of Object.entries(raw)) {
    if (section === "$schema") continue;
    const keys = DEFAULTS_KEYS[section];
    if (!keys || value === null || typeof value !== "object" || Array.isArray(value)) {
      unknown.push(section);
      continue;
    }
    for (const key of Object.keys(value)) {
      const path = `${section}.${key}`;
      if (DEFAULTS_SECRET_KEYS.includes(path)) secrets.push(path);
      else if (!keys.includes(key)) unknown.push(path);
    }
  }
  return { secrets, unknown, notObject: false };
}

/** The repository root, or null outside git. */
export function gitRoot(cwd) {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/** "owner/name" from the origin remote when it's on GitHub, else null. */
export function detectGithubRepo(cwd) {
  let url;
  try {
    url = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
  const m = /github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url);
  return m ? `${m[1]}/${m[2]}` : null;
}

/**
 * GitHub's new fine-grained token form, filled in for `repo`. Mirrors
 * githubTokenUrl in src/shared/github-token.ts; a test keeps them equal.
 */
export function githubTokenUrl(repo) {
  const valid = repo && /^[\w.-]+\/[\w.-]+$/.test(repo) ? repo : undefined;
  const params = new URLSearchParams();
  params.set("name", (valid ? `Polishd ${valid}` : "Polishd").slice(0, 40));
  params.set(
    "description",
    `Polishd reads the source, files issues and links fix pull requests${valid ? ` on ${valid}` : ""}. ` +
      `Under Repository access, pick only ${valid ?? "the site's repository"}.`,
  );
  if (valid) params.set("target_name", valid.split("/")[0]);
  params.set("expires_in", "366");
  params.set("contents", "read");
  params.set("issues", "write");
  params.set("pull_requests", "write");
  return `https://github.com/settings/personal-access-tokens/new?${params}`;
}

/** Where the Fix workflow goes, and the secret each billing choice reads. */
export const FIX_WORKFLOW_PATH = ".github/workflows/claude.yml";
export const FIX_SECRET = {
  "oauth-token": { name: "CLAUDE_CODE_OAUTH_TOKEN", input: "claude_code_oauth_token" },
  "api-key": { name: "ANTHROPIC_API_KEY", input: "anthropic_api_key" },
};
export const CLAUDE_APP_INSTALL_URL = "https://github.com/apps/claude/installations/new";

/**
 * The workflow the dashboard's Fix card recommends. Mirrors
 * recommendedWorkflow in src/ai/dispatch-readiness.ts; a test keeps them equal.
 */
export function recommendedWorkflow(secret = "oauth-token", maxTurns = 30) {
  const { name, input } = FIX_SECRET[secret];
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
    `          ${input}: \${{ secrets.${name} }}`,
    `          claude_args: "--max-turns ${maxTurns}"`,
    "",
  ].join("\n");
}

/**
 * Polishd's tables and the columns that make each one Polishd's, and the
 * events table's name before 0.3.2. Mirrors src/shared/store-tables.ts; a
 * test keeps them equal.
 */
export const POLISHD_TABLES = {
  polishd_events: ["session_id", "type", "ts", "path", "received_at"],
  polishd_meta: ["key", "value", "updated_at"],
};
export const LEGACY_EVENTS_TABLE = "events";

/** "absent", "polishd" or "foreign", from the columns a table has. */
export function tableOwner(table, columns) {
  if (columns.length === 0) return "absent";
  const required = POLISHD_TABLES[table] ?? POLISHD_TABLES.polishd_events;
  return required.every((col) => columns.includes(col)) ? "polishd" : "foreign";
}
