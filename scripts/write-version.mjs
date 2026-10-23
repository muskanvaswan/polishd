#!/usr/bin/env node
/**
 * Write `src/version.ts` from package.json.
 *
 * The dashboard has to know which @polishd/next it is — that is the left-hand
 * side of every "update available" comparison — and it runs inside the host's
 * bundle, where reading our own package.json at runtime is unreliable: bundled
 * paths move, and serverless file tracing doesn't follow a computed path. So
 * the version is compiled in instead.
 *
 * Runs from `npm version` (the `version` lifecycle stages the file into the
 * version commit) and from every build, so a published dist can never carry a
 * stale value. `src/version.test.ts` catches drift between those two points.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const out = join(root, "src", "version.ts");

const source =
  "// Generated from package.json by scripts/write-version.mjs — do not edit.\n" +
  "// `npm version` and `npm run build` both rewrite it.\n" +
  `export const POLISHD_VERSION = ${JSON.stringify(version)};\n`;

let current = null;
try {
  current = readFileSync(out, "utf8");
} catch {
  // First run.
}
// Leave the file alone when nothing changed, so a build doesn't dirty the tree.
if (current !== source) writeFileSync(out, source);
