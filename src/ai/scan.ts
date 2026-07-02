/**
 * Buffd — host-app source scanner (server only).
 *
 * Reads the consuming app's own source from disk (`process.cwd()`) so the
 * one-time project profile can be generated from real code. This is the ONLY
 * place the AI layer touches source files, and it runs only when the owner
 * clicks "Scan" (or when a summary hits a component the profile doesn't cover,
 * which triggers a tiny targeted read).
 *
 * Token thrift rules:
 *   - Hard budgets: per-file char cap and a total scan budget, so a big app
 *     can't produce a big prompt. Files are ranked (pages/layouts first, then
 *     files matching known component names, then components dirs) and the
 *     budget is spent in that order.
 *   - Only app code: node_modules/.next/tests/etc. are never read.
 *
 * On hosts where source isn't on disk (e.g. a serverless bundle), the scan
 * reports `available: false` and everything degrades gracefully — the profile
 * generated at dev/CI time keeps serving from the database.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export interface ScannedFile {
  /** Path relative to the project root. */
  path: string;
  content: string;
}

export interface SourceScan {
  /** False when no recognizable source tree exists on disk. */
  available: boolean;
  files: ScannedFile[];
  /** BuffdMonitor / data-component identifiers found in the scanned source. */
  identifiers: string[];
  /** Hash of every candidate file's path+size — detects source drift cheaply. */
  fingerprint: string;
  /** True when the budget forced us to drop or clip files. */
  truncated: boolean;
}

const IGNORE_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "dist",
  "build",
  "out",
  "coverage",
  ".buffd",
  ".vercel",
  ".turbo",
  "buffd-next", // never scan ourselves when developed in-repo
]);

const CODE_EXT = /\.(tsx|ts|jsx|js|mjs)$/;
const SKIP_FILE = /(\.d\.ts$|\.test\.|\.spec\.|__tests__|\.stories\.)/;

/** Roots tried in order when the owner hasn't configured `sourceDirs`. */
const DEFAULT_ROOTS = ["src", "app", "components", "pages", "lib"];

/** Root-level docs that anchor the model's understanding of the project. */
const ROOT_DOCS = ["package.json", "README.md"];

const PER_FILE_CHARS = 6_000;
const TOTAL_BUDGET_CHARS = 90_000;
const MAX_FILES = 60;
const MAX_DEPTH = 7;

/** Resolve the directories to walk, relative to the project root. */
function resolveRoots(projectRoot: string, sourceDirs?: string): string[] {
  const wanted = sourceDirs
    ?.split(",")
    .map((s) => s.trim().replace(/^\/+|\/+$/g, ""))
    .filter(Boolean);
  const candidates = wanted?.length ? wanted : DEFAULT_ROOTS;
  const roots = candidates.filter((d) => {
    const full = join(projectRoot, d);
    try {
      return existsSync(full) && statSync(full).isDirectory();
    } catch {
      return false;
    }
  });
  // With a `src/` layout everything lives inside it — don't double-walk.
  if (!wanted?.length && roots.includes("src")) return ["src"];
  return roots;
}

/** Recursively list candidate code files under the roots. */
function listFiles(projectRoot: string, roots: string[]): string[] {
  const found: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > MAX_DEPTH) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name)) walk(full, depth + 1);
      } else if (CODE_EXT.test(entry.name) && !SKIP_FILE.test(entry.name)) {
        found.push(full);
      }
    }
  };
  for (const root of roots) walk(join(projectRoot, root), 0);
  return found;
}

/**
 * Rank a file for the budget. Lower = read first. Pages and layouts define the
 * site's structure; files matching component identifiers explain the things
 * the analytics actually talk about.
 */
function priority(relPath: string, componentNames: string[]): number {
  const base = relPath.toLowerCase();
  if (/(^|\/)(page|layout|route)\.(tsx|ts|jsx|js)$/.test(base)) return 0;
  if (componentNames.some((n) => n && base.includes(n.toLowerCase()))) return 1;
  if (base.includes("/components/") || base.startsWith("components/")) return 2;
  if (base.includes("/app/") || base.startsWith("app/")) return 3;
  return 4;
}

const MONITOR_NAME = /<BuffdMonitor[^>]*\sname\s*=\s*["']([^"']+)["']/g;
const DATA_COMPONENT = /data-component\s*=\s*["']([^"']+)["']/g;

function extractIdentifiers(content: string, into: Set<string>): void {
  for (const re of [MONITOR_NAME, DATA_COMPONENT]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) into.add(m[1]);
  }
}

/** Clip a file to the per-file cap, preferring its head (imports + exports). */
function clipFile(content: string): { text: string; clipped: boolean } {
  const clean = content.replace(/\r\n/g, "\n");
  if (clean.length <= PER_FILE_CHARS) return { text: clean, clipped: false };
  return { text: `${clean.slice(0, PER_FILE_CHARS)}\n/* …clipped by Buffd scan */`, clipped: true };
}

/**
 * Collect the host app's source for the project profile.
 *
 * @param sourceDirs     Owner-configured comma-separated roots (optional).
 * @param componentNames Identifiers seen in analytics — used to prioritize the
 *                       files that explain them.
 */
export function collectSource(
  sourceDirs?: string,
  componentNames: string[] = [],
): SourceScan {
  const projectRoot = process.cwd();
  const roots = resolveRoots(projectRoot, sourceDirs);

  const absPaths = listFiles(projectRoot, roots);
  if (!absPaths.length) {
    return { available: false, files: [], identifiers: [], fingerprint: "", truncated: false };
  }

  // Fingerprint every candidate (path+size) BEFORE budgeting, so any source
  // change — even in a file we later drop — flips the fingerprint.
  const hash = createHash("sha256");
  const sized = absPaths
    .map((abs) => {
      const rel = relative(projectRoot, abs);
      let size = 0;
      try {
        size = statSync(abs).size;
      } catch {
        /* raced deletion — keep size 0 */
      }
      return { abs, rel, size };
    })
    .sort((a, b) => a.rel.localeCompare(b.rel));
  for (const f of sized) hash.update(`${f.rel}:${f.size}\n`);
  const fingerprint = hash.digest("hex").slice(0, 16);

  const ranked = sized.sort(
    (a, b) =>
      priority(a.rel, componentNames) - priority(b.rel, componentNames) ||
      a.rel.localeCompare(b.rel),
  );

  const files: ScannedFile[] = [];
  const identifiers = new Set<string>();
  let spent = 0;
  let truncated = false;

  // Root docs first — cheap and high-signal for "what is this project".
  for (const doc of ROOT_DOCS) {
    const abs = join(projectRoot, doc);
    if (!existsSync(abs)) continue;
    try {
      const { text, clipped } = clipFile(readFileSync(abs, "utf8"));
      files.push({ path: doc, content: text });
      spent += text.length;
      truncated ||= clipped;
    } catch {
      /* unreadable — skip */
    }
  }

  for (const f of ranked) {
    if (files.length >= MAX_FILES || spent >= TOTAL_BUDGET_CHARS) {
      truncated = true;
      break;
    }
    let raw: string;
    try {
      raw = readFileSync(f.abs, "utf8");
    } catch {
      continue;
    }
    extractIdentifiers(raw, identifiers);
    const { text, clipped } = clipFile(raw);
    if (spent + text.length > TOTAL_BUDGET_CHARS) {
      truncated = true;
      continue; // a later, smaller file may still fit
    }
    files.push({ path: f.rel, content: text });
    spent += text.length;
    truncated ||= clipped;
  }

  return { available: true, files, identifiers: [...identifiers].sort(), fingerprint, truncated };
}

/** Budget for the targeted gap-fill read at summary time — deliberately tiny. */
const TARGETED_BUDGET_CHARS = 12_000;

/**
 * Targeted read for summary-time gaps: return ONLY files that mention one of
 * the given identifiers, under a much smaller budget. This is the "the agent
 * only needs the codebase again when the profile doesn't cover something" path.
 */
export function collectTargeted(
  identifiers: string[],
  sourceDirs?: string,
): ScannedFile[] {
  if (!identifiers.length) return [];
  const projectRoot = process.cwd();
  const roots = resolveRoots(projectRoot, sourceDirs);
  const absPaths = listFiles(projectRoot, roots);

  const out: ScannedFile[] = [];
  let spent = 0;
  for (const abs of absPaths) {
    if (spent >= TARGETED_BUDGET_CHARS) break;
    let raw: string;
    try {
      raw = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    if (!identifiers.some((id) => raw.includes(id))) continue;
    const { text } = clipFile(raw);
    if (spent + text.length > TARGETED_BUDGET_CHARS) continue;
    out.push({ path: relative(projectRoot, abs), content: text });
    spent += text.length;
  }
  return out;
}
