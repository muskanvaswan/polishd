#!/usr/bin/env node
/**
 * `npx @polishd/next init` — scaffold the glue files a Next.js app needs to wire
 * up Polishd. Node builtins only; zero runtime dependencies.
 *
 * Flags:
 *   --force     regenerate files this CLI wrote (backed up first). Files it did
 *               not write are never overwritten, with or without this flag.
 *   --dry-run   print what would happen, write nothing
 *   --js        emit .js/.jsx instead of TypeScript
 *   --config    also write a starter polishd.config.ts
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { createRequire } from "node:module";
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
  err: (s) => `\x1b[31m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

function readJSON(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

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
const codeExt = JS ? "js" : "ts";
const pageExt = JS ? "jsx" : "tsx";

console.log(
  c.ok(`✔ Detected Next.js App Router`) +
    c.dim(` (${hasSrcApp ? "src/ layout" : "root layout"})`),
);

// ── Node version ─────────────────────────────────────────────────────────────
// The dev store uses `node:sqlite`, which landed in 22.5.0. Checked here rather
// than left to a confusing "cannot find module node:sqlite" at first request.
{
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 5)) {
    console.log(
      c.warn(`⚠ Node ${process.versions.node}`) +
        c.dim(" — Polishd needs >= 22.5.0 (the dev store uses node:sqlite)."),
    );
  }
}

// ── Detect the installed Next major ──────────────────────────────────────────
// Which file Next actually loads depends on this: 16+ reads `proxy.ts`, 15 reads
// `middleware.ts`. Writing the wrong name is a *silent total failure* — the file
// never runs, no session cookie is ever minted, and every beacon still returns
// 200 with nothing stored. There is no error anywhere to follow.
function detectNextMajor() {
  // Prefer the resolved install. A declared range ("^16", "latest", "canary")
  // does not tell you what is actually in node_modules.
  const direct = readJSON(join(cwd, "node_modules", "next", "package.json"));
  if (direct?.version) {
    const major = Number.parseInt(direct.version, 10);
    if (Number.isFinite(major)) {
      return { major, version: direct.version, source: "node_modules" };
    }
  }
  // Hoisted / pnpm / workspace installs won't be at that path.
  try {
    const require = createRequire(join(cwd, "package.json"));
    const resolved = readJSON(require.resolve("next/package.json"));
    if (resolved?.version) {
      const major = Number.parseInt(resolved.version, 10);
      if (Number.isFinite(major)) {
        return { major, version: resolved.version, source: "node_modules" };
      }
    }
  } catch {
    // `next` not installed yet, or its exports map hides package.json.
  }
  // Last resort: the declared range. Better than guessing blind.
  const pkg = readJSON(join(cwd, "package.json"));
  const range =
    pkg?.dependencies?.next ?? pkg?.devDependencies?.next ?? pkg?.peerDependencies?.next;
  if (typeof range === "string") {
    const major = Number.parseInt(range.replace(/^[^\d]*/, ""), 10);
    if (Number.isFinite(major)) return { major, version: range, source: "package.json" };
  }
  return { major: null, version: null, source: null };
}

const NEXT = detectNextMajor();
// Unknown version defaults to the modern shape, but says so — an unannounced
// guess here is exactly the silent failure this detection exists to prevent.
const USE_MIDDLEWARE = NEXT.major !== null && NEXT.major <= 15;
const proxyName = USE_MIDDLEWARE ? "middleware" : "proxy";
const counterpartName = USE_MIDDLEWARE ? "proxy" : "middleware";
const proxyPath = join(base, `${proxyName}.${codeExt}`);
const counterpartPath = join(base, `${counterpartName}.${codeExt}`);

if (NEXT.major === null) {
  console.log(
    c.warn("⚠ Could not determine the installed Next.js version") +
      c.dim(`\n  Assuming 16+ and writing ${proxyPath}.`) +
      c.dim(`\n  On Next 15 rename it to ${counterpartPath} and rename the exported`) +
      c.dim(`\n  function to \`${counterpartName}\` — Next 15 does not load ${proxyPath}.`),
  );
} else {
  console.log(
    c.ok(`✔ Detected Next.js ${NEXT.version}`) +
      c.dim(` — using ${proxyPath}`) +
      (NEXT.source === "package.json" ? c.dim(" (from package.json range)") : ""),
  );
}

// ── File templates ───────────────────────────────────────────────────────────
// Every generated file carries this marker. It is what lets `--force` tell "a
// file I wrote and may regenerate" apart from "the user's own code", which is
// the difference between a convenience flag and a data-loss bug.
const SENTINEL = "@polishd/next init";
const stamp = `// Generated by \`npx ${SENTINEL}\`. Edit freely — \`--force\` backs up\n// this file before regenerating it.\n`;

const mergeHint =
  c.dim(`  Add Polishd to your existing handler instead:\n`) +
  `    import { withPolishdSession, polishdMatcher } from "@polishd/next/proxy";\n` +
  c.dim(`    // 1. thread your response through withPolishdSession(request, response)\n`) +
  c.dim(`    // 2. merge polishdMatcher into your inline config.matcher\n`) +
  c.dim(`    // withPolishdSession is a no-op once the cookie exists, so widening\n`) +
  c.dim(`    // the matcher is safe — but guard your own logic to its original paths.\n`) +
  c.dim(`    // See composePolishd() in the README for a worked example.`);

const files = [
  {
    path: proxyPath,
    // The other spelling of this same file. A host on Next 16 that still has a
    // middleware.ts (or vice versa) has a real collision worth flagging.
    counterpart: counterpartPath,
    mergeHint,
    body:
      (JS ? "" : `import type { NextRequest } from "next/server";\n`) +
      `import { withPolishdSession } from "@polishd/next/proxy";\n\n` +
      `export function ${proxyName}(request${JS ? "" : ": NextRequest"}) {\n` +
      `  return withPolishdSession(request);\n` +
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
    body: `import { initPolishd } from "@polishd/next/client";\n\ninitPolishd();\n`,
  },
  {
    path: join(appDir, "api", "polishd", `route.${codeExt}`),
    // runtime/dynamic must be declared here, not re-exported: Next statically
    // parses route segment config and rejects `export { runtime } from ...`
    // ("Next.js can't recognize the exported `runtime` field in route").
    body:
      `import { createPolishdRoute } from "@polishd/next/route";\n\n` +
      `// node:sqlite / pg need the Node runtime — never the Edge runtime.\n` +
      `export const runtime = "nodejs";\n` +
      `// This route mutates per-request; it must never be statically cached.\n` +
      `export const dynamic = "force-dynamic";\n\n` +
      `export const POST = createPolishdRoute();\n`,
  },
  {
    path: join(appDir, "polishd", `page.${pageExt}`),
    body:
      `import { createPolishdPage } from "@polishd/next/dashboard";\n\n` +
      `// Next requires these to be declared inline in the page module.\n` +
      `export const runtime = "nodejs";\n` +
      `export const dynamic = "force-dynamic";\n\n` +
      `// In production the dashboard refuses to render until you either set\n` +
      `// POLISHD_DASHBOARD_TOKEN, pass your own \`authenticate\`, or opt out\n` +
      `// explicitly with POLISHD_DASHBOARD_PUBLIC=true. See README §Protecting\n` +
      `// the dashboard — it can change your AI settings and spend your tokens.\n` +
      `export default createPolishdPage();\n`,
  },
];

if (WANT_CONFIG) {
  files.push({
    path: `polishd.config.${codeExt}`,
    body:
      `import { definePolishdConfig } from "@polishd/next";\n\n` +
      `export default definePolishdConfig({\n` +
      `  // sampleRate: 1,\n` +
      `  // rageClick: { count: 3, windowMs: 500 },\n` +
      `});\n`,
  });
}

// ── Write ────────────────────────────────────────────────────────────────────
/** Did this CLI write the file currently at `abs`? */
function isOurs(abs) {
  try {
    return readFileSync(abs, "utf8").includes(SENTINEL);
  } catch {
    return false;
  }
}

function write(file) {
  const abs = join(cwd, file.path);
  const body = stamp + file.body;

  // A proxy under the *other* name is a collision even when our target is free:
  // the host already has a handler, and Next only ever loads one of these.
  if (file.counterpart && existsSync(join(cwd, file.counterpart)) && !isOurs(join(cwd, file.counterpart))) {
    console.log(
      c.warn(`⚠ ${file.counterpart} already exists`) +
        c.dim(` — Next loads only one proxy module, and on this version it is ${file.path}.\n`) +
        mergeHint,
    );
    return;
  }

  if (existsSync(abs)) {
    // Never overwrite code this CLI did not author — not even with --force.
    // Losing a hand-written proxy (auth redirects, i18n, rate limiting) to a
    // flag someone passed for an unrelated skipped file is not a tradeoff.
    if (!isOurs(abs)) {
      console.log(
        c.warn(`⚠ ${file.path} exists and was not written by Polishd`) +
          c.dim(" — left untouched.\n") +
          (file.mergeHint
            ? file.mergeHint
            : c.dim(`  Rename or delete it if you want a fresh copy scaffolded.`)),
      );
      return;
    }
    if (!FORCE) {
      console.log(
        c.dim(`• ${file.path} already scaffolded — skipped (use --force to regenerate)`),
      );
      return;
    }
    if (DRY) {
      console.log(c.dim(`• would back up ${file.path} → ${file.path}.bak and regenerate`));
      return;
    }
    copyFileSync(abs, `${abs}.bak`);
    writeFileSync(abs, body);
    console.log(c.ok(`✔ Regenerated ${file.path}`) + c.dim(` (previous copy saved as ${file.path}.bak)`));
    return;
  }

  if (DRY) {
    console.log(c.dim(`• would write ${file.path}`));
    return;
  }
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body);
  console.log(c.ok(`✔ Created ${file.path}`));
}

for (const f of files) write(f);

// ── .gitignore ───────────────────────────────────────────────────────────────
{
  const giPath = join(cwd, ".gitignore");
  const gi = existsSync(giPath) ? readFileSync(giPath, "utf8") : "";
  if (!gi.includes(".polishd")) {
    if (DRY) {
      console.log(c.dim("• would add .polishd/ to .gitignore"));
    } else {
      appendFileSync(giPath, `${gi.endsWith("\n") || gi === "" ? "" : "\n"}.polishd/\n`);
      console.log(c.ok("✔ Added .polishd/ to .gitignore"));
    }
  }
}

// ── Tailwind ─────────────────────────────────────────────────────────────────
// The dashboard is styled entirely with Tailwind utility classes and ships no
// stylesheet of its own, so Tailwind has to be told to scan the package's dist.
// Neither version finds it by default: v4's automatic content detection skips
// node_modules, and v3 only scans the globs it is given. Without this the
// dashboard renders completely unstyled.
const DIST_GLOB = "node_modules/@polishd/next/dist";

function wireTailwind() {
  const v3Config = ["tailwind.config.ts", "tailwind.config.js", "tailwind.config.mjs"]
    .map((f) => join(cwd, f))
    .find((f) => existsSync(f));

  if (v3Config) {
    console.log(
      c.warn(`⚠ Tailwind v3 config detected`) +
        c.dim(" — add this to its `content` array:\n") +
        `    "./${DIST_GLOB}/**/*.js"`,
    );
    return;
  }

  // Tailwind v4: find the entry stylesheet that imports tailwind.
  const cssCandidates = [
    join("src", "app", "globals.css"),
    join("app", "globals.css"),
    join("src", "styles", "globals.css"),
    join("styles", "globals.css"),
    join("src", "app", "global.css"),
  ];
  for (const rel of cssCandidates) {
    const abs = join(cwd, rel);
    if (!existsSync(abs)) continue;
    const css = readFileSync(abs, "utf8");
    if (!/@import\s+["']tailwindcss["']/.test(css)) continue;
    if (css.includes("@polishd/next")) {
      console.log(c.dim(`• ${rel} already sources Polishd's styles`));
      return;
    }
    // `@source` is resolved relative to the stylesheet, so walk back up to root.
    const depth = dirname(rel).split(/[\\/]/).filter(Boolean).length;
    const source = `${"../".repeat(depth)}${DIST_GLOB}`;
    if (DRY) {
      console.log(c.dim(`• would add @source "${source}" to ${rel}`));
      return;
    }
    writeFileSync(
      abs,
      css.replace(
        /(@import\s+["']tailwindcss["'];?)/,
        `$1\n/* Generate the Polishd dashboard's utility classes (Tailwind skips node_modules). */\n@source "${source}";`,
      ),
    );
    console.log(c.ok(`✔ Added @source "${source}" to ${rel}`));
    return;
  }

  console.log(
    c.warn("⚠ No Tailwind entry stylesheet found") +
      c.dim(" — the dashboard needs Tailwind to render styled.\n") +
      c.dim("  v4: add to your CSS →  ") +
      `@source "<path-to>/${DIST_GLOB}";\n` +
      c.dim("  v3: add to content →  ") +
      `"./${DIST_GLOB}/**/*.js"`,
  );
}

wireTailwind();

// ── Next steps ───────────────────────────────────────────────────────────────
console.log(`
${c.bold("Next steps:")}
  1. Local dev needs nothing — events write to ${c.dim(".polishd/analytics.db")} (SQLite).
  2. For production, set ${c.dim("POLISHD_DATABASE_URL")} (pooled Postgres). See DATABASE.md.
  3. Set ${c.dim("POLISHD_DASHBOARD_TOKEN")} to protect ${c.bold("/polishd")} in production.
  4. Visit ${c.bold("/polishd")} to see the dashboard.
${DRY ? c.warn("\n(dry run — nothing was written)") : ""}`);
