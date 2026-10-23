/**
 * The compiled-in version must be the one in package.json.
 *
 * `npm version` and `npm run build` both regenerate src/version.ts, so drift
 * means a bump that went around both — which would make the dashboard compare
 * the wrong version against the registry, and either nag an up-to-date install
 * or stay silent on an old one. Fix with `node scripts/write-version.mjs`.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { POLISHD_VERSION } from "./version.ts";

test("src/version.ts matches package.json", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(POLISHD_VERSION, pkg.version);
});
