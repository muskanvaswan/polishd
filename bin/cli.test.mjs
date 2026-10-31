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

/** A minimal App Router project pinned to a Next major, plus any extra files. */
function project(nextMajor, files = {}) {
  const dir = mkdtempSync(join(tmpdir(), "polishd-cli-"));
  const all = {
    "node_modules/next/package.json": JSON.stringify({ version: `${nextMajor}.0.0` }),
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
  const dir = project(15, {
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
  assert.match(out, /proxy\.js present/);
  assert.equal(code, 0);
});

test("init --force leaves files that already match the template alone", async () => {
  const dir = project(16);
  await capture(() => runInit([], dir));
  const proxy = join(dir, "proxy.ts");
  writeFileSync(proxy, `${readFileSync(proxy, "utf8")}// edited\n`);

  const { out } = await capture(() => runInit(["--force"], dir));
  assert.match(out, /Regenerated proxy\.ts/);
  assert.ok(existsSync(`${proxy}.bak`));
  assert.match(out, /instrumentation-client\.ts already matches the current template/);
  assert.equal(existsSync(join(dir, "instrumentation-client.ts.bak")), false);
});
