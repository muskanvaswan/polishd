/**
 * `npx @polishd/next db check` — can Polishd use this database?
 *
 * For whoever wires up production, usually an agent choosing between the
 * app's own database and a new one. It connects with a URL held in an
 * environment variable — one `vercel env pull` wrote to a file, say — and never
 * prints it, so the password passes through no terminal and no transcript.
 *
 *   --env-file <path>  read variables from this file (it wins over the shell)
 *   --var <NAME>       the variable holding the URL; by default the first set
 *                      of POLISHD_DATABASE_URL, DATABASE_URL, POSTGRES_URL
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { parseEnv } from "node:util";

import { LEGACY_EVENTS_TABLE, POLISHD_TABLES, c, readText, tableOwner } from "./shared.mjs";

const URL_VARS = ["POLISHD_DATABASE_URL", "DATABASE_URL", "POSTGRES_URL"];

export async function runDb(argv, cwd) {
  const [sub, ...rest] = argv;
  if (sub !== "check") {
    console.error(c.err(`✗ Unknown db command "${sub ?? ""}"`) + c.dim("\n  Try `db check`."));
    return 1;
  }
  const opt = (flag) => {
    const i = rest.indexOf(flag);
    return i === -1 ? undefined : rest[i + 1];
  };

  // ── Find the URL, without printing it ──────────────────────────────────────
  let vars = process.env;
  const envFile = opt("--env-file");
  if (envFile) {
    const text = readText(resolve(cwd, envFile));
    if (text === null) {
      console.error(c.err(`✗ Can't read ${envFile}`));
      return 1;
    }
    vars = { ...process.env, ...parseEnv(text) };
  }
  const asked = opt("--var");
  const name = asked ?? URL_VARS.find((v) => vars[v]);
  const url = name ? vars[name] : undefined;
  if (!url) {
    console.error(
      c.err(`✗ ${asked ? `${asked} isn't set` : `None of ${URL_VARS.join(", ")} is set`}`) +
        c.dim(envFile ? ` in ${envFile} or the environment.` : " in the environment.") +
        c.dim("\n  On Vercel: vercel env pull .polishd/env.check --environment production --yes," +
          "\n  then pass --env-file .polishd/env.check (and delete the file after)."),
    );
    return 1;
  }
  let host = "the database";
  let scheme = null;
  try {
    const parsed = new URL(url);
    host = parsed.host;
    scheme = parsed.protocol.replace(/:$/, "");
  } catch {
    // Not URL-shaped; pg may still take it.
  }

  const results = [];
  const add = (status, title, detail) => results.push({ status, title, detail });

  // An app's DATABASE_URL may be MySQL, SQLite or Mongo; say so plainly
  // rather than as a connection error.
  if (scheme && !["postgres", "postgresql"].includes(scheme)) {
    add(
      "fail",
      `Polishd needs Postgres, and ${name} is a ${scheme} URL`,
      "Give Polishd a Postgres database of its own (on Vercel, a free Neon one).",
    );
    return report(results, name, envFile);
  }

  // ── Connect, with the driver the app itself would use ──────────────────────
  const pg = loadPg(cwd);
  if (!pg) {
    add("fail", "The pg driver isn't installed", "It's an optional dependency of @polishd/next. Run `npm install pg`.");
    return report(results, name, envFile);
  }
  const client = new pg.Client({
    connectionString: url,
    // As the store connects: managed hosts need TLS with their own certificates.
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10_000,
  });
  try {
    await client.connect();
  } catch (err) {
    add("fail", `Can't connect to ${host}`, redact(String(err?.message ?? err)));
    return report(results, name, envFile);
  }

  try {
    const { rows: about } = await client.query("SELECT current_schema() AS schema, version() AS version");
    const version = /PostgreSQL [\d.]+/.exec(about[0].version)?.[0] ?? "Postgres";
    add("pass", `Connected to ${host}`, `${version}, schema ${about[0].schema}`);
    if (/pooler/i.test(host)) {
      add("pass", "A pooled connection string", "what serverless instances should use");
    } else {
      add(
        "warn",
        "Not a pooled connection string",
        "Its host has no -pooler. Each serverless instance opens its own connections, so use the " +
          "provider's pooled string if it has one (Neon's has -pooler in the host).",
      );
    }

    const { rows: tables } = await client.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' ORDER BY table_name`,
    );
    const names = [...Object.keys(POLISHD_TABLES), LEGACY_EVENTS_TABLE];
    const { rows: cols } = await client.query(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = ANY($1)`,
      [names],
    );
    const owner = Object.fromEntries(
      names.map((t) => [t, tableOwner(t, cols.filter((r) => r.table_name === t).map((r) => r.column_name))]),
    );
    const foreign = Object.keys(POLISHD_TABLES).filter((t) => owner[t] === "foreign");
    const ours = Object.keys(POLISHD_TABLES).filter((t) => owner[t] === "polishd");
    // Polishd's own events table from before 0.3.2, which the store renames on open.
    const legacy = owner[LEGACY_EVENTS_TABLE] === "polishd";
    const others = tables
      .map((r) => r.table_name)
      .filter((t) => !(t in POLISHD_TABLES) && t !== "buffd_meta" && !(legacy && t === LEGACY_EVENTS_TABLE));

    if (foreign.length > 0) {
      add(
        "fail",
        `Polishd can't use this database: ${foreign.map((t) => `"${t}"`).join(" and ")} here isn't Polishd's`,
        "Something else already has a table by that name. Polishd won't write to it — its store " +
          "refuses and the dashboard says so — so give Polishd a database of its own.",
      );
    } else if (ours.length > 0 || legacy) {
      add(
        "pass",
        "Polishd's tables are already here",
        legacy && ours.length === 0
          ? `Under the name they had before 0.3.2 (${LEGACY_EVENTS_TABLE}); Polishd renames it to polishd_events, data and all, the next time it opens.`
          : "This database already holds Polishd's data; point POLISHD_DATABASE_URL at it as it is.",
      );
    } else if (others.length === 0) {
      add("pass", "The database is empty", "Polishd can have it to itself.");
    } else {
      const list = others.slice(0, 8).join(", ") + (others.length > 8 ? `, and ${others.length - 8} more` : "");
      add(
        "pass",
        "No clash with the app's tables",
        `Polishd would add two tables, polishd_events and polishd_meta, beside the app's ${others.length} (${list}).`,
      );
      const tool = schemaTool(cwd);
      if (tool) {
        add(
          "warn",
          `The app's schema is managed by ${tool}`,
          `${tool === "Prisma" ? "`prisma db push` and `prisma migrate dev`" : "`drizzle-kit push`"} treat tables ` +
            "they don't know as drift and can drop them, Polishd's included. Prefer a database of " +
            "Polishd's own" +
            (tool === "Drizzle" ? ", or keep Polishd's tables out with `tablesFilter` in drizzle.config." : "."),
        );
      }
    }
  } catch (err) {
    add("fail", "Couldn't read the database's tables", redact(String(err?.message ?? err)));
  } finally {
    await client.end().catch(() => {});
  }
  return report(results, name, envFile);
}

/** `pg` as the app resolves it, else the copy installed with this package. */
function loadPg(cwd) {
  for (const from of [join(cwd, "package.json"), import.meta.url]) {
    try {
      return createRequire(from)("pg");
    } catch {
      // try the next
    }
  }
  return null;
}

/** Which schema tool the app uses, if one that drops unknown tables. */
function schemaTool(cwd) {
  const pkg = readText(join(cwd, "package.json")) ?? "";
  if (existsSync(join(cwd, "prisma", "schema.prisma")) || /"prisma"\s*:/.test(pkg)) return "Prisma";
  if (["ts", "js", "mjs", "json"].some((ext) => existsSync(join(cwd, `drizzle.config.${ext}`))) || /"drizzle-kit"\s*:/.test(pkg)) {
    return "Drizzle";
  }
  return null;
}

/** A driver error may quote the connection string; never print one. */
function redact(message) {
  return message
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s'"`]+/gi, "<url>")
    .replace(/(password|pwd|passwd)\s*=\s*[^\s;&'"`]+/gi, "$1=<redacted>");
}

function report(results, name, envFile) {
  const icon = { pass: c.ok("✔"), warn: c.warn("⚠"), fail: c.err("✖") };
  console.log(`\n${c.bold("polishd db check")} ${c.dim(`— ${name}${envFile ? ` from ${envFile}` : ""}`)}\n`);
  for (const r of results) {
    console.log(`${icon[r.status]} ${r.title}`);
    if (r.detail) console.log(c.dim(`    ${r.detail}`));
  }
  return results.some((r) => r.status === "fail") ? 1 : 0;
}
