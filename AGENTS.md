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
| Package manager | lockfile name | Use it consistently; don't mix. |

Record two facts you will need throughout:

- **`BASE`** — `src` if `src/app/` exists, otherwise `` (repo root).
- **`NEXT_MAJOR`** — 16+ uses `proxy.ts`; 15 uses `middleware.ts`. Read the
  *installed* version from `node_modules/next/package.json`, not the range in
  `package.json` — `^16`, `latest` and `canary` tell you nothing about what is
  actually installed. The CLI does this for you; you need it only for Phase 3b.

Getting `NEXT_MAJOR` wrong is a silent total failure, not a build error: Next
simply never loads a file under the other name, so no session cookie is minted,
every beacon still returns 200, and nothing is ever stored.

## Phase 2 — Install

```bash
npm install @polishd/next
```

`pg` arrives automatically as an optional dependency; it is only loaded when a
Postgres URL is configured. No separate install is needed.

## Phase 3 — Scaffold

Prefer the CLI. It detects `BASE` and `NEXT_MAJOR` itself, so you do not have
to branch on them:

```bash
npx @polishd/next init
```

Flags: `--dry-run` (preview), `--force` (regenerate files the CLI itself wrote,
backing each up to `.bak` first), `--js` (JavaScript output), `--config` (also
emit `polishd.config.ts`).

It writes four files and appends `.polishd/` to `.gitignore`.
It names the proxy file for the detected Next major and reports which it chose;
if it could not determine the version it says so — check that against Phase 1
and rename by hand if it guessed wrong.

**`--force` will not overwrite a file the CLI did not write**, so it is safe to
re-run. When it finds a proxy it did not author it prints merge instructions
instead. Follow Phase 3c, not Phase 3b, in that case.

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

If the app already has a proxy/middleware, do **not** replace it — see Phase 3c.

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
import "@polishd/next/dashboard.css";
import { createPolishdPage } from "@polishd/next/dashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default createPolishdPage();
```

Then add `.polishd/` to `.gitignore`.

### Phase 3c — The app already has a proxy or middleware

Next loads exactly one proxy module, so Polishd goes **inside** the existing
one. Never replace it: that file typically carries auth redirects, i18n, A/B
routing, or rate limiting.

The trap is the matcher. One file means one `config.matcher`, so merging means
widening it to the union — and Polishd's matcher is near-total. A handler that
was scoped to two routes silently begins running on every request in the app.
Nothing errors; its redirects just start firing where they never did before.

Use `composePolishd` and declare the handler's original scope, which is
re-applied as an internal guard:

```ts
import { composePolishd } from "@polishd/next/proxy";

// Existing handler, unchanged.
function myProxy(request: NextRequest) { /* … */ }

// Keeps running only on /admin/*, though the matcher below is near-total.
export const proxy = composePolishd(myProxy, { matcher: "/admin/:path*" });

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon|assets).*)"],
};
```

Read the existing `config.matcher` **before** you overwrite it and pass exactly
that value as `matcher`. On Next 15 the file is `middleware.ts` and the export
must be named `middleware`.

`matcher` accepts Next's matcher strings or a `RegExp`. The union literal itself
must still be written by hand — Next statically parses it (Invariant 1).

## Phase 4 — Styling

One import in the dashboard page, which the CLI writes for you:

```tsx
import "@polishd/next/dashboard.css";
```

The stylesheet is compiled at publish time and self-contained. **Do not add
Tailwind to the app, and do not add an `@source` line** — neither is needed, and
the host's Tailwind version is irrelevant to how the dashboard renders.

It carries no global preflight and every rule is scoped to `.polishd-root`, so
it cannot restyle the host app. If you find a leftover
`@source ".../@polishd/next/dist"` from an older install, it is harmless but
obsolete — remove it.

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

3. **The dashboard refuses to serve in production until access is decided.**
   It is not a read-only report: its settings change the configured model and
   API base URL, so reaching it means being able to redirect the owner's
   requests and spend their key. With no `POLISHD_DASHBOARD_TOKEN`, no
   `authenticate` callback, and no `POLISHD_DASHBOARD_PUBLIC=true`, production
   renders a locked screen and every server action denies. Development is
   unaffected. See Phase 6.

4. **Never import `@polishd/next/server` from a client component.** It pulls
   database drivers into the browser bundle. Use `@polishd/next/client` there.

5. **`runtime` must be `"nodejs"`.** The store uses `node:sqlite`/`pg`; neither
   runs on the Edge runtime.

## Phase 6 — Protect the dashboard

Pick one of three. **If the app has no auth of its own, use the token** — do not
hand-roll a gate, and do not leave it for the user to figure out later.

**1. Built-in token (default choice for an app with no auth).** No code:

```bash
POLISHD_DASHBOARD_TOKEN=$(openssl rand -hex 32)
```

Add it to the app's `.env.example` and tell the user to set it in their
deployment environment. The locked screen renders a password form; the token is
exchanged for an httpOnly, path-scoped cookie by a server action, so it never
travels in a URL. Constant-time comparison, HMAC in the cookie rather than the
raw token, server-side expiry, and per-IP rate limiting are all handled.

Pass options only if the dashboard is not at `/polishd`:

```tsx
import { createPolishdPage, polishdTokenAuth } from "@polishd/next/dashboard";
export default createPolishdPage({
  authenticate: polishdTokenAuth({ basePath: "/admin/polishd" }),
});
```

**2. The app's own auth.** If the app has an auth helper, prefer it. Ask the
user which one rather than guessing.

```tsx
import { createPolishdPage } from "@polishd/next/dashboard";
import { isAuthenticated } from "@/lib/auth";
import { MyLogin } from "./login";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default createPolishdPage({
  authenticate: isAuthenticated,   // (ctx) => boolean | Promise<boolean>
  unauthorized: <MyLogin />,       // optional; a minimal screen otherwise
});
```

`authenticate` receives `{ cookies, headers }` for the request, so it need not
call `cookies()`/`headers()` itself. A zero-argument callback still works.

**3. Deliberately public.** Only if the user asks for it:

```bash
POLISHD_DASHBOARD_PUBLIC=true
```

In every case the same policy guards the AI server actions, re-running per
request against the caller's cookies. Note that an app which deletes
`app/polishd/page.tsx` while keeping the package leaves those actions routable
but always denying — correct, but confusing if you meet it cold.

## Phase 7 — Verify

Run all of these. Report the results; do not declare success from the build
alone — most of what can be wrong here builds cleanly and fails silently.

Start with the doctor, which checks the whole wiring in one command:

```bash
npx @polishd/next doctor
```

It verifies the proxy is named and exported for the detected Next major, that
`config.matcher` is an inline literal excluding `/api`, that `runtime` and
`dynamic` are declared rather than re-exported, that capture and ingest exist,
that the dashboard stylesheet is imported, and the access posture. Fix everything it
reports before continuing.

With the app running, add live checks — this is the only way to confirm the
cookie is really minted and events really store:

```bash
npx @polishd/next doctor --url http://localhost:3000
```

Then confirm by hand:

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
#    The dashboard page must import "@polishd/next/dashboard.css".
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
| `POLISHD_DASHBOARD_TOKEN` | for production, unless auth is wired | Protects `/polishd`. `openssl rand -hex 32` |
| `POLISHD_DASHBOARD_PUBLIC` | no | `true` to serve the dashboard unguarded on purpose |
| `POLISHD_SESSION_COOKIE` | no | Rename the session cookie; read by both proxy and ingest |
| `POLISHD_DB_PATH` | no | Custom SQLite path in dev |
| `POLISHD_AI_*` | no | Preset AI provider/model/key instead of using the dashboard |
| `POLISHD_GITHUB_*` | no | Repo + token for filing issues from findings |

Set the host's Node version to 22.x or later. See [DATABASE.md](./DATABASE.md)
for provisioning and schema.

Without a database URL the package degrades to a safe no-op: a console warning,
a notice on the dashboard, and no impact on the host app.

## Troubleshooting

Run `npx @polishd/next doctor` first — it names most of these directly.

| Symptom | Cause | Fix |
|---|---|---|
| *"can't recognize the exported `runtime` field"* | Route segment config re-exported | Declare `runtime`/`dynamic` inline (Phase 3b) |
| Every `/api/*` route 404s | Proxy matcher matches `/api` | Restore the `api` exclusion in the matcher |
| Dashboard renders unstyled | `@polishd/next/dashboard.css` not imported in the page | Phase 4 |
| Dashboard is empty, warning about the store | No writable backend | Set `POLISHD_DATABASE_URL`, or check Node ≥ 22.5 in dev |
| Dashboard shows *"no session cookie — your proxy isn't running"* | Proxy missing, misnamed for the Next major, matcher not covering the path, or a botched merge | Phase 3c and `doctor --url` |
| Beacons return 200 but nothing is stored | Same as above — ingest answers `{ok:true,stored:0,reason:"no_session"}` so the client cannot see a failure | `doctor --url http://localhost:3000` |
| Proxy and ingest disagree on the cookie name | `sessionCookie` threaded into one layer but not another | Set `POLISHD_SESSION_COOKIE`; both read it |
| `ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite` | Node < 22.5 | Upgrade Node, or configure Postgres |
| `ExperimentalWarning: SQLite is an experimental feature` | Node's own `node:sqlite` module on 22.x | **Expected and harmless.** Not a Polishd instability. Do not "fix" it or switch stores because of it |
| No `polishd_session` cookie | Proxy file missing/misnamed, or matcher excludes the path | Check `proxy.ts` (Next 16+) vs `middleware.ts` (Next 15) |
| Dashboard content unreachable below the fold | Host `body` doesn't scroll | Fixed by default; if an ancestor sets `transform`/`filter`/`contain`, pass `shell: false` and use a route-group layout (docs/SETUP.md) |
| Server actions 500 with an opaque digest | No dashboard page registered a policy | Expected if `app/polishd/page.tsx` was deleted — actions fail closed |
| Database drivers in the client bundle | `@polishd/next/server` imported client-side | Import from `@polishd/next/client` |

## Entry points

| Import | Contents | Environment |
|---|---|---|
| `@polishd/next` | config, `definePolishdConfig`, event types | isomorphic |
| `@polishd/next/client` | `initPolishd`, `PolishdMonitor` | browser |
| `@polishd/next/server` | store, ingest, queries, `withPolishdSession` | Node only |
| `@polishd/next/route` | `POST`, `createPolishdRoute` | Node only |
| `@polishd/next/proxy` | `proxy`, `config`, `withPolishdSession`, `polishdMatcher`, `composePolishd` | Edge-safe |
| `@polishd/next/dashboard` | `createPolishdPage`, `polishdTokenAuth`, `PolishdDashboard` | Node only |

## CLI

| Command | Purpose |
|---|---|
| `npx @polishd/next init` | Scaffold. `--dry-run`, `--force`, `--js`, `--config` |
| `npx @polishd/next doctor` | Check the install. `--url <origin>` adds live checks |
