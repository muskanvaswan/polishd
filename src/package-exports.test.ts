/**
 * Every typed subpath export must also be reachable under TypeScript's legacy
 * `moduleResolution: "node"`, which ignores `exports` entirely. Next 15 still
 * writes that setting into a tsconfig it generates, and apps upgraded from
 * older Next versions keep it — there, a subpath missing from `typesVersions`
 * fails `next build` with "Cannot find module '@polishd/next/route'".
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("the root export's types are reachable without `exports`", () => {
  assert.equal(pkg.types, pkg.exports["."].types);
  assert.equal(pkg.main, pkg.exports["."].default);
});

test("every typed subpath export has a matching typesVersions entry", () => {
  const legacy: Record<string, string[]> = pkg.typesVersions["*"];
  for (const [subpath, target] of Object.entries<{ types?: string } | string>(pkg.exports)) {
    if (subpath === "." || typeof target === "string" || !target.types) continue;
    const key = subpath.replace(/^\.\//, "");
    assert.deepEqual(legacy[key], [target.types], `typesVersions is missing "${key}"`);
  }
});
