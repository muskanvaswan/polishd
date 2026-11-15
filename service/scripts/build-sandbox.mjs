#!/usr/bin/env node
/**
 * Build the image the sandbox engine starts from (lib/sandbox.ts), and print
 * its snapshot id.
 *
 *   cd service && npm run sandbox:build
 *
 * It starts a Vercel Sandbox, copies in the capture worker and everything it
 * imports, installs its two packages and Playwright's Chromium with the
 * system libraries Chromium needs, shoots one page to prove the image works,
 * and saves the sandbox as a snapshot that never expires. Set the id it
 * prints as `SHOTS_SANDBOX_SNAPSHOT_ID`, with `SHOTS_ENGINE=sandbox`.
 *
 * Run it again whenever the capture code changes (service/lib, src/capture,
 * service/sandbox): the image holds a copy, and a function deployed later
 * doesn't update it.
 *
 * Credentials are the SDK's: `vercel link` and `vercel env pull` in service/
 * (a `VERCEL_OIDC_TOKEN` in .env.local, good for 12 hours), or
 * `VERCEL_TOKEN` + `VERCEL_TEAM_ID` + `VERCEL_PROJECT_ID`. The sandbox and
 * its snapshot belong to that project.
 *
 * Flags:
 *   --image <ref>        the base image (default: Vercel's universal Ubuntu image)
 *   --smoke <origin>     the site the test shot is taken of (default https://example.com)
 *   --no-smoke           skip the test shot
 *   --delete <snap_id>   delete this older snapshot once the new one is saved
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";

const serviceDir = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(serviceDir, "..");
const ENTRY = "service/sandbox/worker.ts";
/** The packages the worker may import. Anything else is a mistake to catch here. */
const PACKAGES = ["playwright-core", "allpages"];
/** Kept in step with lib/sandbox-job.ts, which this script can't import. */
const WORKER_SCRIPT = "app/run.sh";
const WORKER_JOB_DIR = "app/jobs";

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { image: null, smoke: "https://example.com", delete: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--no-smoke") out.smoke = null;
    else if (arg === "--image" || arg === "--smoke" || arg === "--delete") {
      const value = argv[++i];
      if (!value) fail(`${arg} needs a value`);
      out[arg.slice(2)] = value;
    } else fail(`unknown flag ${arg}`);
  }
  if (out.smoke) {
    let origin;
    try {
      origin = new URL(out.smoke);
    } catch {
      fail("--smoke takes an origin, like https://example.com");
    }
    out.smoke = origin.origin;
  }
  return out;
}

/**
 * The worker and every source file it loads, as repo-relative paths. Type-only
 * imports are skipped — Node strips them, so those files are never loaded.
 */
function workerSources() {
  const files = new Set();
  const packages = new Set();
  const statement = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?(?:[^;'"]*?\sfrom\s+)?["']([^"']+)["']/g;
  const visit = (rel) => {
    if (files.has(rel)) return;
    files.add(rel);
    const source = readFileSync(path.join(repoRoot, rel), "utf8");
    for (const [, typeOnly, specifier] of source.matchAll(statement)) {
      if (typeOnly) continue;
      if (specifier.startsWith("node:")) continue;
      if (!specifier.startsWith(".")) {
        packages.add(specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0]);
        continue;
      }
      const base = path.join(path.dirname(rel), specifier);
      const hit = [base, `${base}.ts`, `${base}/index.ts`].find(
        (candidate) => /\.[cm]?[jt]s$/.test(candidate) && existsSync(path.join(repoRoot, candidate)),
      );
      if (!hit) fail(`${rel} imports ${specifier}, which wasn't found`);
      visit(hit);
    }
  };
  visit(ENTRY);
  const unexpected = [...packages].filter((name) => !PACKAGES.includes(name));
  if (unexpected.length > 0) {
    fail(`the worker imports ${unexpected.join(", ")}, which the image doesn't install — add it to PACKAGES`);
  }
  return [...files].sort();
}

/** The versions the service itself has installed, so the image runs the same ones. */
function installedVersions() {
  const require = createRequire(path.join(serviceDir, "package.json"));
  return Object.fromEntries(
    PACKAGES.map((name) => {
      try {
        return [name, require(`${name}/package.json`).version];
      } catch {
        // No `./package.json` export: read it off the disk.
        const file = path.join(serviceDir, "node_modules", name, "package.json");
        return [name, JSON.parse(readFileSync(file, "utf8")).version];
      }
    }),
  );
}

const RUN_SH = `#!/bin/sh
# Written by scripts/build-sandbox.mjs. Runs one capture job:
#   sh ${WORKER_SCRIPT} <job.json> <result.json>
APP="$(cd "$(dirname "$0")" && pwd)"
export SHOTS_WORKER=1
export PLAYWRIGHT_BROWSERS_PATH="$APP/browsers"
exec node --experimental-strip-types --no-warnings --import "$APP/resolve.mjs" "$APP/service/sandbox/worker.ts" "$@"
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const file of [".env.local", ".env"]) {
    const full = path.join(serviceDir, file);
    if (existsSync(full)) process.loadEnvFile(full);
  }
  if (!process.env.VERCEL_OIDC_TOKEN && !process.env.VERCEL_TOKEN) {
    fail(
      "No Vercel credentials. In service/, run `vercel link` then `vercel env pull`,\n" +
        "  or set VERCEL_TOKEN, VERCEL_TEAM_ID and VERCEL_PROJECT_ID.",
    );
  }

  const sources = workerSources();
  const versions = installedVersions();
  console.log(`Worker: ${sources.length} source files, ${PACKAGES.map((p) => `${p} ${versions[p]}`).join(", ")}`);

  const { Sandbox, Snapshot } = await import("@vercel/sandbox");
  console.log("Starting a sandbox…");
  const sandbox = await Sandbox.create({
    ...(args.image ? { image: args.image } : {}),
    resources: { vcpus: 2 },
    timeout: 25 * 60_000,
    persistent: false,
  });
  const app = `${sandbox.cwd}/app`;
  let saved = false;

  /** Run a step, echoing its output; a non-zero exit ends the build. */
  const step = async (label, params) => {
    console.log(`\n▸ ${label}`);
    const done = await sandbox.runCommand({ ...params, stdout: process.stdout, stderr: process.stderr });
    if (done.exitCode !== 0) throw new Error(`${label} failed (exit ${done.exitCode})`);
  };

  try {
    const dirs = new Set([WORKER_JOB_DIR, ...sources.map((rel) => `app/${path.posix.dirname(rel)}`)]);
    await step("Lay out the image", { cmd: "mkdir", args: ["-p", ...dirs] });
    await sandbox.writeFiles([
      ...sources.map((rel) => ({ path: `app/${rel}`, content: readFileSync(path.join(repoRoot, rel)) })),
      {
        path: "app/package.json",
        content: `${JSON.stringify({ name: "polishd-shots-worker", private: true, type: "module", dependencies: versions }, null, 2)}\n`,
      },
      { path: "app/resolve.mjs", content: readFileSync(path.join(repoRoot, "scripts/test-resolve.mjs")) },
      { path: WORKER_SCRIPT, content: RUN_SH, mode: 0o755 },
    ]);

    await step("Install the worker's packages", {
      cmd: "npm",
      args: ["install", "--omit=dev", "--no-audit", "--no-fund"],
      cwd: app,
    });

    // Root for the system libraries, by node's full path: root's PATH may not have it.
    const which = await sandbox.runCommand("sh", ["-c", "command -v node"]);
    const node = (await which.stdout()).trim();
    if (which.exitCode !== 0 || !node) throw new Error("the base image has no node");
    const playwright = `${app}/node_modules/playwright-core/cli.js`;
    await step("Install the system libraries Chromium needs", {
      cmd: node,
      args: [playwright, "install-deps", "chromium"],
      sudo: true,
    });
    await step("Install Chromium", {
      cmd: node,
      args: [playwright, "install", "--only-shell", "chromium"],
      env: { PLAYWRIGHT_BROWSERS_PATH: `${app}/browsers` },
    });

    if (args.smoke) {
      const jobFile = `${WORKER_JOB_DIR}/smoke.job.json`;
      const resultFile = `${WORKER_JOB_DIR}/smoke.result.json`;
      const job = {
        v: 1,
        origin: args.smoke,
        request: { routes: ["/"], devices: ["desktop"], themes: ["light"], find: [] },
        budgetMs: 45_000,
      };
      await sandbox.writeFiles([{ path: jobFile, content: JSON.stringify(job) }]);
      const started = Date.now();
      await step(`Shoot ${args.smoke} as a test`, {
        cmd: "sh",
        args: [WORKER_SCRIPT, jobFile, resultFile],
        timeoutMs: 60_000,
      });
      const raw = await sandbox.readFileToBuffer({ path: resultFile });
      const result = raw ? JSON.parse(raw.toString("utf8")) : null;
      const shot = result?.ok ? result.shots?.[0] : null;
      if (!shot?.image) {
        throw new Error(`the test shot came back without an image: ${result?.message ?? shot?.skipped ?? "no result"}`);
      }
      console.log(
        `  ${shot.image.width}×${shot.image.height} ${shot.image.type}, ` +
          `${Math.round((shot.image.data.length * 3) / 4 / 1024)} KB, ${((Date.now() - started) / 1000).toFixed(1)}s`,
      );
      await sandbox.runCommand("rm", ["-f", resultFile]);
    }

    console.log("\n▸ Save the snapshot (this stops the sandbox)");
    const snapshot = await sandbox.snapshot({ expiration: 0 });
    saved = true;
    console.log(`  ${snapshot.snapshotId}, ${Math.round(snapshot.sizeBytes / 1_048_576)} MB`);
    // The build sandbox would stay listed on the project, stopped. Deleting
    // its record keeps the snapshot.
    await sandbox.delete().catch(() => {});

    if (args.delete && args.delete !== snapshot.snapshotId) {
      const old = await Snapshot.get({ snapshotId: args.delete });
      await old.delete();
      console.log(`  deleted ${args.delete}`);
    }

    console.log(
      `\n✓ Image built. Set these on the service's Vercel project, then redeploy:\n\n` +
        `    SHOTS_ENGINE=sandbox\n` +
        `    SHOTS_SANDBOX_SNAPSHOT_ID=${snapshot.snapshotId}\n`,
    );
  } finally {
    if (!saved) await sandbox.stop().catch(() => {});
  }
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
