/**
 * Tests for the `polishd` CLI, run against throwaway project trees.
 *
 * `init` and `doctor` print rather than return their findings, so each run
 * captures console output and asserts on the lines a user would read.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { runDb } from "./db.mjs";
import { runDoctor } from "./doctor.mjs";
import { runInit } from "./init.mjs";
import { detectJsInstall, findConfigMatcher, matcherTouchesApi } from "./shared.mjs";

const POLISHD_MATCHER = `["/((?!api|_next/static|_next/image|favicon|assets).*)"]`;

/**
 * A minimal App Router project with Next installed, plus any extra files.
 * `next` is a major (`16` installs 16.0.0) or an exact version ("15.2.4").
 */
function project(next, files = {}) {
  const dir = mkdtempSync(join(tmpdir(), "polishd-cli-"));
  const version = typeof next === "string" ? next : `${next}.0.0`;
  const all = {
    "node_modules/next/package.json": JSON.stringify({ version }),
    "app/layout.tsx": "export default function L({ children }) { return children; }",
    ...files,
  };
  for (const [rel, body] of Object.entries(all)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  return dir;
}

/** Run a CLI command with console output captured and ANSI colour stripped. */
async function capture(fn) {
  const lines = [];
  const { log, error } = console;
  console.log = console.error = (...args) => lines.push(args.join(" ").replace(/\x1b\[[0-9;]*m/g, ""));
  try {
    const code = await fn();
    return { code, out: lines.join("\n") };
  } finally {
    console.log = log;
    console.error = error;
  }
}

test("config.matcher is read from config, not from composePolishd's scope", () => {
  const src = `
    export const middleware = composePolishd(adminGate, { matcher: "/admin/:path*" });
    export const config = { matcher: ${POLISHD_MATCHER} };
  `;
  assert.deepEqual(findConfigMatcher(src), { literal: true, text: POLISHD_MATCHER });
  assert.deepEqual(
    findConfigMatcher(`const scope = composePolishd(h, { matcher: ADMIN });\nexport const config = { matcher: polishdMatcher };`),
    { literal: false, text: "polishdMatcher" },
  );
  assert.equal(findConfigMatcher(`export function proxy() {}`), null);
});

test("only matchers that can reach /api are flagged", () => {
  for (const safe of [POLISHD_MATCHER, `["/admin/:path*"]`, `"/admin(.*)"`, `["/"]`, `["/apiary"]`]) {
    assert.equal(matcherTouchesApi(safe), false, safe);
  }
  for (const risky of [`["/:path*"]`, `["/(.*)"]`, `["/a(.*)"]`, `["/api/:path*"]`, `["/admin/:path*", "/((?!_next).*)"]`]) {
    assert.equal(matcherTouchesApi(risky), true, risky);
  }
});

test("a JS install is recognised only when no TypeScript glue exists", () => {
  assert.equal(detectJsInstall(project(16, { "proxy.js": "" }), "", "app"), true);
  assert.equal(detectJsInstall(project(16, { "proxy.ts": "", "instrumentation-client.js": "" }), "", "app"), false);
  assert.equal(detectJsInstall(project(16), "", "app"), false);
});

test("doctor passes a proxy merged with composePolishd without a false /api warning", async () => {
  const dir = project("15.5.0", {
    "middleware.ts": `
      import { composePolishd } from "@polishd/next/proxy";
      function adminGate(request) { return undefined; }
      export const middleware = composePolishd(adminGate, { matcher: "/admin/:path*" });
      export const config = { matcher: ${POLISHD_MATCHER} };
    `,
  });
  await capture(() => runInit([], dir));
  const { out } = await capture(() => runDoctor([], dir));
  assert.match(out, /config\.matcher is an inline literal/);
  assert.doesNotMatch(out, /does not exclude \/api/);
  assert.match(out, /no problems/);
});

test("doctor checks a --js install without being told", async () => {
  const dir = project(16);
  await capture(() => runInit(["--js"], dir));
  const { code, out } = await capture(() => runDoctor([], dir));
  assert.doesNotMatch(out, /Missing/);
  assert.match(out, /instrumentation-client\.js present/);
  assert.equal(code, 0);
});

test("init --force leaves files that already match the template alone", async () => {
  const dir = project(16);
  await capture(() => runInit([], dir));
  const route = join(dir, "app/api/polishd/route.ts");
  writeFileSync(route, `${readFileSync(route, "utf8")}// edited\n`);

  const { out } = await capture(() => runInit(["--force"], dir));
  assert.match(out, /Regenerated app\/api\/polishd\/route\.ts/);
  assert.ok(existsSync(`${route}.bak`));
  assert.match(out, /instrumentation-client\.ts already matches the current template/);
  assert.equal(existsSync(join(dir, "instrumentation-client.ts.bak")), false);
});

test("init writes no proxy, and doctor passes an install without one", async () => {
  const dir = project(16);
  const init = await capture(() => runInit([], dir));
  assert.equal(existsSync(join(dir, "proxy.ts")), false);
  assert.equal(existsSync(join(dir, "middleware.ts")), false);
  assert.doesNotMatch(init.out, /proxy/i);

  const { code, out } = await capture(() => runDoctor([], dir));
  assert.match(out, /No proxy/);
  assert.match(out, /no problems/);
  assert.equal(code, 0);
});

test("init leaves a host's own proxy alone without asking for a merge", async () => {
  const own = `export function proxy() { return undefined; }\nexport const config = { matcher: ["/admin/:path*"] };\n`;
  const dir = project(16, { "proxy.ts": own });
  const { out } = await capture(() => runInit([], dir));
  assert.equal(readFileSync(join(dir, "proxy.ts"), "utf8"), own);
  assert.doesNotMatch(out, /composePolishd|merge/i);

  const doctor = await capture(() => runDoctor([], dir));
  assert.match(doctor.out, /proxy\.ts is your own/);
  assert.doesNotMatch(doctor.out, /does not exclude \/api/);
  assert.equal(doctor.code, 0);
});

test("init points out a proxy an earlier init wrote", async () => {
  const dir = project(16, {
    "proxy.ts": `// Generated by \`npx @polishd/next init\`.\nexport function proxy() {}\n`,
  });
  const { out } = await capture(() => runInit([], dir));
  assert.match(out, /proxy\.ts from an earlier init is no longer needed/);
  assert.ok(existsSync(join(dir, "proxy.ts")), "left for the owner to delete");
});

test("a Polishd proxy under the wrong name is a warning now, not a failure", async () => {
  const dir = project(16, {
    "middleware.ts": `
      import { withPolishdSession } from "@polishd/next/proxy";
      export function middleware(request) { return withPolishdSession(request); }
      export const config = { matcher: ${POLISHD_MATCHER} };
    `,
  });
  await capture(() => runInit([], dir));
  const { code, out } = await capture(() => runDoctor([], dir));
  assert.match(out, /middleware\.ts is never loaded on Next 16/);
  assert.equal(code, 0);
});

test("Next below 15.3 fails doctor and warns in init: it never loads instrumentation-client", async () => {
  const dir = project("15.2.4");
  const init = await capture(() => runInit([], dir));
  assert.match(init.out, /Next\.js 15\.2\.4 — Polishd needs >= 15\.3/);

  const { code, out } = await capture(() => runDoctor([], dir));
  assert.match(out, /Next\.js 15\.2\.4 never loads instrumentation-client/);
  assert.equal(code, 1);
});

test("Next 15.3 is enough", async () => {
  const dir = project("15.3.0");
  const init = await capture(() => runInit([], dir));
  assert.doesNotMatch(init.out, /needs >= 15\.3/);
  const { code, out } = await capture(() => runDoctor([], dir));
  assert.doesNotMatch(out, /never loads instrumentation-client/);
  assert.equal(code, 0);
});

test("a declared Next range alone is not judged: it may resolve to a newer Next", async () => {
  const dir = mkdtempSync(join(tmpdir(), "polishd-cli-"));
  mkdirSync(join(dir, "app"), { recursive: true });
  writeFileSync(join(dir, "app/layout.tsx"), "export default function L({ children }) { return children; }");
  writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: { next: "^15.1.0" } }));
  await capture(() => runInit([], dir));
  const { out } = await capture(() => runDoctor([], dir));
  assert.doesNotMatch(out, /never loads instrumentation-client/);
});

test("under cacheComponents init omits runtime/dynamic and doctor holds it to that", async () => {
  const dir = project(16, {
    "next.config.ts": `export default { cacheComponents: true };`,
  });
  const init = await capture(() => runInit([], dir));
  assert.match(init.out, /Detected cacheComponents in next\.config\.ts/);
  const route = readFileSync(join(dir, "app/api/polishd/route.ts"), "utf8");
  const page = readFileSync(join(dir, "app/polishd/page.tsx"), "utf8");
  for (const src of [route, page]) assert.doesNotMatch(src, /export const (runtime|dynamic)/);
  assert.match(page, /createPolishdPage\(\{ defaults, suspense: true \}\)/);
  assert.match(page, /export \{ metadata \} from "@polishd\/next\/dashboard"/);

  const ok = await capture(() => runDoctor([], dir));
  assert.match(ok.out, /route\.ts omits runtime and dynamic/);
  assert.match(ok.out, /Dashboard renders inside <Suspense>/);
  assert.equal(ok.code, 0);

  // The 0.3.1 templates in the same app: the build rejects them, and so does doctor.
  writeFileSync(join(dir, "app/api/polishd/route.ts"), `${route}export const runtime = "nodejs";\nexport const dynamic = "force-dynamic";\n`);
  writeFileSync(join(dir, "app/polishd/page.tsx"), page.replace("createPolishdPage({ defaults, suspense: true })", "createPolishdPage({ defaults })"));
  const bad = await capture(() => runDoctor([], dir));
  assert.match(bad.out, /route\.ts declares `runtime` and `dynamic`/);
  assert.match(bad.out, /renders the dashboard outside <Suspense>/);
  assert.equal(bad.code, 1);
});

test("without cacheComponents the page keeps runtime/dynamic and gains the metadata", async () => {
  const dir = project(16, { "next.config.ts": `export default { reactStrictMode: true };` });
  await capture(() => runInit([], dir));
  const page = readFileSync(join(dir, "app/polishd/page.tsx"), "utf8");
  assert.match(page, /export const runtime = "nodejs"/);
  assert.match(page, /export \{ metadata \} from "@polishd\/next\/dashboard"/);
  assert.match(page, /createPolishdPage\(\{ defaults \}\);/);
  const { out } = await capture(() => runDoctor([], dir));
  assert.doesNotMatch(out, /metadata/);
});

test("doctor points out a page that leaves /polishd indexable", async () => {
  const dir = project(16, { "next.config.ts": `export default {};` });
  await capture(() => runInit([], dir));
  const pagePath = join(dir, "app/polishd/page.tsx");
  // Only the export goes; the comment above it still says "metadata".
  writeFileSync(pagePath, readFileSync(pagePath, "utf8").replace(/export \{ metadata \}.*\n/, ""));
  const { code, out } = await capture(() => runDoctor([], dir));
  assert.match(out, /doesn't export the dashboard's metadata/);
  assert.equal(code, 0);
});

// ── polishd.defaults.json ────────────────────────────────────────────────────

test("init writes polishd.defaults.json with the repo from origin, and the page imports it", async () => {
  const dir = project(16, { "next.config.ts": `export default {};` });
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["remote", "add", "origin", "https://github.com/acme/notes.git"], { cwd: dir });
  const { out } = await capture(() => runInit([], dir));
  assert.match(out, /Created polishd\.defaults\.json \(repository acme\/notes from the origin remote\)/);
  assert.match(out, /personal-access-tokens\/new\?name=Polishd\+acme%2Fnotes.*target_name=acme/);
  const file = JSON.parse(readFileSync(join(dir, "polishd.defaults.json"), "utf8"));
  assert.equal(file.github.repo, "acme/notes");
  assert.deepEqual(file.site, { description: "", audience: "", values: "" });
  const page = readFileSync(join(dir, "app/polishd/page.tsx"), "utf8");
  assert.match(page, /import defaults from "\.\.\/\.\.\/polishd\.defaults\.json";/);

  const doctor = await capture(() => runDoctor([], dir));
  assert.match(doctor.out, /polishd\.defaults\.json is read by the dashboard/);
  assert.equal(doctor.code, 0);
});

test("under src/ the page reaches the file at the root", async () => {
  const dir = project(16, { "src/app/layout.tsx": "export default function L({ children }) { return children; }" });
  await capture(() => runInit([], dir));
  const page = readFileSync(join(dir, "src/app/polishd/page.tsx"), "utf8");
  assert.match(page, /import defaults from "\.\.\/\.\.\/\.\.\/polishd\.defaults\.json";/);
  assert.ok(existsSync(join(dir, "polishd.defaults.json")));
});

test("the defaults file is the owner's: init never overwrites it, even with --force", async () => {
  const mine = `{ "site": { "description": "Mine" } }\n`;
  const dir = project(16, { "polishd.defaults.json": mine });
  await capture(() => runInit([], dir));
  const { out } = await capture(() => runInit(["--force"], dir));
  assert.match(out, /polishd\.defaults\.json exists — kept as it is/);
  assert.equal(readFileSync(join(dir, "polishd.defaults.json"), "utf8"), mine);
});

test("a page from an earlier init doesn't read the file, and init and doctor both say so", async () => {
  const dir = project(16);
  await capture(() => runInit([], dir));
  const pagePath = join(dir, "app/polishd/page.tsx");
  // The 0.3.2-dev page: no import, no defaults.
  writeFileSync(
    pagePath,
    readFileSync(pagePath, "utf8")
      .replace(/import defaults from .*\n/, "")
      .replace("createPolishdPage({ defaults })", "createPolishdPage()"),
  );
  const init = await capture(() => runInit([], dir));
  assert.match(init.out, /doesn't import polishd\.defaults\.json.*\n.*--force/);
  const doctor = await capture(() => runDoctor([], dir));
  assert.match(doctor.out, /page\.tsx doesn't import polishd\.defaults\.json/);
  assert.equal(doctor.code, 0, "a warning: the dashboard still works, just without it");
});

test("doctor fails a secret in the defaults file and names keys it doesn't read", async () => {
  const dir = project(16);
  await capture(() => runInit([], dir));
  writeFileSync(
    join(dir, "polishd.defaults.json"),
    JSON.stringify({ ai: { apiKey: "sk-ant-x" }, github: { token: "github_pat_x" }, site: { descripton: "typo" } }),
  );
  const { code, out } = await capture(() => runDoctor([], dir));
  assert.match(out, /holds a secret \(ai\.apiKey, github\.token\)/);
  assert.match(out, /keys Polishd doesn't read[\s\S]*site\.descripton/);
  assert.equal(code, 1);
});

test("doctor fails invalid JSON, and a page importing a file that isn't there", async () => {
  const dir = project(16);
  await capture(() => runInit([], dir));
  writeFileSync(join(dir, "polishd.defaults.json"), `{ "site": `);
  assert.match((await capture(() => runDoctor([], dir))).out, /polishd\.defaults\.json isn't valid JSON/);
  execFileSync("rm", [join(dir, "polishd.defaults.json")]);
  const missing = await capture(() => runDoctor([], dir));
  assert.match(missing.out, /imports polishd\.defaults\.json, which doesn't exist/);
  assert.equal(missing.code, 1);
});

// ── --fix-workflow ───────────────────────────────────────────────────────────

test("--fix-workflow writes the recommended workflow; without it there is none", async () => {
  const plain = project(16);
  await capture(() => runInit([], plain));
  assert.ok(!existsSync(join(plain, ".github/workflows/claude.yml")));

  const dir = project(16);
  const { out } = await capture(() => runInit(["--fix-workflow"], dir));
  const yml = readFileSync(join(dir, ".github/workflows/claude.yml"), "utf8");
  assert.match(yml, /^# Generated by `npx @polishd\/next init --fix-workflow`/);
  assert.match(yml, /claude_code_oauth_token: \$\{\{ secrets\.CLAUDE_CODE_OAUTH_TOKEN \}\}/);
  assert.match(out, /claude setup-token[\s\S]*gh secret set CLAUDE_CODE_OAUTH_TOKEN/);
  assert.match(out, /github\.com\/apps\/claude\/installations\/new/);

  const api = project(16);
  await capture(() => runInit(["--fix-workflow=api-key"], api));
  assert.match(
    readFileSync(join(api, ".github/workflows/claude.yml"), "utf8"),
    /anthropic_api_key: \$\{\{ secrets\.ANTHROPIC_API_KEY \}\}/,
  );
});

test("--fix-workflow leaves a workflow of the owner's alone, and rejects an unknown secret", async () => {
  const dir = project(16, { ".github/workflows/claude.yml": "name: mine\n" });
  const { out } = await capture(() => runInit(["--fix-workflow"], dir));
  assert.match(out, /claude\.yml exists and was not written by Polishd/);
  assert.equal(readFileSync(join(dir, ".github/workflows/claude.yml"), "utf8"), "name: mine\n");
  const bad = await capture(() => runInit(["--fix-workflow=nope"], project(16)));
  assert.equal(bad.code, 1);
});

// ── db check ─────────────────────────────────────────────────────────────────
// The Postgres cases need databases, named in POLISHD_TEST_PG_APP_EVENTS (the
// app's own `events` table), POLISHD_TEST_PG_SHARED (the app's tables only),
// POLISHD_TEST_PG_LEGACY (Polishd's pre-0.3.2 `events`) and POLISHD_TEST_PG_TAKEN
// (a `polishd_events` that isn't Polishd's), and are skipped without them.

/** An env file holding `url` as DATABASE_URL, with a password to look for. */
function envFile(url) {
  const dir = mkdtempSync(join(tmpdir(), "polishd-db-"));
  const withPassword = url.replace("://postgres:postgres@", "://postgres:s3cret-pw@");
  writeFileSync(join(dir, ".env.check"), `DATABASE_URL="${withPassword}"\n`);
  return join(dir, ".env.check");
}

test("db check says which variable is missing, and how to fetch it", async () => {
  const { code, out } = await capture(() => runDb(["check", "--var", "POLISHD_NOPE_URL"], project(16)));
  assert.equal(code, 1);
  assert.match(out, /POLISHD_NOPE_URL isn't set/);
  assert.match(out, /vercel env pull .polishd\/env\.check --environment production/);
});

test("db check reports an unreachable database by host, never the URL", async () => {
  const file = envFile("postgres://postgres:postgres@127.0.0.1:1/app?sslmode=disable");
  const { code, out } = await capture(() => runDb(["check", "--env-file", file], project(16)));
  assert.equal(code, 1);
  assert.match(out, /Can't connect to 127\.0\.0\.1:1/);
  assert.doesNotMatch(out, /s3cret-pw/);
});

test("db check names a database that isn't Postgres, without connecting", async () => {
  const dir = mkdtempSync(join(tmpdir(), "polishd-db-"));
  writeFileSync(join(dir, ".env.check"), `DATABASE_URL="mysql://app:s3cret-pw@db.example.com:3306/app"\n`);
  const { code, out } = await capture(() => runDb(["check", "--env-file", join(dir, ".env.check")], project(16)));
  assert.equal(code, 1);
  assert.match(out, /Polishd needs Postgres, and DATABASE_URL is a mysql URL/);
  assert.doesNotMatch(out, /s3cret-pw/);
});

const PG = {
  appEvents: process.env.POLISHD_TEST_PG_APP_EVENTS,
  shared: process.env.POLISHD_TEST_PG_SHARED,
  legacy: process.env.POLISHD_TEST_PG_LEGACY,
  taken: process.env.POLISHD_TEST_PG_TAKEN,
};

test("db check clears a database with the app's own events table: the names don't clash", { skip: !PG.appEvents && "set POLISHD_TEST_PG_APP_EVENTS" }, async () => {
  const { code, out } = await capture(() => runDb(["check", "--env-file", envFile(PG.appEvents)], project(16)));
  assert.equal(code, 0);
  assert.doesNotMatch(out, /can't use/);
  // Before the store tests open it, Polishd has nothing there yet; after, its tables sit beside the app's.
  assert.match(out, /beside the app's 2 \(events, users\)|Polishd's tables are already here/);
  assert.doesNotMatch(out, /s3cret-pw/);
});

test("db check clears a database of the app's own tables, and warns about schema tools", { skip: !PG.shared && "set POLISHD_TEST_PG_SHARED" }, async () => {
  const plain = await capture(() => runDb(["check", "--env-file", envFile(PG.shared)], project(16)));
  assert.equal(plain.code, 0);
  assert.match(plain.out, /No clash with the app's tables[\s\S]*beside the app's 2 \(posts, users\)/);
  assert.doesNotMatch(plain.out, /schema is managed/);

  const prisma = project(16, { "prisma/schema.prisma": "datasource db { provider = \"postgresql\" }" });
  const warned = await capture(() => runDb(["check", "--env-file", envFile(PG.shared)], prisma));
  assert.match(warned.out, /The app's schema is managed by Prisma[\s\S]*can drop them/);
  assert.equal(warned.code, 0, "a warning: Polishd can still use it");
});

test("db check recognises Polishd's tables, under the old name or the new", { skip: !PG.legacy && "set POLISHD_TEST_PG_LEGACY" }, async () => {
  // The store tests may already have renamed it; either way it's Polishd's.
  const { code, out } = await capture(() => runDb(["check", "--env-file", envFile(PG.legacy)], project(16)));
  assert.equal(code, 0);
  assert.match(out, /Polishd's tables are already here/);
  assert.doesNotMatch(out, /No clash/, "its old events table isn't counted as the app's");
});

test("db check refuses a database whose polishd_events isn't Polishd's", { skip: !PG.taken && "set POLISHD_TEST_PG_TAKEN" }, async () => {
  const { code, out } = await capture(() => runDb(["check", "--env-file", envFile(PG.taken)], project(16)));
  assert.equal(code, 1);
  assert.match(out, /Polishd can't use this database: "polishd_events" here isn't Polishd's/);
});
