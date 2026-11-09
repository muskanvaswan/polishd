# Polishd — Database setup

Polishd captures a high-frequency stream of behavioral events. In **local
development** it writes them to a SQLite file with zero configuration. In
**production** you must point it at a writable, network-accessible database,
because most modern hosts (Vercel, Netlify, Cloudflare) run your app on a
**read-only, ephemeral filesystem** — a local SQLite file there either fails to
open or is wiped on every cold start.

Crucially, Polishd events must **not** go through the same GitHub-commit storage
the notes content uses: a commit (and redeploy) per event would be catastrophic.
Analytics needs a real database.

---

## How the store decides what to use

`src/server/store.ts` opens its backend lazily and picks it in this
order:

1. **`POLISHD_DATABASE_URL`** is set → use that Postgres database (production).
2. Otherwise → use SQLite at **`POLISHD_DB_PATH`** (defaults to
   `.polishd/analytics.db`), good for local dev.
3. If neither can be opened (read-only FS, bad URL) → the store **latches to a
   safe no-op**: capture silently drops and the host app is never taken down.
   `/polishd`, once past its access check, shows a setup screen in place of the
   dashboard: what failed (no URL on a read-only filesystem, a database it
   can't reach, the `pg` driver missing, Node too old for SQLite), the likely
   cause, and the steps. The error it shows has URLs and passwords removed.
   The latch lasts for the server instance, so redeploy or restart after
   changing the URL.

> Both backends sit behind one async interface (`storeReady`, `insertEvents`,
> the `query` helper), so no caller knows which is live. Aggregation SQL is
> written in a portable subset — `?` placeholders (rewritten to `$1, $2, …` for
> Postgres) and `SUM(CASE WHEN … THEN 1 ELSE 0 END)` rather than SQLite's
> `SUM(x = y)` — so the same queries run on either backend.
>
> The Postgres backend uses the [`pg`](https://www.npmjs.com/package/pg) driver
> and requires the Node.js runtime (the ingest route and dashboard already pin
> `runtime = "nodejs"`). It connects over TLS with `rejectUnauthorized: false`,
> which every managed host (Neon, Supabase, RDS) needs.

---

## Local development (default — nothing to do)

```bash
npm run dev
```

Events land in `.polishd/analytics.db` (gitignored). Inspect them directly:

```bash
node -e "const {DatabaseSync}=require('node:sqlite'); \
  const db=new DatabaseSync('.polishd/analytics.db'); \
  console.log(db.prepare('SELECT type, count(*) c FROM polishd_events GROUP BY type').all())"
```

To use a custom path (e.g. a tmpfs-backed location), set `POLISHD_DB_PATH`.

---

## Production — Option A: Vercel Postgres / Neon (recommended)

Serverless Postgres with connection pooling, which matters because each
serverless invocation opens its own connection.

**If the app already has a Postgres database in production, use that one** —
see [Sharing the app's own database](#sharing-the-apps-own-database). A new
one is for when it has none.

**On Vercel, from the command line** (in the app's folder, project linked):

```bash
vercel integration add neon --prefix POLISHD_ -e production --no-env-pull
```

It creates a Neon database (pick the free plan when asked), connects it to
the project, and — because of the prefix — names the pooled connection string
`POLISHD_DATABASE_URL`, so there is nothing to copy. `-e production` keeps
preview deployments out of your production analytics, and `--no-env-pull`
leaves your `.env.local` alone. Redeploy, and you're done. A coding agent
installing Polishd does this for you (AGENTS.md, Phase 6a), after asking.

**Or by hand:**

1. Create a database: **Vercel Dashboard → Storage → Create → Postgres**
   (Vercel provisions a [Neon](https://neon.tech) database), or sign up at
   neon.tech directly.
2. Copy the **pooled** connection string (host contains `-pooler`).
3. Add it to your environment:

   ```bash
   # Vercel: Project → Settings → Environment Variables
   POLISHD_DATABASE_URL=postgres://user:password@ep-xxx-pooler.region.aws.neon.tech/polishd?sslmode=require
   ```

4. Redeploy. The store creates its tables on first write.

### Sharing the app's own database

The usual choice. Polishd adds two tables, `polishd_events` and
`polishd_meta`, in the default schema; their names keep them clear of the
app's. Point `POLISHD_DATABASE_URL` at the same database the app uses. Two
things to know:

- **A table by one of Polishd's names that isn't Polishd's** is refused before
  anything is created or altered, and `/polishd` shows "This database is
  already in use". In practice nothing else uses these names.
- **A schema tool that drops what it doesn't know.** `prisma db push`,
  `prisma migrate dev` and `drizzle-kit push` treat Polishd's tables as drift
  and can drop them. With one of those, keep Polishd's tables out of its view
  (Drizzle: `tablesFilter`) or give Polishd a database of its own.

`npx @polishd/next db check` answers both before anything is written, and
says when the app's database isn't Postgres at all. It reads the URL from an
environment variable or an env file and never prints it:

```bash
vercel env pull .polishd/env.check --environment production --yes
npx @polishd/next db check --env-file .polishd/env.check --var DATABASE_URL
rm .polishd/env.check
```

### Schema (created automatically; shown for reference)

```sql
CREATE TABLE IF NOT EXISTS polishd_events (
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
  received_at BIGINT      NOT NULL,
  install_id  TEXT,
  build       TEXT
);
CREATE INDEX IF NOT EXISTS idx_polishd_events_path     ON polishd_events(path);
CREATE INDEX IF NOT EXISTS idx_polishd_events_type     ON polishd_events(type);
CREATE INDEX IF NOT EXISTS idx_polishd_events_session  ON polishd_events(session_id);
CREATE INDEX IF NOT EXISTS idx_polishd_events_install  ON polishd_events(install_id);
CREATE INDEX IF NOT EXISTS idx_polishd_events_received ON polishd_events(received_at);
CREATE INDEX IF NOT EXISTS idx_polishd_events_build    ON polishd_events(build);
```

**Before 0.3.2 this table was called `events`.** The store renames Polishd's
own on the first open after upgrading, rows and indexes included; it tells
it from an app's `events` by its columns, and leaves an app's alone. A
deployment rolled back to an older version afterwards writes to a fresh
`events` table again, and those rows stay there when you upgrade back.

(`install_id` is null on every first-party event; it is only set on rows that
arrived through a `@polishd/next/telemetry` endpoint, which tags each event
with the hostname of the remote installation that sent it — derived
server-side from the request's Origin header. `build` is the build of the
site the event was captured on — a commit sha or deployment label, see the
README's [Builds](./README.md#builds) — and null on rows stored before builds
were tracked or where none was known. Databases created before either column
existed are migrated automatically at open.)

---

## Cloudflare — not supported yet

Polishd's production store doesn't run on Cloudflare Workers (OpenNext) yet.
It keeps one Postgres pool across requests, which Workers don't allow, and it
has no D1 backend. Capture there stays a safe no-op.

## Production — Option B: Turso (edge SQLite) — not yet wired up

> **Not implemented.** `POLISHD_DATABASE_URL` currently selects the **Postgres**
> backend only (via the `pg` driver). A `libsql://` URL will fail to connect and
> the store will latch to no-op. The libSQL adapter is a follow-up; until then,
> use Option A. The interface is backend-agnostic, so adding it is isolated to
> `openPostgres`'s sibling in `store.ts`.

If you prefer to keep SQLite semantics at the edge, the plan is to use
[Turso](https://turso.tech) (libSQL):

```bash
turso db create polishd
turso db show polishd --url        # → POLISHD_DATABASE_URL (libsql://...)
turso db tokens create polishd     # → POLISHD_DATABASE_AUTH_TOKEN
```

The same `polishd_events` schema applies (SQLite types, as in `store.ts`).

---

## Environment variable reference

| Variable                     | Required          | Purpose                                                       |
| ---------------------------- | ----------------- | ------------------------------------------------------------- |
| `POLISHD_DATABASE_URL`        | Production        | Postgres or libSQL connection string. Presence selects it.    |
| `POLISHD_DATABASE_AUTH_TOKEN` | Turso only        | Auth token for the libSQL database.                           |
| `POLISHD_DB_PATH`             | No                | Custom local SQLite path (dev). Default `.polishd/analytics.db`. |

No secrets ever live in `polishd.config.ts` — that file is imported by the
browser. Connection strings and tokens are read from `process.env` on the
server only.

---

## Data retention & privacy

- Events carry **no PII**: sessions are random UUIDs (no fingerprinting), and
  only element *labels* are stored — never user-typed input.
- Prune old rows on whatever cadence you like, e.g. a scheduled job:

  ```sql
  DELETE FROM polishd_events WHERE received_at < (extract(epoch from now()) - 60*60*24*90) * 1000;
  ```

  (90-day retention; `received_at` is milliseconds since epoch.)
- The capture layer honors the browser's **Do Not Track** signal and the
  `sampleRate` config, so you can dial volume down without code changes.
