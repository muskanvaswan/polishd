/**
 * `npx @polishd/next doctor` — check that an install is actually wired up.
 *
 * Every failure this looks for is one that produces no error at runtime. A
 * proxy named for the wrong Next major, a matcher that doesn't cover the pages
 * being captured, a route missing its `runtime` declaration, Tailwind not
 * scanning the package — each of these yields a working-looking app, HTTP 200s
 * on every beacon, and an empty dashboard. This turns that class of problem
 * into a list of sentences.
 *
 * Static checks run anywhere. `--url <origin>` adds live checks against a
 * running server, which is the only way to confirm the cookie is really minted
 * and the ingest route really stores.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  DIST_GLOB,
  c,
  detectLayout,
  detectNextMajor,
  nodeVersionOk,
  proxyShape,
  readJSON,
  readText,
} from "./shared.mjs";

const PASS = "pass";
const WARN = "warn";
const FAIL = "fail";

export async function runDoctor(argv, cwd) {
  const results = [];
  const add = (status, title, detail) => results.push({ status, title, detail });

  const urlIdx = argv.indexOf("--url");
  const origin = urlIdx !== -1 ? argv[urlIdx + 1] : null;
  const js = argv.includes("--js");
  const codeExt = js ? "js" : "ts";
  const pageExt = js ? "jsx" : "tsx";

  // ── Environment ────────────────────────────────────────────────────────────
  if (nodeVersionOk()) {
    add(PASS, `Node ${process.versions.node}`, "meets the >= 22.5.0 requirement");
  } else {
    add(
      FAIL,
      `Node ${process.versions.node} is too old`,
      "Polishd needs >= 22.5.0 — the dev store uses node:sqlite, added in 22.5.0.",
    );
  }

  const layout = detectLayout(cwd);
  if (!layout.found) {
    add(FAIL, "No app/ or src/app/ directory", "Run this from a Next.js App Router project root.");
    return report(results, origin);
  }
  const { base, appDir } = layout;

  const next = detectNextMajor(cwd);
  if (next.major === null) {
    add(
      WARN,
      "Could not determine the installed Next.js version",
      "Checks below assume Next 16+. Install dependencies first for an exact answer.",
    );
  } else {
    add(PASS, `Next.js ${next.version}`, `detected from ${next.source}`);
  }

  const shape = proxyShape(next, base, codeExt);

  // ── The proxy: right file, right export, usable matcher ────────────────────
  const proxyAbs = join(cwd, shape.path);
  const otherAbs = join(cwd, shape.otherPath);
  const proxySrc = readText(proxyAbs);
  const otherSrc = readText(otherAbs);

  if (!proxySrc && otherSrc) {
    add(
      FAIL,
      `Proxy is named ${shape.otherPath}, but this Next major loads ${shape.path}`,
      `Next ${next.major ?? "16+"} does not load ${shape.otherPath}. The file never runs, so no ` +
        `session cookie is minted and every event is silently dropped. Rename it to ` +
        `${shape.path} and rename the exported function to \`${shape.name}\`.`,
    );
  } else if (!proxySrc) {
    add(
      FAIL,
      `Missing ${shape.path}`,
      "Without it no session cookie is minted and ingest drops every batch. Run `npx @polishd/next init`.",
    );
  } else {
    add(PASS, `${shape.path} present`, `correct name for Next ${next.major ?? "16+"}`);

    if (new RegExp(`export\\s+(async\\s+)?function\\s+${shape.name}\\b`).test(proxySrc) ||
        new RegExp(`export\\s+const\\s+${shape.name}\\b`).test(proxySrc)) {
      add(PASS, `Exports \`${shape.name}\``, "matches what this Next major looks for");
    } else {
      add(
        FAIL,
        `${shape.path} does not export \`${shape.name}\``,
        `Next ${next.major ?? "16+"} calls the export named \`${shape.name}\`. An export under any ` +
          "other name is ignored, silently.",
      );
    }

    if (!/withPolishdSession|composePolishd/.test(proxySrc)) {
      add(
        FAIL,
        "Proxy never calls withPolishdSession",
        "The file runs but mints no cookie. Call `withPolishdSession(request)`, or wrap your own " +
          "handler with `composePolishd(handler, { matcher })`.",
      );
    }

    const matcher = proxySrc.match(/matcher\s*:\s*(\[[^\]]*\]|["'`][^"'`]*["'`])/);
    // Order matters: a referenced matcher never matches the literal pattern, so
    // checking "missing" first would report the vaguer of the two diagnoses for
    // the more specific and more common mistake.
    if (/\bmatcher\s*:\s*[A-Za-z_$]/.test(proxySrc)) {
      add(
        FAIL,
        "config.matcher is not an inline literal",
        "Next statically parses this value, so an imported or referenced matcher — including " +
          "Polishd's own `polishdMatcher` — is not read. The proxy then runs with no matcher at " +
          "all, which under Next 16 + Turbopack breaks route resolution for the entire /api " +
          "segment. Paste the array in literally.",
      );
    } else if (!matcher) {
      add(
        WARN,
        "No config.matcher found in the proxy",
        "Without one the proxy runs everywhere, including /api — which under Next 16 + Turbopack " +
          "breaks route resolution for the entire /api segment.",
      );
    } else {
      add(PASS, "config.matcher is an inline literal", matcher[1].replace(/\s+/g, " ").slice(0, 60));
      if (!/\(\?!.*\bapi\b/.test(matcher[1])) {
        add(
          WARN,
          "config.matcher does not exclude /api",
          "Under Next 16 + Turbopack a matcher that touches /api breaks route resolution for the " +
            "whole /api segment — every API route 404s.",
        );
      }
    }
  }

  // ── Capture and ingest ─────────────────────────────────────────────────────
  const clientPath = join(base, `instrumentation-client.${codeExt}`);
  const clientSrc = readText(join(cwd, clientPath));
  if (!clientSrc) {
    add(FAIL, `Missing ${clientPath}`, "Nothing initialises capture, so no events are ever sent.");
  } else if (!/initPolishd\s*\(/.test(clientSrc)) {
    add(WARN, `${clientPath} does not call initPolishd()`, "Capture never starts.");
  } else {
    add(PASS, `${clientPath} present`, "capture is initialised");
  }

  const routePath = join(appDir, "api", "polishd", `route.${codeExt}`);
  const routeSrc = readText(join(cwd, routePath));
  if (!routeSrc) {
    add(FAIL, `Missing ${routePath}`, "Beacons have nowhere to POST to.");
  } else {
    add(PASS, `${routePath} present`, "ingest endpoint exists");
    for (const [decl, value, why] of [
      ["runtime", "nodejs", "node:sqlite and pg cannot run on the Edge runtime"],
      ["dynamic", "force-dynamic", "the route mutates per request and must never be cached"],
    ]) {
      if (new RegExp(`export\\s+const\\s+${decl}\\s*=\\s*["']${value}["']`).test(routeSrc)) {
        add(PASS, `${routePath} declares ${decl} = "${value}"`, why);
      } else if (new RegExp(`export\\s*\\{[^}]*\\b${decl}\\b`).test(routeSrc)) {
        add(
          FAIL,
          `${routePath} re-exports \`${decl}\` instead of declaring it`,
          "Next statically parses route segment config and rejects a re-export — it must be " +
            `written inline as \`export const ${decl} = "${value}";\`.`,
        );
      } else {
        add(WARN, `${routePath} does not declare ${decl}`, why);
      }
    }
  }

  const pagePath = join(appDir, "polishd", `page.${pageExt}`);
  const pageSrc = readText(join(cwd, pagePath));
  if (!pageSrc) {
    add(WARN, `Missing ${pagePath}`, "No dashboard. Note the AI server actions fail closed without it.");
  } else {
    add(PASS, `${pagePath} present`, "dashboard route exists");
  }

  // ── Styling ────────────────────────────────────────────────────────────────
  const v3Config = ["tailwind.config.ts", "tailwind.config.js", "tailwind.config.mjs"]
    .map((f) => join(cwd, f))
    .find((f) => existsSync(f));
  const cssCandidates = [
    join("src", "app", "globals.css"),
    join("app", "globals.css"),
    join("src", "styles", "globals.css"),
    join("styles", "globals.css"),
    join("src", "app", "global.css"),
  ];
  const cssFile = cssCandidates.find((rel) => existsSync(join(cwd, rel)));
  const cssSrc = cssFile ? readText(join(cwd, cssFile)) : null;

  if (v3Config && readText(v3Config)?.includes("@polishd/next")) {
    add(PASS, "Tailwind v3 scans the Polishd dist", "the dashboard will render styled");
  } else if (cssSrc?.includes("@polishd/next")) {
    add(PASS, `${cssFile} sources the Polishd dist`, "the dashboard will render styled");
  } else {
    add(
      WARN,
      "Tailwind is not scanning the Polishd dist",
      `The dashboard renders as unstyled HTML. v4: add \`@source "<path>/${DIST_GLOB}";\` to your ` +
        `Tailwind entry stylesheet. v3: add "./${DIST_GLOB}/**/*.js" to \`content\`.`,
    );
  }

  // ── Access posture ─────────────────────────────────────────────────────────
  if (process.env.POLISHD_DASHBOARD_TOKEN) {
    add(PASS, "POLISHD_DASHBOARD_TOKEN is set", "the dashboard is protected by the built-in gate");
  } else if (process.env.POLISHD_DASHBOARD_PUBLIC === "true") {
    add(
      WARN,
      "Dashboard is explicitly public",
      "POLISHD_DASHBOARD_PUBLIC=true — anyone who finds the URL can change the configured model " +
        "and API base URL, and spend your model tokens.",
    );
  } else if (pageSrc && /authenticate\s*:/.test(pageSrc)) {
    add(PASS, "Dashboard passes its own `authenticate`", "access is gated by your app");
  } else {
    add(
      WARN,
      "No dashboard protection configured in this environment",
      "Fine locally. In production Polishd refuses to serve the dashboard until you set " +
        "POLISHD_DASHBOARD_TOKEN, pass `authenticate`, or set POLISHD_DASHBOARD_PUBLIC=true.",
    );
  }

  const gitignore = readText(join(cwd, ".gitignore")) ?? "";
  if (gitignore.includes(".polishd")) {
    add(PASS, ".polishd/ is gitignored", "the local analytics DB won't be committed");
  } else {
    add(WARN, ".polishd/ is not gitignored", "the local SQLite analytics DB may get committed.");
  }

  // ── Live checks ────────────────────────────────────────────────────────────
  if (origin) await liveChecks(origin, add, cwd);

  return report(results, origin);
}

/**
 * Confirm against a running server what static inspection can only infer: that
 * the proxy actually mints a cookie, and that ingest actually stores a row.
 */
async function liveChecks(origin, add, cwd) {
  const base = origin.replace(/\/$/, "");
  let cookie = null;

  try {
    const res = await fetch(base, { redirect: "manual" });
    const setCookie = res.headers.getSetCookie?.() ?? [];
    const session = setCookie.find((v) => /^polishd_session=|^[^=]*session=/.test(v));
    if (session) {
      cookie = session.split(";")[0];
      add(PASS, "Proxy mints a session cookie", `${base} responded with ${cookie.split("=")[0]}`);
    } else {
      add(
        FAIL,
        "No session cookie on a page request",
        `${base} returned ${res.status} without setting one. The proxy is not running on this ` +
          "path — check its filename, its exported function name, and that the matcher covers `/`.",
      );
    }
  } catch (err) {
    add(WARN, `Could not reach ${base}`, String(err.message ?? err));
    return;
  }

  const route = `${base}/api/polishd`;
  const body = JSON.stringify({
    events: [{ type: "page_view", ts: Date.now(), path: "/__polishd_doctor" }],
  });
  try {
    const res = await fetch(route, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
      body,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      add(FAIL, `Ingest route returned ${res.status}`, JSON.stringify(json));
    } else if (json?.reason === "no_session") {
      add(
        FAIL,
        "Ingest is dropping events: no_session",
        "The route works but the request carried no recognised session cookie. Either the proxy " +
          "isn't running, or the proxy and the route disagree about the cookie name — set " +
          "POLISHD_SESSION_COOKIE so both read the same value.",
      );
    } else if (json?.stored > 0) {
      add(PASS, "Ingest stored a test event", `${route} → ${JSON.stringify(json)}`);
    } else {
      add(WARN, "Ingest accepted but stored nothing", JSON.stringify(json));
    }
  } catch (err) {
    add(FAIL, `Could not POST to ${route}`, String(err.message ?? err));
  }
}

function report(results, origin) {
  const icon = { pass: c.ok("✔"), warn: c.warn("⚠"), fail: c.err("✖") };
  console.log(`\n${c.bold("polishd doctor")}\n`);
  for (const r of results) {
    console.log(`${icon[r.status]} ${r.title}`);
    if (r.detail && r.status !== PASS) console.log(c.dim(`    ${wrap(r.detail)}`));
    else if (r.detail) console.log(c.dim(`    ${r.detail}`));
  }

  const fails = results.filter((r) => r.status === FAIL).length;
  const warns = results.filter((r) => r.status === WARN).length;
  console.log(
    `\n${fails ? c.err(`${fails} problem${fails === 1 ? "" : "s"}`) : c.ok("no problems")}` +
      `${warns ? c.warn(`, ${warns} warning${warns === 1 ? "" : "s"}`) : ""}` +
      c.dim(`, ${results.filter((r) => r.status === PASS).length} checks passed`),
  );
  if (!origin) {
    console.log(
      c.dim("\nRun with --url http://localhost:3000 to also verify the cookie and ingest live."),
    );
  }
  return fails > 0 ? 1 : 0;
}

/** Indent continuation lines so multi-sentence details stay readable. */
function wrap(text, width = 76) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    if (line.length + w.length + 1 > width) {
      lines.push(line);
      line = w;
    } else {
      line = line ? `${line} ${w}` : w;
    }
  }
  if (line) lines.push(line);
  return lines.join("\n    ");
}
