# AGENTS.md — installing `@polishd/next` into an app

Instructions for a coding agent asked to add Polishd to a Next.js application.
Human-oriented prose lives in [README.md](./README.md) and
[docs/SETUP.md](./docs/SETUP.md); this file is the procedure.

Work through the phases in order. Do not skip verification — several of the
constraints below fail only at build time or, worse, silently at runtime.

---

## Phase 1 — Check preconditions

Read these from the target app before changing anything.

| Check | How | If it fails |
|---|---|---|
| Next.js App Router | an `app/` or `src/app/` directory exists | Stop. Polishd has no Pages Router support. |
| Next.js ≥ 15 | `next` version in `package.json` | Stop and report. |
| Node ≥ 22.5 | `node -v`, plus `engines`/`.nvmrc`/host setting | Capture silently no-ops on older Node. Warn the user and continue only if they accept that. |
| Tailwind CSS | `tailwindcss` in dependencies | The dashboard renders unstyled. See Phase 4. |
| Package manager | lockfile name | Use it consistently; don't mix. |

Record two facts you will need throughout:

- **`BASE`** — `src` if `src/app/` exists, otherwise `` (repo root).
- **`NEXT_MAJOR`** — 16+ uses `proxy.ts`; 15 uses `middleware.ts`.

## Phase 2 — Install

```bash
npm install @polishd/next
```

`pg` arrives automatically as an optional dependency; it is only loaded when a
Postgres URL is configured. No separate install is needed.

## Phase 3 — Scaffold

Prefer the CLI. It handles every branch in Phase 1 and Phase 4 for you:

```bash
npx polishd init
```

Flags: `--dry-run` (preview), `--force` (overwrite existing), `--js` (JavaScript
output), `--config` (also emit `polishd.config.ts`).

It writes four files, appends `.polishd/` to `.gitignore`, and wires Tailwind.
If it reports that a file already exists, do not overwrite blindly — merge by
hand following Phase 3b.

### Phase 3b — Manual scaffold (only if the CLI could not run)

Create exactly these four files. Contents are load-bearing; see Phase 5.

**1. `{BASE}/proxy.ts`** — mints the anonymous session cookie.
On Next 15 name the file `middleware.ts` and the function `middleware`.

```ts
import type { NextRequest } from "next/server";
import { withPolishdSession } from "@polishd/next/proxy";

export function proxy(request: NextRequest) {
  return withPolishdSession(request);
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon|assets).*)"],
};
```

If the app already has a proxy/middleware, do **not** replace it. Call
`withPolishdSession(request, existingResponse)` in the existing handler and
merge the matcher, keeping the `api` exclusion.

**2. `{BASE}/instrumentation-client.ts`** — starts browser capture.

```ts
import { initPolishd } from "@polishd/next/client";

initPolishd();
```

**3. `{BASE}/app/api/polishd/route.ts`** — the ingest endpoint.

```ts
import { createPolishdRoute } from "@polishd/next/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = createPolishdRoute();
```

**4. `{BASE}/app/polishd/page.tsx`** — the dashboard.

```tsx
import { createPolishdPage } from "@polishd/next/dashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default createPolishdPage();
```

Then add `.polishd/` to `.gitignore`.

## Phase 4 — Wire Tailwind

The dashboard is built from Tailwind utility classes and ships **no stylesheet**.
Tailwind will not find it on its own — v4's content detection deliberately
ignores `node_modules`, and v3 only scans the globs you give it. Skipping this
step produces a dashboard that returns HTTP 200 and is completely unstyled.

**Tailwind v4** (no `tailwind.config.*`; CSS has `@import "tailwindcss"`) — add
to that CSS file, with the path relative to the file itself:

```css
@import "tailwindcss";
@source "../../node_modules/@polishd/next/dist";
```

**Tailwind v3** — add to `content` in `tailwind.config.*`:

```ts
content: ["./src/**/*.{ts,tsx}", "./node_modules/@polishd/next/dist/**/*.js"],
```

**No Tailwind** — tell the user the dashboard will be unstyled. Do not add
Tailwind to their app to fix this unless they ask.

## Phase 5 — Invariants

Violating any of these produces a broken build or a security hole. They are not
style preferences.

1. **`config.matcher` must be an inline array literal.** Next parses it
   statically; it cannot be imported, spread, or re-exported. It must exclude
   all of `/api` — under Next 16 + Turbopack a matcher that touches any
   `/api/*` route breaks resolution for the entire `/api` segment.

2. **`runtime` and `dynamic` must be declared inline** in both the route and the
   page module. `export { POST, runtime, dynamic } from "@polishd/next/route"`
   fails the build with *"Next.js can't recognize the exported `runtime` field
   in route. It mustn't be reexported."*

3. **Gate the dashboard in production.** With no `authenticate` callback, the
   dashboard *and its server actions* are public: anyone reaching the URL can
   read the analytics, change the configured model and API base URL, and spend
   the owner's model tokens. See Phase 6.

4. **Never import `@polishd/next/server` from a client component.** It pulls
   database drivers into the browser bundle. Use `@polishd/next/client` there.

5. **`runtime` must be `"nodejs"`.** The store uses `node:sqlite`/`pg`; neither
   runs on the Edge runtime.

## Phase 6 — Protect the dashboard

If the app has any auth helper, wire it up. Ask the user which one rather than
guessing.

```tsx
import { createPolishdPage } from "@polishd/next/dashboard";
import { isAuthenticated } from "@/lib/auth";
import { MyLogin } from "./login";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default createPolishdPage({
  authenticate: isAuthenticated,   // () => boolean | Promise<boolean>
  unauthorized: <MyLogin />,       // optional; a minimal screen otherwise
});
```

The same callback guards the AI server actions, re-running per request against
the caller's cookies. Polishd ships no auth code of its own.

A common pattern is to stay open in development and require auth in production:

```tsx
authenticate: async () =>
  process.env.NODE_ENV !== "production" || (await isAuthenticated()),
```

## Phase 7 — Verify

Run all of these. Report the results; do not declare success from the build
alone.

```bash
# 1. Build must pass.
npm run build

# 2. Serve it.
npm start &

# 3. The proxy mints a session cookie on a page request.
curl -sI http://localhost:3000/ | grep -i set-cookie
#    expect: polishd_session=<uuid>; Path=/; HttpOnly; SameSite=lax

# 4. The dashboard responds.
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/polishd
#    expect: 200

# 5. Ingest accepts a batch (reuse the cookie from step 3).
curl -s -X POST http://localhost:3000/api/polishd \
  -H 'content-type: application/json' \
  -H 'cookie: polishd_session=<uuid>' \
  -d '{"events":[{"type":"page_view","ts":1,"path":"/"}]}'
#    expect: {"ok":true,"stored":1}

# 6. Styling is present — the stylesheet must contain dashboard utilities.
#    Fetch the dashboard's CSS chunk and grep for `tabular-nums`.
```

In development the store writes `.polishd/analytics.db` (SQLite). Its presence
after step 5 confirms the write path end to end.

## Phase 8 — Production

Capture only persists in production once a Postgres URL is set — serverless
hosts have read-only, ephemeral filesystems, so the dev SQLite file cannot
survive there.

| Variable | Required | Purpose |
|---|---|---|
| `POLISHD_DATABASE_URL` | for production capture | Pooled Postgres connection string |
| `POLISHD_DB_PATH` | no | Custom SQLite path in dev |
| `POLISHD_AI_*` | no | Preset AI provider/model/key instead of using the dashboard |
| `POLISHD_GITHUB_*` | no | Repo + token for filing issues from findings |

Set the host's Node version to 22.x or later. See [DATABASE.md](./DATABASE.md)
for provisioning and schema.

Without a database URL the package degrades to a safe no-op: a console warning,
a notice on the dashboard, and no impact on the host app.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| *"can't recognize the exported `runtime` field"* | Route segment config re-exported | Declare `runtime`/`dynamic` inline (Phase 3b) |
| Every `/api/*` route 404s | Proxy matcher matches `/api` | Restore the `api` exclusion in the matcher |
| Dashboard renders unstyled | Tailwind isn't scanning `dist` | Phase 4 |
| Dashboard is empty, warning about the store | No writable backend | Set `POLISHD_DATABASE_URL`, or check Node ≥ 22.5 in dev |
| `ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite` | Node < 22.5 | Upgrade Node, or configure Postgres |
| No `polishd_session` cookie | Proxy file missing/misnamed, or matcher excludes the path | Check `proxy.ts` (Next 16) vs `middleware.ts` (Next 15) |
| Database drivers in the client bundle | `@polishd/next/server` imported client-side | Import from `@polishd/next/client` |

## Entry points

| Import | Contents | Environment |
|---|---|---|
| `@polishd/next` | config, `definePolishdConfig`, event types | isomorphic |
| `@polishd/next/client` | `initPolishd`, `PolishdMonitor` | browser |
| `@polishd/next/server` | store, ingest, queries, `withPolishdSession` | Node only |
| `@polishd/next/route` | `POST`, `createPolishdRoute` | Node only |
| `@polishd/next/proxy` | `proxy`, `config`, `withPolishdSession`, `polishdMatcher` | Edge-safe |
| `@polishd/next/dashboard` | `createPolishdPage`, `PolishdDashboard` | Node only |
