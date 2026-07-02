/**
 * Buffd — analytics store (server only).
 *
 * Two interchangeable backends sit behind one async interface:
 *
 *   • SQLite via Node's built-in `node:sqlite` (Node 22+) — zero npm dependency,
 *     no native build, used for local development by default.
 *   • Postgres via `pg` — used in production, selected by `BUFFD_DATABASE_URL`.
 *     Most modern hosts (Vercel, Netlify) run on a read-only, ephemeral
 *     filesystem where a local SQLite file can't persist, so real traffic must
 *     point at a networked database. See `DATABASE.md`.
 *
 * The store opens lazily and is deliberately fault-tolerant: if neither backend
 * can be opened (read-only FS, unreachable database, bad URL) it latches to a
 * safe no-op — capture silently drops and every read returns empty — so the
 * host app is never taken down by analytics.
 *
 * The interface is async because Postgres is; the SQLite backend simply resolves
 * its synchronous results. Callers never know which backend is live.
 */
import { defaultBuffdConfig } from "../config";
import type { BuffdEvent, BuffdEventRow } from "../shared/types";

/**
 * A backend-agnostic row map. Queries are written once, in a portable SQL
 * subset, with `?` placeholders; each backend adapts them to its own dialect.
 */
type Row = Record<string, unknown>;

interface Backend {
  /** Persist a batch of events for one session. Returns rows written. */
  insert(sessionId: string, events: BuffdEvent[]): Promise<number>;
  /** Run a read query. `?` placeholders are positional, in order. */
  query(sql: string, params?: unknown[]): Promise<Row[]>;
  /** Run a write statement (INSERT/UPDATE) that returns no rows. */
  exec(sql: string, params?: unknown[]): Promise<void>;
}

/** The columns every backend inserts, in a fixed order, for one event. */
const INSERT_COLS =
  "session_id, type, ts, path, selector, component, text, value, meta, received_at";

/** Turn one event into its positional values, matching `INSERT_COLS`. */
function eventValues(sessionId: string, e: BuffdEvent, now: number): unknown[] {
  return [
    sessionId,
    e.type,
    e.ts,
    e.path,
    e.selector ?? null,
    e.component ?? null,
    e.text ?? null,
    e.value ?? null,
    e.meta ? JSON.stringify(e.meta) : null,
    now,
  ];
}

// ── SQLite backend ───────────────────────────────────────────────────────────

import { DatabaseSync } from "node:sqlite";
import { dirname, isAbsolute, join } from "node:path";
import { mkdirSync } from "node:fs";

function resolveDbPath(): string {
  // POLISH_DB_PATH is read as a fallback for apps migrated from the pre-rename
  // build, so existing deployments keep working without env changes.
  const configured =
    process.env.BUFFD_DB_PATH || process.env.POLISH_DB_PATH || defaultBuffdConfig.databasePath;
  return isAbsolute(configured) ? configured : join(process.cwd(), configured);
}

function openSqlite(): Backend {
  const path = resolveDbPath();
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id  TEXT    NOT NULL,
      type        TEXT    NOT NULL,
      ts          INTEGER NOT NULL,
      path        TEXT    NOT NULL,
      selector    TEXT,
      component   TEXT,
      text        TEXT,
      value       REAL,
      meta        TEXT,
      received_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_path ON events(path);
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
    CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);

    CREATE TABLE IF NOT EXISTS buffd_meta (
      key        TEXT    PRIMARY KEY,
      value      TEXT    NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  return {
    async insert(sessionId, events) {
      if (events.length === 0) return 0;
      const now = Date.now();
      const stmt = db.prepare(
        `INSERT INTO events (${INSERT_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      let written = 0;
      // node:sqlite has no .transaction() helper; wrap manually for batch speed.
      db.exec("BEGIN");
      try {
        for (const e of events) {
          stmt.run(...(eventValues(sessionId, e, now) as never[]));
          written++;
        }
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
      return written;
    },
    async query(sql, params = []) {
      return db.prepare(sql).all(...(params as never[])) as Row[];
    },
    async exec(sql, params = []) {
      db.prepare(sql).run(...(params as never[]));
    },
  };
}

// ── Postgres backend ─────────────────────────────────────────────────────────

function openPostgres(url: string): Backend {
  // Lazy require so the SQLite-only dev path never loads `pg`. Importing here
  // (not at module top) also keeps the Edge bundler from tracing it needlessly.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Pool, types } = require("pg") as typeof import("pg");

  // pg returns BIGINT (int8, OID 20) and NUMERIC (OID 1700) as strings to avoid
  // precision loss. Our ids/counts/averages are all well within Number range,
  // and the dashboard expects numbers, so parse them eagerly for this pool.
  types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));
  types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));

  const pool = new Pool({
    connectionString: url,
    // Serverless invocations are short-lived and each opens its own pool, so
    // keep it tiny and let idle connections drop quickly. Use the *pooled*
    // (pgbouncer) connection string in production — see DATABASE.md.
    max: 3,
    idleTimeoutMillis: 10_000,
    // Hosted Postgres (Neon, Supabase, RDS) requires TLS; most managed
    // certificates aren't in the default CA bundle, so don't reject them.
    ssl: { rejectUnauthorized: false },
  });

  // Convert our portable `?` placeholders to Postgres' positional `$1, $2, …`.
  const toPg = (sql: string) => {
    let i = 0;
    return sql.replace(/\?/g, () => `$${++i}`);
  };

  const ready = pool.query(`
    CREATE TABLE IF NOT EXISTS events (
      id          BIGSERIAL PRIMARY KEY,
      session_id  TEXT        NOT NULL,
      type        TEXT        NOT NULL,
      ts          BIGINT      NOT NULL,
      path        TEXT        NOT NULL,
      selector    TEXT,
      component   TEXT,
      text        TEXT,
      value       DOUBLE PRECISION,
      meta        JSONB,
      received_at BIGINT      NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_path    ON events(path);
    CREATE INDEX IF NOT EXISTS idx_events_type    ON events(type);
    CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);

    CREATE TABLE IF NOT EXISTS buffd_meta (
      key        TEXT   PRIMARY KEY,
      value      TEXT   NOT NULL,
      updated_at BIGINT NOT NULL
    );
  `);

  return {
    async insert(sessionId, events) {
      if (events.length === 0) return 0;
      await ready;
      const now = Date.now();
      const cols = 10; // must match INSERT_COLS / eventValues
      const params: unknown[] = [];
      const tuples: string[] = [];
      events.forEach((e, row) => {
        const base = row * cols;
        // meta is the 9th column (index 8) — cast its text param to jsonb.
        const ph = Array.from({ length: cols }, (_, c) =>
          c === 8 ? `$${base + c + 1}::jsonb` : `$${base + c + 1}`,
        );
        tuples.push(`(${ph.join(", ")})`);
        params.push(...eventValues(sessionId, e, now));
      });
      const res = await pool.query(
        `INSERT INTO events (${INSERT_COLS}) VALUES ${tuples.join(", ")}`,
        params,
      );
      return res.rowCount ?? 0;
    },
    async query(sql, params = []) {
      await ready;
      const res = await pool.query(toPg(sql), params as unknown[]);
      return res.rows as Row[];
    },
    async exec(sql, params = []) {
      await ready;
      await pool.query(toPg(sql), params as unknown[]);
    },
  };
}

// ── Backend selection (lazy, cached, fault-tolerant) ─────────────────────────

/** undefined = not yet attempted; null = failed, stay no-op; Backend = ready. */
let backend: Backend | null | undefined;
/** Shared init promise so concurrent callers don't race to open the backend. */
let initPromise: Promise<Backend | null> | null = null;

async function getBackend(): Promise<Backend | null> {
  if (backend !== undefined) return backend;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      // POLISH_DATABASE_URL fallback keeps pre-rename deployments working.
      const url = process.env.BUFFD_DATABASE_URL || process.env.POLISH_DATABASE_URL;
      if (url) {
        const pg = openPostgres(url);
        // Force the lazy connection now so a bad URL latches to no-op loudly,
        // instead of silently failing on the first capture in production.
        await pg.query("SELECT 1");
        backend = pg;
      } else {
        backend = openSqlite();
      }
    } catch (err) {
      console.warn(
        "[buffd] analytics store unavailable, capture disabled:",
        err instanceof Error ? err.message : err,
      );
      backend = null;
    }
    return backend;
  })();

  return initPromise;
}

/** True when events are actually being persisted (used by the dashboard). */
export async function storeReady(): Promise<boolean> {
  return (await getBackend()) !== null;
}

/** Persist a batch of events for one session. Silently drops if no store. */
export async function insertEvents(
  sessionId: string,
  events: BuffdEvent[],
): Promise<number> {
  const b = await getBackend();
  if (!b || events.length === 0) return 0;
  try {
    return await b.insert(sessionId, events);
  } catch (err) {
    console.warn(
      "[buffd] insert failed, dropping batch:",
      err instanceof Error ? err.message : err,
    );
    return 0;
  }
}

/**
 * Run a portable read query, or return `[]` in no-op mode. Use `?` placeholders;
 * each backend rewrites them to its own dialect. The aggregation layer (and the
 * dashboard) goes through here so it never has to know which backend is live.
 */
export async function query(sql: string, params: unknown[] = []): Promise<Row[]> {
  const b = await getBackend();
  if (!b) return [];
  try {
    return await b.query(sql, params);
  } catch (err) {
    console.warn(
      "[buffd] query failed:",
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

// ── Key/value metadata (buffd_meta) ──────────────────────────────────────────
// A tiny single-row-per-key store for things that aren't events: the AI
// settings the dashboard owner configures, and the last generated AI summary
// (cached so the dashboard renders it without spending tokens). Returns
// null / no-ops when the store is unavailable, like the rest of this module.

/** Read one metadata value by key, or null when absent / no store. */
export async function getMeta(key: string): Promise<string | null> {
  const rows = await query(`SELECT value FROM buffd_meta WHERE key = ?`, [key]);
  const v = rows[0]?.value;
  return typeof v === "string" ? v : null;
}

/** Upsert one metadata value. Returns false when the store is unavailable. */
export async function setMeta(key: string, value: string): Promise<boolean> {
  const b = await getBackend();
  if (!b) return false;
  try {
    await b.exec(
      `INSERT INTO buffd_meta (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key, value, Date.now()],
    );
    return true;
  } catch (err) {
    console.warn(
      "[buffd] setMeta failed:",
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

/** Raw rows, newest first. For debugging and the queries layer. */
export async function allRows(limit = 1000): Promise<BuffdEventRow[]> {
  const rows = await query(`SELECT * FROM events ORDER BY id DESC LIMIT ?`, [limit]);
  return rows.map(deserialize);
}

function deserialize(row: Row): BuffdEventRow {
  return {
    id: Number(row.id),
    session_id: row.session_id as string,
    type: row.type as BuffdEventRow["type"],
    ts: Number(row.ts),
    path: row.path as string,
    selector: (row.selector as string) ?? undefined,
    component: (row.component as string) ?? undefined,
    text: (row.text as string) ?? undefined,
    value: row.value == null ? undefined : Number(row.value),
    meta: parseMeta(row.meta),
    received_at: Number(row.received_at),
  };
}

/**
 * Normalize the `meta` column across backends: SQLite stores it as a JSON
 * string, Postgres' JSONB comes back already parsed. Accept either.
 */
export function parseMeta(raw: unknown): BuffdEventRow["meta"] {
  if (raw == null) return undefined;
  if (typeof raw === "object") return raw as BuffdEventRow["meta"];
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as BuffdEventRow["meta"];
    } catch {
      return undefined;
    }
  }
  return undefined;
}
