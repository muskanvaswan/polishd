#!/usr/bin/env node
/**
 * `npx @buffd/next init` — scaffold the glue files a Next.js app needs to wire
 * up Buffd. Node builtins only; zero runtime dependencies.
 *
 * Flags:
 *   --force     overwrite existing files
 *   --dry-run   print what would happen, write nothing
 *   --js        emit .js/.jsx instead of TypeScript
 *   --config    also write a starter buffd.config.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";

const args = new Set(process.argv.slice(2));
const FORCE = args.has("--force");
const DRY = args.has("--dry-run");
const JS = args.has("--js");
const WANT_CONFIG = args.has("--config");
const cwd = process.cwd();

const c = {
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  warn: (s) => `\x1b[33m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

// ── Detect project layout ────────────────────────────────────────────────────
const hasSrcApp = existsSync(join(cwd, "src", "app"));
const hasRootApp = existsSync(join(cwd, "app"));
if (!hasSrcApp && !hasRootApp) {
  console.error(
    c.warn("✗ Could not find an `app/` or `src/app/` directory.\n") +
      "  Run this from the root of a Next.js App Router project.",
  );
  process.exit(1);
}
const base = hasSrcApp ? "src" : ""; // where proxy/instrumentation live
const appDir = hasSrcApp ? join("src", "app") : "app";
const ext = JS ? "tsx" : "tsx"; // page is always JSX
const codeExt = JS ? "js" : "ts";
const pageExt = JS ? "jsx" : "tsx";

console.log(
  c.ok(`✔ Detected Next.js App Router`) +
    c.dim(` (${hasSrcApp ? "src/ layout" : "root layout"})`),
);

// ── File templates ───────────────────────────────────────────────────────────
const files = [
  {
    path: join(base, `proxy.${codeExt}`),
    merge: join(base, `middleware.${codeExt}`),
    body:
      (JS ? "" : `import type { NextRequest } from "next/server";\n`) +
      `import { withBuffdSession } from "@buffd/next/proxy";\n\n` +
      `export function proxy(request${JS ? "" : ": NextRequest"}) {\n` +
      `  return withBuffdSession(request);\n` +
      `}\n\n` +
      `// Next statically parses config.matcher, so it must be an inline literal\n` +
      `// here. Excluding all of /api is required — under Next 16 + Turbopack a\n` +
      `// matcher that touches /api breaks the whole /api segment.\n` +
      `export const config = {\n` +
      `  matcher: ["/((?!api|_next/static|_next/image|favicon|assets).*)"],\n` +
      `};\n`,
  },
  {
    path: join(base, `instrumentation-client.${codeExt}`),
    body: `import { initBuffd } from "@buffd/next/client";\n\ninitBuffd();\n`,
  },
  {
    path: join(appDir, "api", "buffd", `route.${codeExt}`),
    body: `export { POST, runtime, dynamic } from "@buffd/next/route";\n`,
  },
  {
    path: join(appDir, "buffd", `page.${pageExt}`),
    body:
      `import { createBuffdPage } from "@buffd/next/dashboard";\n\n` +
      `// Next requires these to be declared inline in the page module.\n` +
      `export const runtime = "nodejs";\n` +
      `export const dynamic = "force-dynamic";\n\n` +
      `// Unguarded by default. To protect it, pass an authenticate callback:\n` +
      `//   export default createBuffdPage({ authenticate: isAuthenticated });\n` +
      `export default createBuffdPage();\n`,
  },
];

if (WANT_CONFIG) {
  files.push({
    path: `buffd.config.${codeExt}`,
    body:
      `import { defineBuffdConfig } from "@buffd/next";\n\n` +
      `export default defineBuffdConfig({\n` +
      `  // sampleRate: 1,\n` +
      `  // rageClick: { count: 3, windowMs: 500 },\n` +
      `});\n`,
  });
}

// ── Write ────────────────────────────────────────────────────────────────────
function write(file) {
  const abs = join(cwd, file.path);
  if (existsSync(abs) && !FORCE) {
    console.log(c.warn(`⚠ ${file.path} exists`) + c.dim(" — skipped (use --force)"));
    return;
  }
  // If a middleware.ts already exists for the proxy file, print a merge snippet.
  if (file.merge && existsSync(join(cwd, file.merge)) && !FORCE) {
    console.log(
      c.warn(`⚠ ${file.merge} exists`) +
        c.dim(" — add this to it (and keep the matcher):\n") +
        `    import { withBuffdSession, buffdMatcher } from "@buffd/next/proxy";\n` +
        `    // call withBuffdSession(request) in your handler;\n` +
        `    // and merge buffdMatcher into your config.matcher`,
    );
    return;
  }
  if (DRY) {
    console.log(c.dim(`• would write ${file.path}`));
    return;
  }
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, file.body);
  console.log(c.ok(`✔ Created ${file.path}`));
}

for (const f of files) write(f);

// ── .gitignore ───────────────────────────────────────────────────────────────
const giPath = join(cwd, ".gitignore");
if (!DRY) {
  const gi = existsSync(giPath) ? readFileSync(giPath, "utf8") : "";
  if (!gi.includes(".buffd")) {
    appendFileSync(giPath, `${gi.endsWith("\n") || gi === "" ? "" : "\n"}.buffd/\n`);
    console.log(c.ok("✔ Added .buffd/ to .gitignore"));
  }
}

// ── Next steps ───────────────────────────────────────────────────────────────
console.log(`
${c.bold("Next steps:")}
  1. Local dev needs nothing — events write to ${c.dim(".buffd/analytics.db")} (SQLite).
  2. For production, set ${c.dim("BUFFD_DATABASE_URL")} (pooled Postgres). See DATABASE.md.
  3. Visit ${c.bold("/buffd")} to see the dashboard.
${DRY ? c.warn("\n(dry run — nothing was written)") : ""}`);
