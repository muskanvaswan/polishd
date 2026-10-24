/**
 * Polishd — what a codebase scan reads (pure).
 *
 * The project profile is built from the host app's source, which can come from
 * one of two places: the disk this server runs on (local dev, CI), or the
 * GitHub repo the owner connected — the only option on a serverless deploy,
 * which ships a bundle, not a source tree. Both sides list candidate files
 * with their sizes, and this module decides the rest the same way for each:
 * which folders count as source, which files are read first, how much of the
 * budget each may spend, and — for a repo, where the app can sit in a
 * subfolder of a monorepo — which folder the app is.
 *
 * Pure, no I/O, so it can be tested: the disk walk lives in scan.ts and the
 * API calls in github.ts.
 */
import { createHash } from "node:crypto";

export interface ScannedFile {
  /** Path relative to the project root (or, for a GitHub scan, the repo root). */
  path: string;
  content: string;
}

export interface SourceScan {
  /** False when no recognizable source tree was found. */
  available: boolean;
  files: ScannedFile[];
  /** PolishdMonitor / data-component identifiers found in the scanned source. */
  identifiers: string[];
  /** Hash of every candidate file's path+size — detects source drift cheaply. */
  fingerprint: string;
  /** True when the budget forced us to drop or clip files. */
  truncated: boolean;
}

export const EMPTY_SCAN: SourceScan = {
  available: false,
  files: [],
  identifiers: [],
  fingerprint: "",
  truncated: false,
};

/** A file the scan could read, before anything is read. */
export interface Candidate {
  /** Path relative to the app root. */
  path: string;
  /** Size in bytes — never less than the characters it reads as. */
  size: number;
}

export const IGNORE_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "dist",
  "build",
  "out",
  "coverage",
  ".polishd",
  ".vercel",
  ".turbo",
  "polishd-next", // never scan ourselves when developed in-repo
]);

const CODE_EXT = /\.(tsx|ts|jsx|js|mjs)$/;
const SKIP_FILE = /(\.d\.ts$|\.test\.|\.spec\.|__tests__|\.stories\.)/;

/** Roots tried in order when the owner hasn't configured `sourceDirs`. */
export const DEFAULT_ROOTS = ["src", "app", "components", "pages", "lib"];

/** Root-level docs that anchor the model's understanding of the project. */
export const ROOT_DOCS = ["package.json", "README.md"];

export const MAX_DEPTH = 7;
const PER_FILE_CHARS = 6_000;
const TOTAL_BUDGET_CHARS = 90_000;
const MAX_FILES = 60;
const CLIP_MARKER = "\n/* …clipped by Polishd scan */";

/** Whether a file name is app code the scan should consider. */
export function isCodeFile(name: string): boolean {
  return !name.startsWith(".") && CODE_EXT.test(name) && !SKIP_FILE.test(name);
}

/** Whether the walk descends into a directory with this name. */
export function isWalkableDir(name: string): boolean {
  return !name.startsWith(".") && !IGNORE_DIRS.has(name);
}

/**
 * The folders to walk, relative to the app root: the owner's comma-separated
 * `sourceDirs` when given, otherwise whichever of the defaults exist. With a
 * `src/` layout everything lives inside it, so the defaults don't double-walk.
 */
export function chooseRoots(
  sourceDirs: string | undefined,
  isDir: (dir: string) => boolean,
): string[] {
  const wanted = (sourceDirs ?? "")
    .split(",")
    .map((s) => s.trim().replace(/^\/+|\/+$/g, ""))
    .filter(Boolean);
  const roots = (wanted.length ? wanted : DEFAULT_ROOTS).filter(isDir);
  if (!wanted.length && roots.includes("src")) return ["src"];
  return roots;
}

/**
 * Rank a file for the budget. Lower = read first. Pages and layouts define the
 * site's structure; files matching component identifiers explain the things
 * the analytics actually talk about.
 */
export function priority(relPath: string, componentNames: string[]): number {
  const base = relPath.toLowerCase();
  if (/(^|\/)(page|layout|route)\.(tsx|ts|jsx|js)$/.test(base)) return 0;
  if (componentNames.some((n) => n && base.includes(n.toLowerCase()))) return 1;
  if (base.includes("/components/") || base.startsWith("components/")) return 2;
  if (base.includes("/app/") || base.startsWith("app/")) return 3;
  return 4;
}

/** Fingerprint every candidate (path+size), so any source change flips it. */
export function fingerprintOf(candidates: Candidate[]): string {
  const hash = createHash("sha256");
  const sorted = [...candidates].sort((a, b) => a.path.localeCompare(b.path));
  for (const f of sorted) hash.update(`${f.path}:${f.size}\n`);
  return hash.digest("hex").slice(0, 16);
}

/** The most a file of this size can add to the prompt once clipped. */
function cost(size: number): number {
  return size > PER_FILE_CHARS ? PER_FILE_CHARS + CLIP_MARKER.length : size;
}

/**
 * Decide which files to read, in order, under the scan budgets — before
 * reading any of them, which is what lets a GitHub scan fetch only the files
 * it will use. Root docs always go first (cheap, high-signal for "what is this
 * project"), then code by `priority`. A file that doesn't fit is skipped, not
 * a stop: a later, smaller one may still fit.
 *
 * Sizes are bytes, which never undercount characters, so a plan can't
 * overspend once the files turn out to be text.
 */
export function planReads(
  docs: Candidate[],
  code: Candidate[],
  componentNames: string[],
): { reads: Candidate[]; dropped: boolean } {
  const reads: Candidate[] = [...docs];
  let spent = docs.reduce((sum, d) => sum + cost(d.size), 0);
  let dropped = false;

  // Overlapping source folders ("app, app/components") list a file twice.
  const ranked = [...new Map(code.map((f) => [f.path, f])).values()].sort(
    (a, b) =>
      priority(a.path, componentNames) - priority(b.path, componentNames) ||
      a.path.localeCompare(b.path),
  );

  for (const f of ranked) {
    if (reads.length >= MAX_FILES || spent >= TOTAL_BUDGET_CHARS) {
      dropped = true;
      break;
    }
    if (spent + cost(f.size) > TOTAL_BUDGET_CHARS) {
      dropped = true;
      continue;
    }
    reads.push(f);
    spent += cost(f.size);
  }
  return { reads, dropped };
}

/** Clip a file to the per-file cap, preferring its head (imports + exports). */
export function clipFile(content: string): { text: string; clipped: boolean } {
  const clean = content.replace(/\r\n/g, "\n");
  if (clean.length <= PER_FILE_CHARS) return { text: clean, clipped: false };
  return { text: clean.slice(0, PER_FILE_CHARS) + CLIP_MARKER, clipped: true };
}

const MONITOR_NAME = /<PolishdMonitor[^>]*\sname\s*=\s*["']([^"']+)["']/g;
const DATA_COMPONENT = /data-component\s*=\s*["']([^"']+)["']/g;

function extractIdentifiers(content: string, into: Set<string>): void {
  for (const re of [MONITOR_NAME, DATA_COMPONENT]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) into.add(m[1]);
  }
}

/**
 * Turn the files a plan read into the scan the profile is written from:
 * clipped to the per-file cap, with identifiers pulled from the code (never
 * the docs — a README's examples aren't the site's components).
 */
export function buildScan(
  read: (ScannedFile & { doc: boolean })[],
  dropped: boolean,
  fingerprint: string,
): SourceScan {
  const identifiers = new Set<string>();
  let truncated = dropped;
  const files = read.map((f) => {
    if (!f.doc) extractIdentifiers(f.content, identifiers);
    const { text, clipped } = clipFile(f.content);
    truncated ||= clipped;
    return { path: f.path, content: text };
  });
  return { available: true, files, identifiers: [...identifiers].sort(), fingerprint, truncated };
}

// ── Repositories ─────────────────────────────────────────────────────────────

/**
 * Every folder in a repo that looks like the root of a Next.js app — a
 * `package.json` beside a `next.config.*` or an `app/` / `pages/` tree — best
 * guess first: the repo root, then shallower folders before deeper ones. `""`
 * is the repo root. Paths are the repo's file paths, `/`-separated.
 */
export function appRootCandidates(paths: string[]): string[] {
  const files = new Set(paths);
  const dirs = new Set<string>();
  for (const p of paths) {
    const parts = p.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }

  const out: string[] = [];
  for (const p of paths) {
    if (p !== "package.json" && !p.endsWith("/package.json")) continue;
    const dir = p.slice(0, -"package.json".length).replace(/\/$/, "");
    if (dir && !dir.split("/").every(isWalkableDir)) continue;
    const at = (rel: string) => (dir ? `${dir}/${rel}` : rel);
    const isApp =
      ["next.config.js", "next.config.mjs", "next.config.ts", "next.config.cjs"].some((c) =>
        files.has(at(c)),
      ) || ["app", "src/app", "pages", "src/pages"].some((d) => dirs.has(at(d)));
    if (isApp) out.push(dir);
  }

  const depth = (d: string) => (d ? d.split("/").length : 0);
  return out.sort((a, b) => depth(a) - depth(b) || a.localeCompare(b));
}

/**
 * Pick the app among the candidates: the first whose manifest installs
 * `@polishd/next` — that's the app this dashboard belongs to — otherwise the
 * best guess. A repo with no candidate at all is scanned from its root.
 */
export function pickAppRoot(
  candidates: string[],
  manifestOf: (dir: string) => string | undefined,
): string {
  for (const dir of candidates) {
    const raw = manifestOf(dir);
    if (!raw) continue;
    try {
      const pkg = JSON.parse(raw) as Record<string, unknown>;
      const installs = ["dependencies", "devDependencies", "peerDependencies"].some((k) => {
        const deps = pkg[k];
        return typeof deps === "object" && deps !== null && "@polishd/next" in deps;
      });
      if (installs) return dir;
    } catch {
      /* unparseable manifest — not evidence either way */
    }
  }
  return candidates[0] ?? "";
}

/**
 * The scan's candidates in a repo, given its file listing and the app root:
 * root docs and code files under the chosen source folders, with paths
 * relative to the app root — the same shape the disk walk produces, so both
 * feed the same `planReads`. Mirrors the walk's rules: dot-folders and
 * ignored folders are never entered, and nothing deeper than `MAX_DEPTH`
 * folders below a source root is read.
 */
export function repoCandidates(
  entries: Candidate[],
  appRoot: string,
  sourceDirs?: string,
): { docs: Candidate[]; code: Candidate[] } {
  const prefix = appRoot ? `${appRoot}/` : "";
  const inApp = entries
    .filter((e) => e.path.startsWith(prefix))
    .map((e) => ({ path: e.path.slice(prefix.length), size: e.size }));

  const dirs = new Set<string>();
  for (const f of inApp) {
    const parts = f.path.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }
  const roots = chooseRoots(sourceDirs, (d) => dirs.has(d));

  const code = inApp.filter((f) =>
    roots.some((root) => {
      if (!f.path.startsWith(`${root}/`)) return false;
      const parts = f.path.slice(root.length + 1).split("/");
      const name = parts.pop()!;
      return parts.length <= MAX_DEPTH && parts.every(isWalkableDir) && isCodeFile(name);
    }),
  );
  const docs = ROOT_DOCS.flatMap((doc) => inApp.filter((f) => f.path === doc));
  return { docs, code };
}
