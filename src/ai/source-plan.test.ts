/**
 * Tests for the codebase-scan planner.
 *
 * Run with `npm test`. The subject is pure — file listings in, decisions out —
 * so these are plain assertions over plain arrays.
 *
 * The app-root pick is the one worth guarding hardest: in a monorepo, a wrong
 * pick doesn't error, it profiles the wrong code — a library's source written
 * up as if it were the site — and every later summary inherits that.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  appRootCandidates,
  buildScan,
  chooseRoots,
  pickAppRoot,
  planReads,
  repoCandidates,
  type Candidate,
} from "./source-plan.ts";

const files = (...paths: string[]): Candidate[] => paths.map((path) => ({ path, size: 100 }));

// ── App root ─────────────────────────────────────────────────────────────────

test("a library repo with its demo app in a subfolder scans the app, not the library", () => {
  // The shape of polishd's own repo: the root is a package, site/ is the app.
  const paths = [
    "package.json",
    "src/ai/scan.ts",
    "src/dashboard/index.tsx",
    "site/package.json",
    "site/next.config.ts",
    "site/app/page.tsx",
  ];
  assert.deepEqual(appRootCandidates(paths), ["site"]);
});

test("a root app is the first guess, ahead of nested ones", () => {
  const paths = [
    "package.json",
    "app/page.tsx",
    "examples/blog/package.json",
    "examples/blog/pages/index.tsx",
  ];
  assert.deepEqual(appRootCandidates(paths), ["", "examples/blog"]);
});

test("a src/app layout counts as an app without a next.config", () => {
  assert.deepEqual(appRootCandidates(["package.json", "src/app/layout.tsx"]), [""]);
});

test("vendored and dot folders are never apps", () => {
  const paths = [
    "node_modules/next/package.json",
    "node_modules/next/app/x.js",
    ".github/tool/package.json",
    ".github/tool/next.config.js",
  ];
  assert.deepEqual(appRootCandidates(paths), []);
});

test("of several apps, the one that installs Polishd is picked", () => {
  const manifests: Record<string, string> = {
    "": JSON.stringify({ dependencies: { next: "16" } }),
    "apps/web": JSON.stringify({ dependencies: { next: "16", "@polishd/next": "0.2" } }),
  };
  assert.equal(pickAppRoot(["", "apps/docs", "apps/web"], (d) => manifests[d]), "apps/web");
});

test("with no app installing Polishd, the best guess stands", () => {
  assert.equal(pickAppRoot(["apps/a", "apps/b"], () => "{}"), "apps/a");
  assert.equal(pickAppRoot(["apps/a"], () => "not json"), "apps/a");
  assert.equal(pickAppRoot([], () => undefined), "");
});

// ── Roots and candidates ─────────────────────────────────────────────────────

test("a src layout walks only src; configured folders are taken as given", () => {
  const dirs = new Set(["src", "app", "lib"]);
  assert.deepEqual(chooseRoots(undefined, (d) => dirs.has(d)), ["src"]);
  assert.deepEqual(chooseRoots(" /app/ , lib", (d) => dirs.has(d)), ["app", "lib"]);
  assert.deepEqual(chooseRoots("missing", (d) => dirs.has(d)), []);
});

test("repo candidates are relative to the app and follow the walk's rules", () => {
  const entries = files(
    "README.md",
    "site/package.json",
    "site/README.md",
    "site/app/page.tsx",
    "site/app/.hidden/x.tsx",
    "site/app/node_modules/x.js",
    "site/app/thing.test.ts",
    "site/app/types.d.ts",
    "site/app/styles.css",
    "site/components/hero.tsx",
    "site/app/a/b/c/d/e/f/g/ok.tsx",
    "site/app/a/b/c/d/e/f/g/h/too-deep.tsx",
  );
  const { docs, code } = repoCandidates(entries, "site");
  assert.deepEqual(
    docs.map((d) => d.path),
    ["package.json", "README.md"],
  );
  assert.deepEqual(code.map((c) => c.path).sort(), [
    "app/a/b/c/d/e/f/g/ok.tsx",
    "app/page.tsx",
    "components/hero.tsx",
  ]);
});

test("an app at the repo root keeps the repo's paths", () => {
  const { code } = repoCandidates(files("src/app/page.tsx", "app/ignored.tsx"), "");
  // src/ exists, so the defaults walk it alone.
  assert.deepEqual(code.map((c) => c.path), ["src/app/page.tsx"]);
});

// ── Budget plan ──────────────────────────────────────────────────────────────

test("docs go first, then pages, then components, then the rest", () => {
  const { reads, dropped } = planReads(
    files("package.json"),
    files("lib/util.ts", "components/card.tsx", "app/about/page.tsx", "app/hooks.ts"),
    [],
  );
  assert.deepEqual(
    reads.map((r) => r.path),
    ["package.json", "app/about/page.tsx", "components/card.tsx", "app/hooks.ts", "lib/util.ts"],
  );
  assert.equal(dropped, false);
});

test("files named like an analytics component jump the queue", () => {
  const { reads } = planReads([], files("components/a.tsx", "lib/signup-form.tsx"), ["signup-form"]);
  assert.deepEqual(
    reads.map((r) => r.path),
    ["lib/signup-form.tsx", "components/a.tsx"],
  );
});

test("a file that doesn't fit is skipped, and a smaller one after it still goes in", () => {
  // 14 clipped files ≈ 84k of the 90k budget; a 7k file won't fit, a 1k one will.
  const big = Array.from({ length: 14 }, (_, i) => ({ path: `app/p${i}/page.tsx`, size: 50_000 }));
  const { reads, dropped } = planReads(
    [],
    [...big, { path: "components/a.tsx", size: 7_000 }, { path: "components/b.tsx", size: 1_000 }],
    [],
  );
  assert.equal(dropped, true);
  assert.ok(reads.some((r) => r.path === "components/b.tsx"));
  assert.ok(!reads.some((r) => r.path === "components/a.tsx"));
});

test("the file cap stops the plan and says so", () => {
  const many = Array.from({ length: 80 }, (_, i) => ({ path: `lib/f${i}.ts`, size: 10 }));
  const { reads, dropped } = planReads(files("package.json"), many, []);
  assert.equal(reads.length, 60);
  assert.equal(dropped, true);
});

test("a file listed twice by overlapping roots is planned once", () => {
  const { reads } = planReads([], files("app/components/x.tsx", "app/components/x.tsx"), []);
  assert.equal(reads.length, 1);
});

// ── Assembly ─────────────────────────────────────────────────────────────────

test("identifiers come from code, never from docs", () => {
  const scan = buildScan(
    [
      { path: "README.md", content: 'Tag it: data-component="example"', doc: true },
      {
        path: "app/page.tsx",
        content: '<PolishdMonitor name="hero"><a data-component="cta" /></PolishdMonitor>',
        doc: false,
      },
    ],
    false,
    "fp",
  );
  assert.deepEqual(scan.identifiers, ["cta", "hero"]);
  assert.equal(scan.truncated, false);
});

test("a clipped file marks the scan truncated", () => {
  const scan = buildScan([{ path: "a.ts", content: "x".repeat(7_000), doc: false }], false, "fp");
  assert.equal(scan.truncated, true);
  assert.ok(scan.files[0].content.length < 7_000);
});
