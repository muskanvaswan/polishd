#!/usr/bin/env node
/**
 * The `polishd` CLI.
 *
 *   npx @polishd/next init     scaffold the glue files
 *   npx @polishd/next doctor   check that an install is actually wired up
 *
 * `init` is the default so the historical `npx polishd` keeps working.
 * Node builtins only; zero runtime dependencies.
 */
import { c } from "./shared.mjs";

const argv = process.argv.slice(2);
const cwd = process.cwd();
const command = argv[0] && !argv[0].startsWith("-") ? argv[0] : "init";
const rest = argv.filter((a) => a !== command);

if (argv.includes("--help") || argv.includes("-h")) {
  console.log(`
${c.bold("polishd")} — drop-in product analytics for Next.js

${c.bold("Usage")}
  npx @polishd/next init [options]      scaffold the files a Next.js app needs
  npx @polishd/next doctor [options]    check an existing install

${c.bold("init options")}
  --force        regenerate files this CLI wrote (backed up to .bak first).
                 Files it did not write are never overwritten.
  --dry-run      print what would happen, write nothing
  --js           emit .js/.jsx instead of TypeScript
  --config       also write a starter polishd.config.ts

${c.bold("doctor options")}
  --url <origin> also run live checks against a running server
  --js           inspect .js/.jsx files instead of TypeScript
`);
  process.exit(0);
}

let code = 0;
switch (command) {
  case "init": {
    const { runInit } = await import("./init.mjs");
    code = runInit(rest, cwd);
    break;
  }
  case "doctor": {
    const { runDoctor } = await import("./doctor.mjs");
    code = await runDoctor(rest, cwd);
    break;
  }
  default:
    console.error(
      c.err(`✗ Unknown command "${command}"`) + c.dim("\n  Try `init` or `doctor`, or --help."),
    );
    code = 1;
}

process.exit(code);
