/**
 * The version constant must name the version in package.json — it's what the
 * dashboard's telemetry reports, and a stale one pins every error on the wrong
 * release. `npm version` keeps them in step (scripts/sync-version.mjs); this
 * catches a bump made any other way.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { POLISHD_VERSION } from "./version.ts";

test("POLISHD_VERSION matches package.json", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(POLISHD_VERSION, pkg.version);
});
