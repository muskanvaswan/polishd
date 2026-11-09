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
  DEFAULTS_FILE,
  DIST_GLOB,
  c,
  defaultsFileProblems,
  detectCacheComponents,
  detectJsInstall,
  detectLayout,
  detectNextMajor,
  findConfigMatcher,
  matcherTouchesApi,
  nextLoadsClientInstrumentation,
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

  // `init --js` writes .js files, and its closing advice is a bare `doctor`;
  // inspecting .ts paths there reports every file missing.
  const js = argv.includes("--js") || detectJsInstall(cwd, base, appDir);
  const codeExt = js ? "js" : "ts";
  const pageExt = js ? "jsx" : "tsx";

  const next = detectNextMajor(cwd);
  if (next.major === null) {
    add(
      WARN,
      "Could not determine the installed Next.js version",
      "Checks below assume Next 16+. Install dependencies first for an exact answer.",
    );
  } else {
    if (nextLoadsClientInstrumentation(next) === false) {
      add(
        FAIL,
        `Next.js ${next.version} never loads instrumentation-client`,
        "Next added instrumentation-client.ts in 15.3. Before that it ignores the file, so " +
          "initPolishd() never runs and nothing is captured, with no error anywhere. Upgrade " +
          "Next to 15.3 or later.",
      );
    } else {
      add(PASS, `Next.js ${next.version}`, `detected from ${next.source}`);
    }
  }

  const shape = proxyShape(next, base, codeExt);

  // ── The proxy: optional, but checked when Polishd is in it ─────────────────
  // The ingest route mints the session cookie, so no proxy is the normal case.
  // A host's own proxy is none of Polishd's business; one that calls into
  // Polishd still gets its old checks, since a matcher that touches /api can
  // break the ingest route along with every other API route.
  const proxyAbs = join(cwd, shape.path);
  const otherAbs = join(cwd, shape.otherPath);
  const proxySrc = readText(proxyAbs);
  const otherSrc = readText(otherAbs);
  const callsPolishd = (src) => /withPolishdSession|composePolishd/.test(src ?? "");

  if (!proxySrc && !otherSrc) {
    add(PASS, "No proxy", "none needed — the ingest route mints the session cookie");
  } else if (!proxySrc && otherSrc) {
    add(
      WARN,
      `${shape.otherPath} is never loaded on Next ${next.major ?? "16+"}`,
      `This Next major loads ${shape.path}, so ${shape.otherPath} never runs. Polishd doesn't ` +
        "need it — the ingest route mints the session cookie — but anything else in it isn't " +
        `running either. Delete it, or rename it to ${shape.path} and its export to ` +
        `\`${shape.name}\` if it holds logic of your own.`,
    );
  } else if (!callsPolishd(proxySrc)) {
    add(PASS, `${shape.path} is your own`, "Polishd doesn't need to be in it");
  } else {
    add(
      PASS,
      `${shape.path} also mints the session cookie`,
      "optional — the ingest route mints it too, so this can go unless it holds logic of your own",
    );

    if (new RegExp(`export\\s+(async\\s+)?function\\s+${shape.name}\\b`).test(proxySrc) ||
        new RegExp(`export\\s+const\\s+${shape.name}\\b`).test(proxySrc)) {
      add(PASS, `Exports \`${shape.name}\``, "matches what this Next major looks for");
    } else {
      add(
        WARN,
        `${shape.path} does not export \`${shape.name}\``,
        `Next ${next.major ?? "16+"} calls the export named \`${shape.name}\`, so this file never ` +
          "runs. Sessions are unaffected (ingest mints them), but nothing else in it runs either.",
      );
    }

    const matcher = findConfigMatcher(proxySrc);
    if (matcher && !matcher.literal) {
      add(
        FAIL,
        "config.matcher is not an inline literal",
        "Next statically parses this value, so an imported or referenced matcher — including " +
          "Polishd's own `polishdMatcher` — is not read. The proxy then runs with no matcher at " +
          "all, which under Next 16 + Turbopack breaks route resolution for the entire /api " +
          "segment, ingest included. Paste the array in literally, or delete the proxy.",
      );
    } else if (!matcher) {
      add(
        WARN,
        "No config.matcher found in the proxy",
        "Without one the proxy runs everywhere, including /api — which under Next 16 + Turbopack " +
          "breaks route resolution for the entire /api segment.",
      );
    } else {
      add(PASS, "config.matcher is an inline literal", matcher.text.replace(/\s+/g, " ").slice(0, 60));
      if (matcherTouchesApi(matcher.text)) {
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

  // Under Cache Components Next rejects `runtime` and `dynamic` in the route and
  // the page, so the checks below turn around: present is the failure.
  const cc = detectCacheComponents(cwd);
  const declares = (src, decl) =>
    new RegExp(`export\\s+const\\s+${decl}\\s*=`).test(src) ||
    new RegExp(`export\\s*\\{[^}]*\\b${decl}\\b`).test(src);
  const ccChecks = (path, src) => {
    const found = ["runtime", "dynamic"].filter((decl) => declares(src, decl));
    if (found.length === 0) {
      add(PASS, `${path} omits runtime and dynamic`, `as cacheComponents (${cc.file}) requires`);
      return;
    }
    add(
      FAIL,
      `${path} declares ${found.map((d) => `\`${d}\``).join(" and ")}`,
      `${cc.file} turns on cacheComponents, and Next then fails the build on route segment ` +
        "config it doesn't support: remove them. Node is already the runtime, and nothing " +
        "Polishd serves is cached.",
    );
  };

  const routePath = join(appDir, "api", "polishd", `route.${codeExt}`);
  const routeSrc = readText(join(cwd, routePath));
  if (!routeSrc) {
    add(FAIL, `Missing ${routePath}`, "Beacons have nowhere to POST to.");
  } else if (cc.on) {
    add(PASS, `${routePath} present`, "ingest endpoint exists");
    ccChecks(routePath, stripComments(routeSrc));
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
  // The generated page's comments name `<Suspense>` and `metadata`; read the code.
  const pageCode = pageSrc && stripComments(pageSrc);
  if (!pageSrc) {
    add(WARN, `Missing ${pagePath}`, "No dashboard. Note the AI server actions fail closed without it.");
  } else {
    add(PASS, `${pagePath} present`, "dashboard route exists");
    if (cc.on) {
      ccChecks(pagePath, pageCode);
      if (/suspense\s*:\s*true|<Suspense\b|\binstant\s*=\s*false/.test(pageCode)) {
        add(PASS, "Dashboard renders inside <Suspense>", "as Cache Components needs around its cookies");
      } else {
        add(
          FAIL,
          `${pagePath} renders the dashboard outside <Suspense>`,
          "Cache Components prerenders /polishd, and the dashboard reads cookies on every " +
            "request, so the build fails with \"uncached or runtime data during prerendering\". " +
            "Use `export default createPolishdPage({ suspense: true });`.",
        );
      }
    }
    if (!/\bmetadata\b/.test(pageCode)) {
      add(
        WARN,
        `${pagePath} doesn't export the dashboard's metadata`,
        "So /polishd takes your app's metadata, and search engines may index it. Add " +
          '`export { metadata } from "@polishd/next/dashboard";`.',
      );
    }
  }

  // ── Defaults file ──────────────────────────────────────────────────────────
  // Optional, but each way it goes wrong is silent: a page that doesn't import
  // it reads none of it, and a key in it sits in git for good.
  const defaultsSrc = readText(join(cwd, DEFAULTS_FILE));
  const pageReadsDefaults = Boolean(pageCode && pageCode.includes(DEFAULTS_FILE));
  if (defaultsSrc === null) {
    if (pageReadsDefaults) {
      add(FAIL, `${pagePath} imports ${DEFAULTS_FILE}, which doesn't exist`, "The build fails until it does. `npx @polishd/next init` writes one.");
    }
  } else {
    let parsed;
    try {
      parsed = JSON.parse(defaultsSrc);
    } catch (e) {
      add(FAIL, `${DEFAULTS_FILE} isn't valid JSON`, `${e.message}. The build fails on it.`);
    }
    if (parsed !== undefined) {
      const { secrets, unknown, notObject } = defaultsFileProblems(parsed);
      if (notObject) add(WARN, `${DEFAULTS_FILE} isn't a JSON object`, "Nothing in it is read.");
      if (secrets.length > 0) {
        add(
          FAIL,
          `${DEFAULTS_FILE} holds a secret (${secrets.join(", ")})`,
          "The file is committed, so the secret is in git — rotate it. Polishd ignores it: set " +
            "POLISHD_AI_API_KEY / POLISHD_GITHUB_TOKEN where the app runs, or name a variable the " +
            "app already has in ai.apiKeyEnv.",
        );
      }
      if (unknown.length > 0) {
        add(WARN, `${DEFAULTS_FILE} has keys Polishd doesn't read`, `${unknown.join(", ")} — a typo, usually. They're ignored.`);
      }
      if (!pageSrc) {
        // Reported above as a missing page.
      } else if (!pageReadsDefaults) {
        add(
          WARN,
          `${pagePath} doesn't import ${DEFAULTS_FILE}`,
          "So the dashboard reads none of it. Add " +
            `\`import defaults from "…/${DEFAULTS_FILE}";\` and pass \`createPolishdPage({ defaults })\`` +
            " — or run `npx @polishd/next init --force` if init wrote the page.",
        );
      } else if (!notObject && secrets.length === 0) {
        add(PASS, `${DEFAULTS_FILE} is read by the dashboard`, "saved settings override it");
      }
    }
  }

  // ── Styling ────────────────────────────────────────────────────────────────
  // The dashboard imports its own stylesheet (the build adds the import to the
  // compiled entry), so nothing here can leave it unstyled any more, and a
  // page-level import is optional. What is still worth flagging is the 0.1.x
  // setup — the host's Tailwind scanning our dist. It used to be how the
  // dashboard got styled; it was never actually fine, because the host compiles
  // our class names against *its* palette, which has no `line`, `surface` or
  // `fg-3`: default borders, no greys. The shipped stylesheet now outranks it,
  // so it's only wasted work, but it's the first suspect if colours look off
  // on an older package.
  const hasImport = pageSrc ? /@polishd\/next\/dashboard\.css/.test(pageSrc) : false;
  const legacySources = [
    "tailwind.config.ts",
    "tailwind.config.js",
    "tailwind.config.mjs",
    join("src", "app", "globals.css"),
    join("app", "globals.css"),
    join("src", "styles", "globals.css"),
    join("styles", "globals.css"),
  ].filter((rel) => readText(join(cwd, rel))?.includes(DIST_GLOB));

  if (pageSrc) {
    add(
      PASS,
      "Dashboard loads its own stylesheet",
      hasImport
        ? "imported by the dashboard itself; the import in your page is now redundant but harmless"
        : "imported by the dashboard itself — no page-level import needed",
    );
  }
  if (legacySources.length > 0) {
    add(
      WARN,
      `Tailwind is still scanning our dist (${legacySources.join(", ")})`,
      `Remove the ${DIST_GLOB} line. It compiles the dashboard's class names against your ` +
        "palette rather than ours; the shipped stylesheet outranks the result, so it's wasted " +
        "work, and on an older package it's what turns the borders white and the greys off.",
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

/** The session cookie in a response's Set-Cookie headers, as `name=value`. */
function sessionCookieOf(res) {
  const setCookie = res.headers.getSetCookie?.() ?? [];
  return setCookie.find((v) => /^polishd_session=|^[^=]*session=/.test(v))?.split(";")[0] ?? null;
}

/**
 * Confirm against a running server what static inspection can only infer: that
 * a session cookie really gets minted, and that ingest actually stores a row.
 */
async function liveChecks(origin, add, cwd) {
  const base = origin.replace(/\/$/, "");
  let cookie = null;

  // A proxy, where there is one, mints the cookie on the page. Its absence is
  // the normal case now: the probe below is sent without a cookie, and the
  // route minting one on it is the check.
  try {
    const res = await fetch(base, { redirect: "manual" });
    cookie = sessionCookieOf(res);
    if (cookie) {
      add(PASS, "A proxy mints the session cookie", `${base} responded with ${cookie.split("=")[0]}`);
    }
  } catch (err) {
    add(WARN, `Could not reach ${base}`, String(err.message ?? err));
    return;
  }

  const route = `${base}/api/polishd`;
  // `probe` asks ingest to prove the store is writable without recording an
  // event: this is routinely run against production, and a stored test page
  // view would show up in the owner's real numbers.
  const body = JSON.stringify({ probe: true, events: [] });
  try {
    const res = await fetch(route, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // The route mints a session only for a request from a page on the
        // site, which a browser declares in these two headers; send them as a
        // browser would.
        Origin: new URL(base).origin,
        "Sec-Fetch-Site": "same-origin",
        ...(cookie ? { cookie } : {}),
      },
      body,
    });
    const json = await res.json().catch(() => null);
    const minted = cookie ? null : sessionCookieOf(res);
    if (minted) add(PASS, "Ingest mints the session cookie", `${route} set ${minted.split("=")[0]}`);
    if (!res.ok) {
      add(FAIL, `Ingest route returned ${res.status}`, JSON.stringify(json));
    } else if (json?.reason === "no_session") {
      add(
        FAIL,
        "Ingest is dropping events: no_session",
        "The request carried no session cookie and the route didn't mint one, so every new " +
          "visitor's batches are dropped. Routes from an older @polishd/next need a proxy to mint " +
          "it: upgrade the package on the site. Otherwise something in front of the app is " +
          "stripping both the Origin and Sec-Fetch-Site headers, which the route reads to tell a " +
          "page's batch from a bare script, or a route of your own around `ingest()` passes no " +
          "session id.",
      );
    } else if (json?.reason === "probe") {
      add(PASS, "Ingest reached the store", `${route} wrote a probe (no event recorded)`);
    } else if (json?.reason === "probe_unwritable") {
      add(
        FAIL,
        "Ingest has no writable store",
        "The route and cookie work, but nothing can be saved. In production set " +
          "POLISHD_DATABASE_URL; locally check Node >= 22.5 and that .polishd/ is writable.",
      );
    } else if (json?.ok && !json.reason) {
      add(
        WARN,
        "Could not verify the write path",
        "The site's @polishd/next predates the doctor's write probe. The cookie check above " +
          "still holds; upgrade the package on the site to check storage too.",
      );
    } else {
      add(WARN, "Ingest accepted but stored nothing", JSON.stringify(json));
    }
  } catch (err) {
    add(FAIL, `Could not POST to ${route}`, String(err.message ?? err));
  }
}

/** Source with its comments removed, so a check reads only the code. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
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
    // "no problems" means the source tree is right, which is not the same as
    // the deployed site minting cookies — a build that ships without the proxy
    // passes every check here. Say so, so a green run isn't read as proof.
    console.log(
      c.dim(
        "\nThese are static checks on your source tree. Run with" +
          " --url http://localhost:3000 (or your deployed origin) to verify the" +
          " cookie and ingest on the running site.",
      ),
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
