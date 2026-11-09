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
`polishd.config.ts`), `--fix-workflow` (also write the Fix workflow; see
Phase 6c — don't pass it before the user has said yes).

It writes three files, plus `polishd.defaults.json` at the root if there is
none (you fill it in during Phase 6b), and appends `.polishd/` to
`.gitignore`. It writes no proxy or middleware and never touches an existing
one. It never overwrites `polishd.defaults.json`, even with `--force`.

**`--force` will not overwrite a file the CLI did not write**, so it is safe to
re-run.

### Phase 3b — Manual scaffold (only if the CLI could not run)

Create exactly these three files, and `polishd.defaults.json` (Phase 6b).
Contents are load-bearing; see Phase 5.

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
import defaults from "../../polishd.defaults.json"; // "../../../" when BASE is src

export { metadata } from "@polishd/next/dashboard"; // keeps /polishd unindexed

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default createPolishdPage({ defaults });
```

The page imports the defaults file rather than Polishd reading it from disk,
so the bundler ships it to hosts whose functions can't see the repo.

**When `CC` is true**, Next rejects `runtime` and `dynamic` in both files
(*"Route segment config … is not compatible with
`nextConfig.cacheComponents`"*). Leave both out of the route and the page —
Node is already the runtime and nothing here is cached — and render the
dashboard inside `<Suspense>`, which Cache Components needs around the cookies
it reads:

```tsx
export default createPolishdPage({ defaults, suspense: true });
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

## Phase 6a — Connect the production database (Vercel)

Locally there is nothing to do. In production Polishd needs a Postgres URL in
`POLISHD_DATABASE_URL`, and on Vercel nothing is captured until it has one.
Connect it now, while you know the project, rather than leave the user to
meet the dashboard's setup screen after they deploy.

Polishd's tables are `polishd_events` and `polishd_meta`: they can't clash with
the app's own. So **the database the app already uses in production is the
first choice**, and a new one is only for when there's none Polishd can use.

**Only when the project is already on Vercel.** All three must hold; check
them without changing anything:

- `npx vercel whoami` prints a username: the CLI is already signed in.
- `.vercel/project.json` exists: this repository is linked to a Vercel project.
- `npx vercel ls --environment production --status READY --limit 1` lists a
  deployment: the project is live in production.

If any doesn't, skip this phase. Don't sign in, link or deploy for the user.
Tell them Polishd needs a pooled Postgres URL as `POLISHD_DATABASE_URL` in
production, and that once the site is deployed, `/polishd` shows the setup
steps (on Vercel, one command). On Cloudflare Workers Polishd's production
store doesn't run yet; say so if that's the host.

**Then, on Vercel:**

1. **Already connected?** `npx vercel env ls --environment production` lists
   names, not values. If `POLISHD_DATABASE_URL` is there, go to Phase 6b.
   Never pass `--json`: it prints the values.
2. **Use the app's production database.** Look in that list for
   `DATABASE_URL`, `POSTGRES_URL`, or a prefixed `*_DATABASE_URL`. If there's
   none, go to step 3. If there is one, check it without reading the URL
   yourself:

   ```bash
   npx vercel env pull .polishd/env.check --environment production --yes
   npx @polishd/next db check --env-file .polishd/env.check --var DATABASE_URL
   ```

   `.polishd/` is gitignored, and `db check` never prints the URL. Don't print
   the file. Then, by what `db check` says:

   - *"No clash with the app's tables"* or *"Polishd's tables are already
     here"*: use it. Copy the value into Polishd's variable without it passing
     through the terminal, and tell the user Polishd adds two tables,
     `polishd_events` and `polishd_meta`, to that database:

     ```bash
     node -e 'const {parseEnv}=require("node:util");process.stdout.write(parseEnv(require("node:fs").readFileSync(".polishd/env.check","utf8")).DATABASE_URL)' \
       | npx vercel env add POLISHD_DATABASE_URL --environment production --sensitive
     ```

     If `db check` also warned that Prisma or Drizzle manages the schema, ask
     the user first. `prisma db push`, `prisma migrate dev` and `drizzle-kit push`
     can drop tables they don't know. With Drizzle, `tablesFilter` can keep
     Polishd's out.
   - *"Polishd needs Postgres"* (the app's database is MySQL, SQLite or
     another engine), *"can't use this database"*, or *"Can't connect"*: go
     to step 3.

   Either way, delete the file: `rm .polishd/env.check`.
3. **No database Polishd can use: provision one.** A free Neon database,
   connected to the project, with its variables named for Polishd. Tell the
   user what you're creating (a free Neon database on their Vercel team) and
   go ahead once they confirm. Neon's account comes through their Vercel
   account; there's nothing else to sign up for.

   ```bash
   npx vercel integration add neon --help    # lists the plans: use the free one's ID
   npx vercel integration add neon --name <project>-polishd --billing-plan <free plan ID> \
     --prefix POLISHD_ -e production --no-env-pull
   ```

   - `--prefix POLISHD_` makes the integration set `POLISHD_DATABASE_URL`,
     which is Neon's pooled string, on the project itself, so no secret
     passes through you.
   - `-e production` keeps local dev and preview deployments out of the
     production analytics.
   - `--no-env-pull` stops it overwriting the user's `.env.local`.

   If there's no free plan in the list, stop and ask. The first install on a
   team may need `npx vercel integration accept-terms neon`, which the user
   confirms.
4. **Confirm.** `npx vercel env ls --environment production` now lists
   `POLISHD_DATABASE_URL`. It applies from the next production deployment:
   ask before deploying. Once it's live,
   `npx @polishd/next doctor --url https://<production domain>` should say
   *"Ingest reached the store"*.

## Phase 6b — Describe the site in `polishd.defaults.json`

If `init` didn't write `polishd.defaults.json`, the installed package predates
it: skip to Phase 7.

This file is how the dashboard opens already knowing the site. Everything in
it is a **default**: the environment beats it, and anything the owner saves in
the dashboard beats both. It is committed, so it goes in the setup PR, and it
**never holds a secret** — `doctor` fails a key or token in it, and Polishd
ignores one.

Fill in what the repository tells you. Leave a field blank rather than guess;
the owner can fill it in the dashboard later.

```json
{
  "site": {
    "description": "A personal notes site. Visitors read articles and browse by tag. /admin is owner-only.",
    "audience": "Developers who keep public notes",
    "values": "Fast and quiet: no pop-ups, no dark patterns",
    "sourceDirs": ["app", "components"]
  },
  "github": { "repo": "owner/name" },
  "ai": { "provider": "anthropic", "model": "", "apiKeyEnv": "" }
}
```

| Key | Where to find it |
|---|---|
| `site.description` | One or two sentences: what the site is, what visitors do, which areas are owner-only. Read the README, `package.json`, the root layout's metadata and the top-level routes |
| `site.audience` | Who it's for — only if the README or site copy says |
| `site.values` | What the site stands for (tone, principles, what it refuses to do) — only if it's written down. **Never invent it**; ask the user, or leave it blank |
| `site.sourceDirs` | The folders holding pages and components, from the repo root. Leave it out when they're the usual `src`, `app`, `components`, `pages`, `lib` |
| `github.repo` | `init` reads it from the `origin` remote. Check it |
| `ai.provider`, `ai.model` | Blank means Anthropic and its default model. Set them only if the user names one |
| `ai.apiKeyEnv` | See below |
| `ai.refresh` | `manual` (default), `daily` or `weekly` |
| `fix.auto`, `fix.label`, `fix.dailyCap` | Leave out unless the user asks: they decide what the Fix button may send without asking |

Show the user the filled-in file before it goes in the PR, and let them
correct it.

### The model key

An Anthropic API key can't be created from a command line, only in the
Console (the Admin API can list and deactivate keys, not create them). A
`claude setup-token` token is not a substitute: it is for Claude Code (Phase
6c), not for Polishd's own calls. In order of least effort:

1. **A key the app already has.** If the app already sets a key for a provider
   Polishd supports (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` in
   `.env.example` or the host's settings), ask the user whether Polishd may use
   it: it will spend that key. Only on a yes, set `ai.provider` and
   `"apiKeyEnv": "ANTHROPIC_API_KEY"` (the variable's **name**, never its
   value; only names ending in `_KEY` are read). Nothing else to do.
2. **A new key, stored without passing through you.** Open the key page
   (`open https://platform.claude.com/settings/keys` for Anthropic), let the
   user create and copy a key, then store it from the clipboard, e.g.
   `pbpaste | npx vercel env add POLISHD_AI_API_KEY --environment production --sensitive` on Vercel, and
   `printf 'POLISHD_AI_API_KEY=%s\n' "$(pbpaste)" >> .env.local` for local dev
   (check `.env.local` is gitignored first).
3. **The dashboard.** Skip it here: `/polishd` opens on its first-time setup,
   which asks for the key with the provider and model already filled in.

**Never ask the user to paste a key or token into the chat, and never print,
log or commit one.** The same goes for the GitHub token below.

## Phase 6c — GitHub, and the Fix workflow (optional)

Ask the user whether they want Polishd to file issues on the repository. If
not, skip to Phase 7.

**The token.** GitHub can't mint a fine-grained token from a command line,
but its form takes everything except the repository from the URL. `init`
prints that URL for the repo it found; open it:

```bash
open "https://github.com/settings/personal-access-tokens/new?name=Polishd+owner%2Fname&target_name=owner&expires_in=366&contents=read&issues=write&pull_requests=write"
```

Tell the user the form is filled in, and that they need only choose **Only
select repositories → the repo**, press **Generate token** and copy it. Check
the resource owner shown is the repo's owner before they generate: for an
organization, the form has been reported to show it and still create the
token under the personal account. Then store it as above:
`pbpaste | npx vercel env add POLISHD_GITHUB_TOKEN --environment production --sensitive`, or the user pastes
it in Settings → GitHub.

**The Fix workflow.** Then ask whether they also want the Fix button, which
hands a filed issue to Claude Code running in GitHub Actions and follows it to
a pull request. If the repo already has a workflow using
`anthropics/claude-code-action`, don't add another: the dashboard's Fix card
will read the one there. Otherwise, on a yes:

1. `npx @polishd/next init --fix-workflow` writes
   `.github/workflows/claude.yml`. It goes in the setup PR. Use
   `--fix-workflow=api-key` if the user would rather runs bill an API key than
   their Claude plan.
2. Open `https://github.com/apps/claude/installations/new`. The user picks the
   repository and presses **Install**.
3. The Actions secret. For the default, the user runs `claude setup-token`
   themselves (it signs in through the browser and prints a token), copies
   it, and you store it: `pbpaste | gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo owner/name`.
   With `=api-key`, the secret is `ANTHROPIC_API_KEY`.

Once the PR is merged, the Fix card in Settings runs a live test.

## Phase 7 — Verify

Run all of these. Report the results; do not declare success from the build
alone — most of what can be wrong here builds cleanly and fails silently.

Start with the doctor, which checks the whole wiring in one command:

```bash
npx @polishd/next doctor
```

It verifies that capture and ingest exist, that `runtime` and `dynamic` are
declared rather than re-exported, that the dashboard stylesheet is imported,
that `polishd.defaults.json` is valid, secret-free and imported by the page,
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
filesystems, so there capture only persists once a Postgres URL is set. Phase
6a connects one.

Polishd's tables are `polishd_events` and `polishd_meta`, in the database's
default schema, so they can share the app's database. Before 0.3.2 the events
table was plain `events`; the store renames Polishd's own on the first open,
data and indexes included, and never touches an `events` table of the app's.
If a table by one of Polishd's names isn't Polishd's, the store refuses it
before creating or altering anything, and the dashboard says so.

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
| `POLISHD_AI_*` | no | Preset AI provider/model/key instead of using the dashboard. Beats `polishd.defaults.json`; a saved dashboard value beats both |
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
console warning and no impact on the host app. `/polishd` then shows a setup
screen instead of the dashboard, after its access check, naming what failed
and the steps to fix it. That screen is expected on a fresh serverless deploy
until `POLISHD_DATABASE_URL` is set.

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
| `/polishd` shows "This database is already in use" | Something other than Polishd already has a `polishd_events` or `polishd_meta` table in that database. Polishd refused it and changed nothing | Give Polishd a database of its own (Phase 6a, step 3), then redeploy |
| `/polishd` shows "Connect a database", "Can't reach the database", "Install the Postgres driver" or "Upgrade Node" | No store could be opened; the screen says which and why | Follow its steps: set `POLISHD_DATABASE_URL` (pooled), fix the URL, `npm install pg`, or Node ≥ 22.5. Redeploy after changing the environment |
| Dashboard shows *"they arrive without a session, so none are stored"* | No batch can be minted a session: something in front of the app (CDN, firewall, proxy) strips both `Origin` and `Sec-Fetch-Site`, or a route of the app's own around `ingest()` passes no session id. Red means *nothing is being stored* — with events landing you get a neutral note instead | `doctor --url <origin>`; plain `doctor` only reads the source tree, so it can pass while a deployed site still drops every batch |
| Beacons return 200 but nothing is stored | Same as above — ingest answers `{ok:true,stored:0,reason:"no_session"}` so the client cannot see a failure | `doctor --url http://localhost:3000` |
| `ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite` | Node < 22.5 | Upgrade Node, or configure Postgres |
| `ExperimentalWarning: SQLite is an experimental feature` | Node's own `node:sqlite` module on 22.x | **Expected and harmless.** Not a Polishd instability. Do not "fix" it or switch stores because of it |
| No `polishd_session` cookie on a page request | Expected: the ingest route sets it on the response to the first batch | Nothing to fix. Check step 3 of Phase 7 instead; never add a proxy for it |
| Dashboard content unreachable below the fold | Host `body` doesn't scroll | Fixed by default; if an ancestor sets `transform`/`filter`/`contain`, pass `shell: false` and use a route-group layout (docs/SETUP.md) |
| `doctor`: *"polishd.defaults.json holds a secret"* | A key or token was written into the committed file | Remove it and **rotate it** — it's in git history. Set it in the host's environment instead, or name the app's own variable in `ai.apiKeyEnv` |
| `doctor`: *"page doesn't import polishd.defaults.json"* | A page from before the file existed | `npx @polishd/next init --force` if init wrote the page; otherwise add the import and `createPolishdPage({ defaults })` |
| Edits to `polishd.defaults.json` don't show in the dashboard | A value saved in the dashboard (or set in `POLISHD_AI_*`) is overriding that field | Expected: the file holds defaults. Change it in the dashboard, or unset the variable |
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
| `npx @polishd/next init` | Scaffold. `--dry-run`, `--force`, `--js`, `--config`, `--fix-workflow[=api-key]` |
| `npx @polishd/next doctor` | Check the install. `--url <origin>` adds live checks |
| `npx @polishd/next db check` | Can Polishd use this database? `--env-file <path>`, `--var <NAME>`. Never prints the URL |
