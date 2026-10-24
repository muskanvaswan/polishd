/**
 * Polishd — host-app source scanner (server only).
 *
 * Reads the consuming app's own source so the one-time project profile can be
 * generated from real code — from disk (`process.cwd()`) where the source is
 * there, otherwise from the connected GitHub repo. This is the ONLY place the
 * AI layer reads source for the profile, and it runs only when the owner
 * clicks "Scan" (or when a summary hits a component the profile doesn't
 * cover, which triggers a tiny targeted read of the disk).
 *
 * Token thrift rules (the budgets themselves live in source-plan.ts, shared by
 * both sources):
 *   - Hard budgets: per-file char cap and a total scan budget, so a big app
 *     can't produce a big prompt. Files are ranked (pages/layouts first, then
 *     files matching known component names, then components dirs) and the
 *     budget is spent in that order.
 *   - Only app code: node_modules/.next/tests/etc. are never read.
 *   - The plan is made from file sizes before anything is read, so a GitHub
 *     scan downloads only the files that make it into the prompt.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { readGithubBlobs, readGithubTree } from "./github";
import {
  EMPTY_SCAN,
  MAX_DEPTH,
  ROOT_DOCS,
  appRootCandidates,
  buildScan,
  chooseRoots,
  clipFile,
  fingerprintOf,
  isCodeFile,
  isWalkableDir,
  pickAppRoot,
  planReads,
  repoCandidates,
  type Candidate,
  type ScannedFile,
  type SourceScan,
} from "./source-plan";

export type { ScannedFile, SourceScan } from "./source-plan";

/** Resolve the directories to walk, relative to the project root. */
function resolveRoots(projectRoot: string, sourceDirs?: string): string[] {
  return chooseRoots(sourceDirs, (d) => {
    const full = join(projectRoot, d);
    try {
      return existsSync(full) && statSync(full).isDirectory();
    } catch {
      return false;
    }
  });
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
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (isWalkableDir(entry.name)) walk(full, depth + 1);
      } else if (isCodeFile(entry.name)) {
        found.push(full);
      }
    }
  };
  for (const root of roots) walk(join(projectRoot, root), 0);
  return found;
}

/** Whether there's a source tree on disk here for a scan to read. */
export function sourceOnDisk(sourceDirs?: string): boolean {
  return resolveRoots(process.cwd(), sourceDirs).length > 0;
}

function sizeOf(abs: string): number {
  try {
    return statSync(abs).size;
  } catch {
    return 0; // raced deletion
  }
}

/**
 * Collect the host app's source from disk for the project profile.
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
  const code: Candidate[] = listFiles(projectRoot, resolveRoots(projectRoot, sourceDirs)).map(
    (abs) => ({ path: relative(projectRoot, abs), size: sizeOf(abs) }),
  );
  if (!code.length) return EMPTY_SCAN;
  const docs: Candidate[] = ROOT_DOCS.filter((d) => existsSync(join(projectRoot, d))).map(
    (d) => ({ path: d, size: sizeOf(join(projectRoot, d)) }),
  );

  const { reads, dropped } = planReads(docs, code, componentNames);
  const docPaths = new Set(docs.map((d) => d.path));
  const read = reads.flatMap((f) => {
    try {
      const content = readFileSync(join(projectRoot, f.path), "utf8");
      return [{ path: f.path, content, doc: docPaths.has(f.path) }];
    } catch {
      return []; // unreadable — skip
    }
  });
  return buildScan(read, dropped, fingerprintOf(code));
}

/** Where a GitHub scan read from: the repo, branch, and the app's folder in it. */
export interface GithubScanOrigin {
  repo: string;
  ref: string;
  /** The app's folder within the repo; "" for the repo root. */
  root: string;
}

export type GithubSourceResult =
  | { ok: true; scan: SourceScan; origin: GithubScanOrigin }
  | { ok: false; error: "not-connected" | "github-error"; message: string };

/** How many candidate app folders' manifests are read to find the right one. */
const MAX_MANIFEST_READS = 8;

/**
 * Collect the app's source from the connected GitHub repo's default branch —
 * the scan for hosts where the source isn't on disk. Same roots, ranking and
 * budgets as the disk scan; paths come back relative to the repo root, since
 * that's where they live. In a monorepo the app's folder is found from the
 * listing (and, when several apps qualify, from which one installs Polishd);
 * `sourceDirs` is relative to that folder, as it is to the project root on
 * disk.
 */
export async function collectGithubSource(
  sourceDirs?: string,
  componentNames: string[] = [],
): Promise<GithubSourceResult> {
  let tree;
  try {
    tree = await readGithubTree();
  } catch (err) {
    return {
      ok: false,
      error: "github-error",
      message: err instanceof Error ? err.message : "Could not reach GitHub.",
    };
  }
  if (!tree) {
    return { ok: false, error: "not-connected", message: "GitHub isn't connected." };
  }

  const shaOf = new Map(tree.files.map((f) => [f.path, f.sha]));
  const candidates = appRootCandidates(tree.files.map((f) => f.path));
  let root = candidates[0] ?? "";
  if (candidates.length > 1) {
    const manifestPath = (dir: string) => (dir ? `${dir}/package.json` : "package.json");
    const checked = candidates.slice(0, MAX_MANIFEST_READS);
    const blobs = await readGithubBlobs(checked.map((dir) => shaOf.get(manifestPath(dir))!));
    root = pickAppRoot(checked, (dir) => blobs.get(shaOf.get(manifestPath(dir))!));
  }
  const origin = { repo: tree.repo, ref: tree.ref, root };

  const { docs, code } = repoCandidates(tree.files, root, sourceDirs);
  if (!code.length) return { ok: true, scan: EMPTY_SCAN, origin };

  const { reads, dropped } = planReads(docs, code, componentNames);
  const prefix = root ? `${root}/` : "";
  const blobs = await readGithubBlobs(reads.map((f) => shaOf.get(prefix + f.path)!));
  const docPaths = new Set(docs.map((d) => d.path));
  const read = reads.flatMap((f) => {
    const content = blobs.get(shaOf.get(prefix + f.path)!);
    return content === undefined
      ? []
      : [{ path: prefix + f.path, content, doc: docPaths.has(f.path) }];
  });
  if (!read.some((f) => !f.doc)) {
    return {
      ok: false,
      error: "github-error",
      message: `Couldn't read any source files from ${tree.repo} — check the token has Contents (read) on it.`,
    };
  }
  return {
    ok: true,
    scan: buildScan(read, dropped || tree.truncated, fingerprintOf(code)),
    origin,
  };
}

/**
 * Locate the first source file containing any of the given needles (most
 * specific — longest — first). Used to verify that a loss the model reported
 * points at something that really exists in the codebase. Returns the path
 * relative to the project root, or null (including when source isn't on disk).
 */
export function findInSource(needles: string[], sourceDirs?: string): string | null {
  const usable = needles.filter((n) => n.length >= 4);
  if (!usable.length) return null;
  const projectRoot = process.cwd();
  const roots = resolveRoots(projectRoot, sourceDirs);
  const ordered = [...usable].sort((a, b) => b.length - a.length);
  for (const needle of ordered) {
    const lower = needle.toLowerCase();
    for (const abs of listFiles(projectRoot, roots)) {
      let raw: string;
      try {
        raw = readFileSync(abs, "utf8");
      } catch {
        continue;
      }
      if (raw.toLowerCase().includes(lower)) return relative(projectRoot, abs);
    }
  }
  return null;
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
