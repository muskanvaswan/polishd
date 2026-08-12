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
