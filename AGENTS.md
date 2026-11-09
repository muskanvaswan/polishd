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
| Next.js ≥ 15.3 | the *installed* version, in `node_modules/next/package.json` — a range like `^15` or `latest` says nothing about what is installed | Stop and report. Earlier versions never load `instrumentation-client.ts`, so capture silently never starts. |
| Node ≥ 22.5 | `node -v`, plus `engines`/`.nvmrc`/host setting | Capture silently no-ops on older Node. Warn the user and continue only if they accept that. |
| Package manager | lockfile name | Use it consistently; don't mix. |

Record two facts you will need throughout:

- **`BASE`** — `src` if `src/app/` exists, otherwise `` (repo root).
- **`CC`** — whether `next.config.*` sets `cacheComponents: true`. It changes
  what the route and page may declare (Phase 3b, Invariants 1 and 4).

## Phase 2 — Install

```bash
npm install @polishd/next
```

`pg` arrives automatically as an optional dependency; it is only loaded when a
Postgres URL is configured. No separate install is needed.

Check the installed version (`node_modules/@polishd/next/package.json`). This
procedure is for **0.3.2 and later**, which need no proxy. Up to 0.3.2-dev.0 a
proxy was required: if that is what got installed, follow
`node_modules/@polishd/next/AGENTS.md` instead.

## Phase 3 — Scaffold

Prefer the CLI. It detects `BASE` and `CC` itself:

```bash
npx @polishd/next init
```

Flags: `--dry-run` (preview), `--force` (regenerate files the CLI itself wrote,
backing each up to `.bak` first; files that already match the template are
skipped), `--js` (JavaScript output), `--config` (also emit
`polishd.config.ts`).

It writes three files and appends `.polishd/` to `.gitignore`. It writes no
proxy or middleware and never touches an existing one.

**`--force` will not overwrite a file the CLI did not write**, so it is safe to
re-run.

### Phase 3b — Manual scaffold (only if the CLI could not run)

Create exactly these three files. Contents are load-bearing; see Phase 5.

**1. `{BASE}/instrumentation-client.ts`** — starts browser capture.

```ts
import { initPolishd } from "@polishd/next/client";

initPolishd();
```

**2. `{BASE}/app/api/polishd/route.ts`** — the ingest endpoint. It also mints
the anonymous session cookie, on a visitor's first batch.

```ts
import { createPolishdRoute } from "@polishd/next/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = createPolishdRoute();
```

**3. `{BASE}/app/polishd/page.tsx`** — the dashboard.

```tsx
import "@polishd/next/dashboard.css";
import { createPolishdPage } from "@polishd/next/dashboard";

export { metadata } from "@polishd/next/dashboard"; // keeps /polishd unindexed

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default createPolishdPage();
```

**When `CC` is true**, Next rejects `runtime` and `dynamic` in both files
(*"Route segment config … is not compatible with
`nextConfig.cacheComponents`"*). Leave both out of the route and the page —
Node is already the runtime and nothing here is cached — and render the
dashboard inside `<Suspense>`, which Cache Components needs around the cookies
it reads:

```tsx
export default createPolishdPage({ suspense: true });
```

Then add `.polishd/` to `.gitignore`.

### Phase 3c — The app already has a proxy or middleware

Leave it exactly as it is. Polishd does not go in it: the ingest route mints
the session cookie, so there is nothing to merge and no matcher to widen.

If it already calls `withPolishdSession` or `composePolishd` (an install from
before 0.3.2), it keeps working and needs no change. Tell the user it is now
optional; remove the Polishd call only if they ask, and never remove the
handler's own logic with it.

## Phase 4 — Styling

Nothing to do. The dashboard imports its own stylesheet, so it renders with the
Polishd palette whatever the host's Tailwind preset says. The CLI still writes
this line into the page, which is harmless and makes the dependency visible:

```tsx
import "@polishd/next/dashboard.css";
```

The stylesheet is compiled at publish time and self-contained. **Do not add
Tailwind to the app, and do not add an `@source` line** — neither is needed, and
the host's Tailwind version is irrelevant to how the dashboard renders.

It carries no global preflight and every rule is scoped to `.polishd-root`, so
it cannot restyle the host app. It loads the dashboard's brand fonts from
`dist/fonts` by relative URL. The host's bundler resolves them and serves them
from the app's own origin, so there is nothing to configure and no CSP
`font-src` change.

**On an existing 0.1.x install**, remove the `@source ".../@polishd/next/dist"`
line (or the `content` glob in `tailwind.config.*`). It compiles the dashboard's
class names against the *host's* palette, which has no `line`, `surface` or
`fg-3`: on packages before 0.2.3-dev.23 that is what turns borders white and
drops the greys. Upgrading is the fix; removing the line afterwards just stops
the wasted work.

## Phase 5 — Invariants

Violating any of these produces a broken build or a security hole. They are not
style preferences.

1. **`runtime` and `dynamic` must be declared inline** in both the route and the
   page module. `export { POST, runtime, dynamic } from "@polishd/next/route"`
   fails the build with *"Next.js can't recognize the exported `runtime` field
   in route. It mustn't be reexported."* **Exception: when `CC` is true,
   declare neither** — Next fails the build on both, in either form.

2. **The dashboard refuses to serve in production until access is decided.**
   It is not a read-only report: its settings change the configured model and
   API base URL, so reaching it means being able to redirect the owner's
   requests and spend their key. With no `POLISHD_DASHBOARD_TOKEN`, no
   `authenticate` callback, and no `POLISHD_DASHBOARD_PUBLIC=true`, production
   renders a locked screen and every server action denies. Development is
   unaffected. See Phase 6.

3. **Never import `@polishd/next/server` from a client component.** It pulls
   database drivers into the browser bundle. Use `@polishd/next/client` there.

4. **`runtime` must be `"nodejs"`.** The store uses `node:sqlite`/`pg`; neither
   runs on the Edge runtime. When `CC` is true, leave `runtime` out: Cache
   Components only runs on Node.

5. **Do not add a proxy or middleware for Polishd.** The ingest route mints the
   session cookie. A proxy added for it is wasted at best, and one whose
   matcher touches `/api` breaks every API route under Next 16 + Turbopack.

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

It verifies that capture and ingest exist, that `runtime` and `dynamic` are
declared rather than re-exported, that the dashboard stylesheet is imported,
and the access posture. A proxy is not expected; if the app has one that calls
Polishd, it checks that one's matcher too. With `cacheComponents` on, it checks
the opposite of the usual: that `runtime` and `dynamic` are absent and the
dashboard renders inside `<Suspense>`. It inspects
`.js`/`.jsx` files on its own when the install is JavaScript. Fix everything it
reports before continuing.

With the app running, add live checks — this is the only way to confirm the
cookie is really minted and the store is really writable. The write check is a
probe that records no event, so it is safe to point at production:

```bash
npx @polishd/next doctor --url http://localhost:3000
```

Then confirm by hand:

```bash
# 1. Build must pass.
npm run build

# 2. Serve it.
npm start &

# 3. Ingest mints a session cookie and reaches the store. A probe proves the
#    write path without adding a fake visit to the owner's analytics. The
#    Origin header is what a browser sends; without it no session is minted.
curl -si -X POST http://localhost:3000/api/polishd \
  -H 'content-type: application/json' \
  -H 'origin: http://localhost:3000' \
  -d '{"probe":true,"events":[]}' | grep -i -E 'set-cookie|reason'
#    expect: set-cookie: polishd_session=<uuid>; Path=/; Expires=…; Max-Age=31536000; Secure; HttpOnly; SameSite=lax
#            {"ok":true,"stored":0,"reason":"probe"}
#    (`Secure` only under `npm start`; `next dev` omits it)
#    "probe_unwritable" means no store could be opened (Phase 8, Node ≥ 22.5)
#    A page request (curl -sI /) sets no cookie. That is expected, not a fault:
#    do not add a proxy to "fix" it.

# 4. The dashboard responds.
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/polishd
#    expect: 200 — under `npm start` that is the locked screen until access is
#    decided (Phase 6); the server log says "[polishd] dashboard is locked"

# 5. Styling is present — the stylesheet must contain dashboard utilities.
#    The dashboard imports "@polishd/next/dashboard.css" itself; check that a
#    card border computes to rgb(38, 38, 38), not the host's border colour
#    (dark theme, the default; the light theme's is rgb(231, 231, 231)).
```

In development the store writes `.polishd/analytics.db` (SQLite). Its presence
after step 3 confirms the write path end to end.

## Phase 8 — Production

Without a Postgres URL the store is the SQLite file, in production too. That
works on a long-running server with a writable, persistent disk (and under
`npm start` locally), but serverless hosts have read-only, ephemeral
filesystems, so there capture only persists once a Postgres URL is set.

| Variable | Required | Purpose |
|---|---|---|
| `POLISHD_DATABASE_URL` | for production capture | Pooled Postgres connection string |
| `BLOB_STORE_ID` or `BLOB_READ_WRITE_TOKEN` | for production site snapshots | Injected automatically when a Vercel Blob store is connected — `BLOB_STORE_ID` for an OIDC connection, `BLOB_READ_WRITE_TOKEN` for the classic one; either works, as do public and private stores. The dashboard uploads snapshot images there straight from the browser, with an upload URL the server signs per file. `BLOB_WEBHOOK_PUBLIC_KEY` isn't needed |
| `POLISHD_SNAPSHOT_SERVICE` | no | `off` never calls the screenshot service (snapshots then only work in local development). A URL points at a self-hosted screenshot service |
| `POLISHD_DASHBOARD_TOKEN` | for production, unless auth is wired | Protects `/polishd`. `openssl rand -hex 32` |
| `POLISHD_DASHBOARD_PUBLIC` | no | `true` to serve the dashboard unguarded on purpose |
| `POLISHD_SESSION_COOKIE` | no | Rename the session cookie; read by ingest (and by a proxy calling `withPolishdSession`, if the app has one) |
| `NEXT_PUBLIC_POLISHD_BUILD` | no | Build label stamped on every event (commit sha, version, date), inlined at build time. On Vercel, `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA` is read automatically; elsewhere set this in the build command (`NEXT_PUBLIC_POLISHD_BUILD=$COMMIT_REF next build`). Without it the server stamps its own commit variable, or `git rev-parse HEAD` in development. Don't make it a secret or a per-deploy random value |
| `POLISHD_DB_PATH` | no | Custom SQLite path in dev |
| `POLISHD_AI_*` | no | Preset AI provider/model/key instead of using the dashboard |
| `POLISHD_GITHUB_*` | no | Repo + token for filing issues from findings |

Set the host's Node version to 22.x or later. See [DATABASE.md](./DATABASE.md)
for provisioning and schema.

**Site snapshots need no host changes beyond the Blob store.** Do **not** add
`outputFileTracingIncludes`, `serverExternalPackages`, `@sparticuz/chromium` or
`playwright` setup to the host's `next.config`. Production shots are taken by
Polishd's hosted screenshot service, which the dashboard calls from the
owner's browser, so the host never runs a browser. Tell the user plainly that
**page URLs and pixels pass through that service**. It shoots only the calling
site's public pages and stores nothing.

The dashboard asks the owner once, in a consent dialog the first time they
press Capture or generate a design review (which shoots the first screens of
the top pages for the model), before the service is ever used, and keeps the
answer in the store. **That choice is the owner's: don't pre-answer it, write it to the
store, or set anything to skip it.** If it's declined, or there's no Blob
store on Vercel, the Site snapshots section sits at the bottom of the tab,
turned off, with the reason. That's expected, not a broken install. Two things can still
need a change:

- **A strict Content-Security-Policy.** If the app sets `connect-src`, add
  `https://shots.polishd.muskanvaswan.xyz` (the service) and
  `https://vercel.com` (Blob uploads). Without them the dashboard reports a
  CSP block.
- **Protected previews.** Vercel Deployment Protection shows the service a
  login page, so snapshots only work on a public deployment. That's expected;
  don't work around it with bypass secrets.

`POLISHD_SNAPSHOT_SERVICE=off` stops the service from ever being called, for
owners who don't want URLs leaving their server. Snapshots then work only in
local development.

When no store can be opened — no database URL on a read-only filesystem, an
unreachable database, or Node < 22.5 — the package degrades to a safe no-op: a
console warning, a notice on the dashboard, and no impact on the host app.

## Troubleshooting

Run `npx @polishd/next doctor` first — it names most of these directly.

| Symptom | Cause | Fix |
|---|---|---|
| *"can't recognize the exported `runtime` field"* | Route segment config re-exported | Declare `runtime`/`dynamic` inline (Phase 3b) |
| *"Route segment config "dynamic" is not compatible with `nextConfig.cacheComponents`"* (or `"runtime"`) | The app sets `cacheComponents: true` | Remove both exports from the route and the page (Phase 3b) |
| *"Route "/polishd": … uncached or runtime data during prerendering"* | `cacheComponents` is on and the dashboard renders outside `<Suspense>` | `export default createPolishdPage({ suspense: true });` |
| *"Cannot find module '@polishd/next/route' or its corresponding type declarations"* at build | tsconfig has `"moduleResolution": "node"` and the package predates its `typesVersions` fallback | Upgrade the package. Don't change the host's tsconfig to work around it |
| Ingest answers 413 `too_large` | Request body over 1MB. A real batch is well under 64KB | Nothing to fix for real traffic; a client sending that much isn't the capture script |
| Every `/api/*` route 404s | A proxy of the app's whose matcher matches `/api` | Exclude `/api` from that matcher |
| Dashboard has harsh white borders and no greys | Package older than 0.2.3-dev.23 with no `dashboard.css` import, so the host's Tailwind styles it with the host's palette | Upgrade; remove the `@polishd/next/dist` scan line (Phase 4) |
| Dashboard is empty, warning about the store | No writable backend | Set `POLISHD_DATABASE_URL`, or check Node ≥ 22.5 in dev |
| Dashboard shows *"they arrive without a session, so none are stored"* | No batch can be minted a session: something in front of the app (CDN, firewall, proxy) strips both `Origin` and `Sec-Fetch-Site`, or a route of the app's own around `ingest()` passes no session id. Red means *nothing is being stored* — with events landing you get a neutral note instead | `doctor --url <origin>`; plain `doctor` only reads the source tree, so it can pass while a deployed site still drops every batch |
| Beacons return 200 but nothing is stored | Same as above — ingest answers `{ok:true,stored:0,reason:"no_session"}` so the client cannot see a failure | `doctor --url http://localhost:3000` |
| `ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite` | Node < 22.5 | Upgrade Node, or configure Postgres |
| `ExperimentalWarning: SQLite is an experimental feature` | Node's own `node:sqlite` module on 22.x | **Expected and harmless.** Not a Polishd instability. Do not "fix" it or switch stores because of it |
| No `polishd_session` cookie on a page request | Expected: the ingest route sets it on the response to the first batch | Nothing to fix. Check step 3 of Phase 7 instead; never add a proxy for it |
| Dashboard content unreachable below the fold | Host `body` doesn't scroll | Fixed by default; if an ancestor sets `transform`/`filter`/`contain`, pass `shell: false` and use a route-group layout (docs/SETUP.md) |
| Server actions 500 with an opaque digest | No dashboard page registered a policy | Expected if `app/polishd/page.tsx` was deleted — actions fail closed |
| Database drivers in the client bundle | `@polishd/next/server` imported client-side | Import from `@polishd/next/client` |
| Snapshot capture reports a CSP block | The app's `connect-src` omits the screenshot service or the Blob API | Add `https://shots.polishd.muskanvaswan.xyz` and `https://vercel.com` to `connect-src` |
| Snapshot capture: "behind Vercel's Deployment Protection" | A protected preview deployment | Expected — capture from the production domain |
| Snapshot capture: "nowhere to live on this deployment" | Vercel, no Blob store connected | Connect a Blob store (Storage → Blob), redeploy |
| Site snapshots at the bottom of the Design tab, marked Off | No Blob store, the owner declined the screenshot service, or the last capture found it unusable here (CSP, rate limit, outage, site not public). That last kind is remembered until "Try again" succeeds | Its message names which. Declining is the owner's choice — leave it |

## Entry points

| Import | Contents | Environment |
|---|---|---|
| `@polishd/next` | config, `definePolishdConfig`, event types | isomorphic |
| `@polishd/next/client` | `initPolishd`, `PolishdMonitor` | browser |
| `@polishd/next/server` | store, ingest, queries, `withPolishdSession` | Node only |
| `@polishd/next/route` | `POST`, `createPolishdRoute` | Node only |
| `@polishd/next/proxy` | `proxy`, `config`, `withPolishdSession`, `polishdMatcher`, `composePolishd` — optional, for installs that mint the cookie from a proxy | Edge-safe |
| `@polishd/next/dashboard` | `createPolishdPage`, `polishdTokenAuth`, `PolishdDashboard` | Node only |

## CLI

| Command | Purpose |
|---|---|
| `npx @polishd/next init` | Scaffold. `--dry-run`, `--force`, `--js`, `--config` |
| `npx @polishd/next doctor` | Check the install. `--url <origin>` adds live checks |
