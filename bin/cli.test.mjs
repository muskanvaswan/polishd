/**
 * Tests for the `polishd` CLI, run against throwaway project trees.
 *
 * `init` and `doctor` print rather than return their findings, so each run
 * captures console output and asserts on the lines a user would read.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

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
