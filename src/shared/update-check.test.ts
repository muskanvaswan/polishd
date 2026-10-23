/**
 * Tests for the update check's decisions.
 *
 * Run with `npm test`. Everything here is pure except `fetchDistTags`, which
 * isn't exercised — these pin down *what gets recommended*, which is the part
 * that would nag an up-to-date install or stay silent on a stale one if wrong.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  compareVersions,
  installCommand,
  packageManagerFromUserAgent,
  pickUpdate,
  rangeAdmits,
  updateCheckDisabled,
} from "./update-check.ts";

// ── Ordering ─────────────────────────────────────────────────────────────────

test("versions order by semver precedence", () => {
  const ascending = [
    "0.1.0",
    "0.2.0",
    "0.2.1-dev.0",
    "0.2.1-dev.2",
    "0.2.1-dev.10", // numerically, not lexically
    "0.2.1",
    "0.2.2",
    "0.10.0",
    "1.0.0-alpha",
    "1.0.0-alpha.1",
    "1.0.0-beta",
    "1.0.0",
  ];
  for (let i = 1; i < ascending.length; i++) {
    const [lo, hi] = [ascending[i - 1], ascending[i]];
    assert.ok(compareVersions(lo, hi)! < 0, `${lo} < ${hi}`);
    assert.ok(compareVersions(hi, lo)! > 0, `${hi} > ${lo}`);
  }
  assert.equal(compareVersions("0.2.2", "0.2.2"), 0);
  assert.equal(compareVersions("0.2.2+build.5", "0.2.2"), 0, "build metadata is ignored");
});

test("anything that isn't a version compares as null, not as equal", () => {
  assert.equal(compareVersions("latest", "0.2.2"), null);
  assert.equal(compareVersions("0.2", "0.2.2"), null);
});

// ── What gets recommended ────────────────────────────────────────────────────

const TAGS = { latest: "0.2.2", dev: "0.2.3-dev.7" };

test("an install on the latest release is current", () => {
  assert.equal(pickUpdate("0.2.2", TAGS), null);
});

test("an older release is offered latest", () => {
  assert.deepEqual(pickUpdate("0.2.0", TAGS), { current: "0.2.0", version: "0.2.2", tag: "latest" });
});

test("a stable install is never offered a dev build", () => {
  assert.equal(pickUpdate("0.2.2", { latest: "0.2.2", dev: "0.3.0-dev.1" }), null);
});

test("a dev install is offered a newer dev build on the dev tag", () => {
  assert.deepEqual(pickUpdate("0.2.3-dev.6", TAGS), {
    current: "0.2.3-dev.6",
    version: "0.2.3-dev.7",
    tag: "dev",
  });
});

test("a dev install ahead of latest, and current on dev, is current", () => {
  assert.equal(pickUpdate("0.2.3-dev.7", TAGS), null);
});

test("a release that overtakes a dev build is offered on latest", () => {
  assert.deepEqual(pickUpdate("0.2.3-dev.7", { latest: "0.2.3", dev: "0.2.3-dev.7" }), {
    current: "0.2.3-dev.7",
    version: "0.2.3",
    tag: "latest",
  });
});

test("a stale dev tag, left behind by a release, loses to latest", () => {
  assert.deepEqual(pickUpdate("0.2.2-dev.1", { latest: "0.2.2", dev: "0.2.2-dev.4" }), {
    current: "0.2.2-dev.1",
    version: "0.2.2",
    tag: "latest",
  });
});

test("missing or malformed tags and versions recommend nothing", () => {
  assert.equal(pickUpdate("0.2.0", {}), null);
  assert.equal(pickUpdate("0.2.0", { latest: "not-a-version" }), null);
  assert.equal(pickUpdate("workspace:*", TAGS), null);
});

// ── Why `npm update` did or didn't help ──────────────────────────────────────

test("below 1.0 a caret range takes patch releases only", () => {
  assert.equal(rangeAdmits("^0.2.2", "0.2.9"), true);
  assert.equal(rangeAdmits("^0.2.2", "0.3.0"), false);
  assert.equal(rangeAdmits("^0.0.3", "0.0.4"), false);
});

test("from 1.0 a caret range takes minors too, and tilde takes patches", () => {
  assert.equal(rangeAdmits("^1.2.0", "1.9.0"), true);
  assert.equal(rangeAdmits("^1.2.0", "2.0.0"), false);
  assert.equal(rangeAdmits("~1.2.0", "1.2.5"), true);
  assert.equal(rangeAdmits("~1.2.0", "1.3.0"), false);
});

test("an exact pin admits only itself", () => {
  assert.equal(rangeAdmits("0.2.3-dev.3", "0.2.3-dev.3"), true);
  assert.equal(rangeAdmits("0.2.3-dev.3", "0.2.3-dev.7"), false);
  assert.equal(rangeAdmits("=0.2.2", "0.2.2"), true);
});

test("prereleases only satisfy a range anchored on the same version's prerelease", () => {
  assert.equal(rangeAdmits("^0.2.2", "0.2.3-dev.1"), false);
  assert.equal(rangeAdmits("^0.2.3-dev.3", "0.2.3-dev.7"), true);
  assert.equal(rangeAdmits("latest", "0.2.3-dev.7"), false);
  assert.equal(rangeAdmits("latest", "0.3.0"), true);
});

test("range syntax this doesn't model is unknown, not a guess", () => {
  assert.equal(rangeAdmits(">=0.2.0 <0.4.0", "0.3.0"), null);
  assert.equal(rangeAdmits("^0.2 || ^0.3", "0.3.0"), null);
  assert.equal(rangeAdmits("github:muskanvaswan/polishd", "0.3.0"), null);
});

// ── Commands and switches ────────────────────────────────────────────────────

test("the install command is spelled the way each manager spells it", () => {
  assert.equal(installCommand("npm", "latest"), "npm install @polishd/next@latest");
  assert.equal(installCommand("pnpm", "dev"), "pnpm add @polishd/next@dev");
  assert.equal(installCommand("yarn", "latest"), "yarn add @polishd/next@latest");
  assert.equal(installCommand("bun", "latest"), "bun add @polishd/next@latest");
});

test("the package manager is read from its user agent", () => {
  assert.equal(packageManagerFromUserAgent("pnpm/9.12.0 npm/? node/v22.11.0 darwin arm64"), "pnpm");
  assert.equal(packageManagerFromUserAgent("npm/10.9.0 node/v22.11.0 darwin arm64 workspaces/false"), "npm");
  assert.equal(packageManagerFromUserAgent(undefined), null);
  assert.equal(packageManagerFromUserAgent("deno/2.0.0"), null);
});

test("the check can be switched off", () => {
  assert.equal(updateCheckDisabled({}), false);
  assert.equal(updateCheckDisabled({ POLISHD_UPDATE_CHECK: "off" }), true);
  assert.equal(updateCheckDisabled({ POLISHD_UPDATE_CHECK: "FALSE" }), true);
  assert.equal(updateCheckDisabled({ POLISHD_UPDATE_CHECK: "on" }), false);
  assert.equal(updateCheckDisabled({ NO_UPDATE_NOTIFIER: "" }), true, "presence alone, per convention");
});

// ── The CLI's contract with this file ────────────────────────────────────────

test("the module stays import-free, so the CLI can load its compiled copy", () => {
  // `doctor` imports dist/shared/update-check.js with plain Node. tsc emits
  // extensionless relative imports, which Node can't resolve — one import here
  // would quietly switch the doctor's update check off.
  const source = readFileSync(new URL("./update-check.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /^\s*import\s/m);
  assert.doesNotMatch(source, /^\s*export\s+(\*|\{[^}]*\})\s+from\s/m);
});
