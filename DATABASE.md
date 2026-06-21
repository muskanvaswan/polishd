# Buffd — Database setup

Buffd captures a high-frequency stream of behavioral events. In **local
development** it writes them to a SQLite file with zero configuration. In
**production** you must point it at a writable, network-accessible database,
because most modern hosts (Vercel, Netlify, Cloudflare) run your app on a
**read-only, ephemeral filesystem** — a local SQLite file there either fails to
open or is wiped on every cold start.

Crucially, Buffd events must **not** go through the same GitHub-commit storage
the notes content uses: a commit (and redeploy) per event would be catastrophic.
Analytics needs a real database.

---

## How the store decides what to use

`src/server/store.ts` opens its backend lazily and picks it in this
order:

1. **`BUFFD_DATABASE_URL`** is set → use that Postgres database (production).
2. Otherwise → use SQLite at **`BUFFD_DB_PATH`** (defaults to
   `.buffd/analytics.db`), good for local dev.
3. If neither can be opened (read-only FS, bad URL) → the store **latches to a
   safe no-op**: capture silently drops, the `/buffd` dashboard shows a notice,
   and the host app is never taken down.

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

Events land in `.buffd/analytics.db` (gitignored). Inspect them directly:

```bash
node -e "const {DatabaseSync}=require('node:sqlite'); \
  const db=new DatabaseSync('.buffd/analytics.db'); \
  console.log(db.prepare('SELECT type, count(*) c FROM events GROUP BY type').all())"
```

To use a custom path (e.g. a tmpfs-backed location), set `BUFFD_DB_PATH`.

---

## Production — Option A: Vercel Postgres / Neon (recommended)

Serverless Postgres with connection pooling, which matters because each
serverless invocation opens its own connection.

1. Create a database: **Vercel Dashboard → Storage → Create → Postgres**
   (Vercel provisions a [Neon](https://neon.tech) database), or sign up at
   neon.tech directly.
2. Copy the **pooled** connection string (host contains `-pooler`).
3. Add it to your environment:

   ```bash
   # Vercel: Project → Settings → Environment Variables
   BUFFD_DATABASE_URL=postgres://user:password@ep-xxx-pooler.region.aws.neon.tech/buffd?sslmode=require
   ```

4. Redeploy. The store creates the `events` table on first write.

### Schema (created automatically; shown for reference)

```sql
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
```

---

## Production — Option B: Turso (edge SQLite) — not yet wired up

> **Not implemented.** `BUFFD_DATABASE_URL` currently selects the **Postgres**
> backend only (via the `pg` driver). A `libsql://` URL will fail to connect and
> the store will latch to no-op. The libSQL adapter is a follow-up; until then,
> use Option A. The interface is backend-agnostic, so adding it is isolated to
> `openPostgres`'s sibling in `store.ts`.

If you prefer to keep SQLite semantics at the edge, the plan is to use
[Turso](https://turso.tech) (libSQL):

```bash
turso db create buffd
turso db show buffd --url        # → BUFFD_DATABASE_URL (libsql://...)
turso db tokens create buffd     # → BUFFD_DATABASE_AUTH_TOKEN
```

The same `events` schema applies (SQLite types, as in `store.ts`).

---

## Environment variable reference

| Variable                     | Required          | Purpose                                                       |
| ---------------------------- | ----------------- | ------------------------------------------------------------- |
| `BUFFD_DATABASE_URL`        | Production        | Postgres or libSQL connection string. Presence selects it.    |
| `BUFFD_DATABASE_AUTH_TOKEN` | Turso only        | Auth token for the libSQL database.                           |
| `BUFFD_DB_PATH`             | No                | Custom local SQLite path (dev). Default `.buffd/analytics.db`. |

No secrets ever live in `buffd.config.ts` — that file is imported by the
browser. Connection strings and tokens are read from `process.env` on the
server only.

---

## Data retention & privacy

- Events carry **no PII**: sessions are random UUIDs (no fingerprinting), and
  only element *labels* are stored — never user-typed input.
- Prune old rows on whatever cadence you like, e.g. a scheduled job:

  ```sql
  DELETE FROM events WHERE received_at < (extract(epoch from now()) - 60*60*24*90) * 1000;
  ```

  (90-day retention; `received_at` is milliseconds since epoch.)
- The capture layer honors the browser's **Do Not Track** signal and the
  `sampleRate` config, so you can dial volume down without code changes.
