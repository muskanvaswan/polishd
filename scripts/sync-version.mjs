#!/usr/bin/env node
/**
 * Write package.json's version into src/version.ts.
 *
 * Runs as the `version` lifecycle script, after `npm version` bumps
 * package.json and before it commits, so the constant always ships in the
 * same commit as the version it names.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const file = join(root, "src", "version.ts");
const current = readFileSync(file, "utf8");
const next = current.replace(
  /export const POLISHD_VERSION = "[^"]*";/,
  `export const POLISHD_VERSION = ${JSON.stringify(version)};`,
);
if (next === current && !current.includes(JSON.stringify(version))) {
  throw new Error("sync-version: POLISHD_VERSION declaration not found in src/version.ts");
}
writeFileSync(file, next);
console.log(`src/version.ts → ${version}`);
