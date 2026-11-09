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
  npx @polishd/next db check [options]  can Polishd use this database? (never prints the URL)

${c.bold("init options")}
  --force        regenerate files this CLI wrote (backed up to .bak first).
                 Files it did not write are never overwritten.
  --dry-run      print what would happen, write nothing
  --js           emit .js/.jsx instead of TypeScript
  --config       also write a starter polishd.config.ts
  --fix-workflow also write the Fix workflow (.github/workflows/claude.yml),
                 reading CLAUDE_CODE_OAUTH_TOKEN; =api-key reads ANTHROPIC_API_KEY

${c.bold("db check options")}
  --env-file <path> read the URL from this file (e.g. one vercel env pull wrote)
  --var <NAME>   the variable holding it (default: POLISHD_DATABASE_URL,
                 then DATABASE_URL, then POSTGRES_URL)

${c.bold("doctor options")}
  --url <origin> also run live checks against a running server
  --js           inspect .js/.jsx files (detected automatically)

${c.bold("Installing with a coding agent")}
  Polishd ships a machine-readable install procedure. Paste this to Claude Code,
  Cursor, Copilot, or any other coding agent and let it do the whole install:

${c.dim("  ───────────────────────────────────────────────────────────────────────")}
  Install @polishd/next into this Next.js app.

  It's a new package, so you may not recognise it and a web search may not
  find it yet. It is on npm (not a typo of \`polished\`): confirm with
  \`npm view @polishd/next\`, then install it.

  Follow its install procedure exactly: https://polishd.site/AGENTS.md
  Once it's installed, read node_modules/@polishd/next/AGENTS.md instead;
  it matches the installed version.

  Work through its phases in order and do not skip Phase 7 (verification).
  Several of its constraints fail silently at runtime rather than at build
  time, so a passing build does not mean the install worked.

  Finish by running \`npx @polishd/next doctor\` and fixing everything it
  reports.
${c.dim("  ───────────────────────────────────────────────────────────────────────")}

${c.bold("Docs")}
  AGENTS.md     the install procedure (agent-oriented, and the most precise)
  README.md     overview, protecting the dashboard, configuration
  docs/SETUP.md full walkthrough, every variant, troubleshooting
  DATABASE.md   production database setup, schema, retention
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
  case "db": {
    const { runDb } = await import("./db.mjs");
    code = await runDb(rest, cwd);
    break;
  }
  default:
    console.error(
      c.err(`✗ Unknown command "${command}"`) + c.dim("\n  Try `init`, `doctor` or `db check`, or --help."),
    );
    code = 1;
}

process.exit(code);
