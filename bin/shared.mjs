/**
 * Shared helpers for the `polishd` CLI. Node builtins only.
 *
 * `init` and `doctor` have to agree exactly about where things live and which
 * Next major is installed — a doctor that inspected different paths than init
 * wrote would be worse than no doctor at all.
 */
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
 * Load-bearing: 16+ loads `proxy.ts`, 15 loads `middleware.ts`, and writing
 * the wrong one means the file never runs — no session cookie, every beacon
 * still 200, nothing stored, and no error to follow.
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

export const MIN_NODE = { major: 22, minor: 5 };

export function nodeVersionOk() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  return major > MIN_NODE.major || (major === MIN_NODE.major && minor >= MIN_NODE.minor);
}

/** The dist path Tailwind must be told to scan (v4 `@source`, v3 `content`). */
export const DIST_GLOB = "node_modules/@polishd/next/dist";
