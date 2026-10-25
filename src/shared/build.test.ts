import assert from "node:assert/strict";
import { test } from "node:test";

import { sanitizeBuild, shortBuild } from "./build.ts";

test("sanitizeBuild keeps the shapes builds come in", () => {
  const sha = "f804613c2a9e4b7d1e0f6a2b3c4d5e6f7a8b9c0d";
  assert.equal(sanitizeBuild(sha), sha);
  assert.equal(sanitizeBuild("  v1.2.3+45 "), "v1.2.3+45");
  assert.equal(sanitizeBuild("main@f804613"), "main@f804613");
  assert.equal(sanitizeBuild("2026-10-25T10:00"), "2026-10-25T10:00");
  assert.equal(sanitizeBuild("release/2026.10"), "release/2026.10");
});

test("sanitizeBuild drops what isn't a label", () => {
  assert.equal(sanitizeBuild(undefined), null);
  assert.equal(sanitizeBuild(42), null);
  assert.equal(sanitizeBuild(""), null);
  assert.equal(sanitizeBuild("   "), null);
  assert.equal(sanitizeBuild("-leading"), null, "must start with a letter or digit");
  assert.equal(sanitizeBuild("it's"), null, "quotes never reach SQL");
  assert.equal(sanitizeBuild("a b"), null);
  assert.equal(sanitizeBuild("x".repeat(81)), null);
  assert.equal(sanitizeBuild("x".repeat(80)), "x".repeat(80));
});

test("shortBuild abbreviates shas and nothing else", () => {
  assert.equal(shortBuild("f804613c2a9e4b7d1e0f6a2b3c4d5e6f7a8b9c0d"), "f804613");
  assert.equal(shortBuild("F804613C2A9E"), "F804613");
  assert.equal(shortBuild("0.2.3-dev.19"), "0.2.3-dev.19");
  assert.equal(shortBuild("deadbeef"), "deadbeef", "eight hex characters could be a word");
  assert.equal(shortBuild("z".repeat(30)), `${"z".repeat(23)}…`);
  assert.equal(shortBuild("a".repeat(30)), "aaaaaaa", "all hex reads as a sha");
});
