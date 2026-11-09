# Setting up Polishd

A complete walkthrough for adding Polishd to a Next.js app — what each piece
does, every variant you might hit, and how to confirm it's working.

If you just want the short version, the [README](../README.md) quickstart is
three commands. If you're an AI coding agent, read [AGENTS.md](../AGENTS.md)
instead.

---

## Requirements

- **Next.js 15.3 or later**, App Router. Earlier versions ignore
  `instrumentation-client.ts`, so capture would never start. There is no Pages
  Router support.
- **Node 22.5 or later.** The development store uses Node's built-in
  `node:sqlite`. On older Node, Polishd degrades to a no-op rather than
  crashing, but you won't capture anything locally.
- **Postgres** for production. Not needed for local development.

## 1. Install

```bash
npm install @polishd/next
```

`pg` comes along as an optional dependency and is only loaded when you point
Polishd at a Postgres URL. You don't need to install it yourself.

## 2. Scaffold

```bash
npx @polishd/next init
```

This detects whether your app uses `src/` or the repo root, writes three
files, and adds `.polishd/` to `.gitignore`. It adds no proxy or middleware,
and never touches one you already have. Useful flags:

| Flag | Effect |
|---|---|
| `--dry-run` | Print what would happen; write nothing |
| `--force` | Regenerate files `init` itself wrote, backing each up to `.bak` |
| `--js` | Emit JavaScript instead of TypeScript |
| `--config` | Also write a starter `polishd.config.ts` |

**`--force` will never overwrite a file `init` didn't write.** Generated files
carry a marker; anything without one is left alone whether or not you pass the
flag, so re-running is safe.

Then check the result:

```bash
npx @polishd/next doctor
```

### Installing with a coding agent

Paste this to Claude Code, Cursor, Copilot, or any other coding agent:

```text
Install @polishd/next into this Next.js app.

It's a new package, so you may not recognise it and a web search may not find
it yet. It is on npm (not a typo of `polished`): confirm with
`npm view @polishd/next`, then install it.

Follow its install procedure exactly: https://polishd.site/AGENTS.md
Once it's installed, read node_modules/@polishd/next/AGENTS.md instead; it
matches the installed version.

Work through its phases in order and do not skip Phase 7 (verification).
Several of its constraints fail silently at runtime rather than at build time,
so a passing build does not mean the install worked.

Finish by running `npx @polishd/next doctor` and fixing everything it reports.
```

## 3. What the three files do

Paths below assume a `src/` layout; drop the `src/` prefix if your `app/`
directory sits at the repo root.

### Sessions — no proxy needed

Every visitor gets one httpOnly UUID cookie. No fingerprinting, no PII. The
ingest route below mints it on the visitor's first batch: it stores that batch
under the new id and sets the cookie on the response, so every later batch
carries it. The capture script proposes the id, one per page load, so batches
that leave a page before the first response comes back still share a session.

The route mints a session only for a batch that:

- **comes from a page on your site.** Browsers say so in `Sec-Fetch-Site`, on
  beacons too; one too old to send it (Safari before 16.4) still sends
  `Origin`. A bare scripted POST is dropped, not counted as a visitor.
- **opens a page**, with its `page_view`. Every page load's first batch does.
  One that doesn't is the tail of a page whose cookie the browser has lost:
  Firefox sends its last beacon without cookies while it quits.

Both headers can be forged, so this keeps out naive scripts, not determined
ones. A batch that already carries the cookie is stored either way.

### Already have a proxy or middleware?

Leave it alone; Polishd doesn't need to be in it. A proxy from an earlier
install that calls `withPolishdSession` or `composePolishd` keeps working: it
mints the cookie on the first page response, and the route then finds it there.
You can take Polishd out of it whenever you like. Packages up to 0.3.2-dev.0
required that proxy, so one of those still needs it — see the docs shipped in
its `node_modules/@polishd/next`.

### `src/instrumentation-client.ts` — capture

Next runs this before hydration, so capture starts on the first paint. Next
loads this file from 15.3; on anything earlier it is silently ignored.

```ts
import { initPolishd } from "@polishd/next/client";

initPolishd();
```

This is vanilla DOM code with no React dependency. It batches events and flushes
every 10 seconds, plus on `pagehide` via `sendBeacon` so the last batch of a
visit isn't lost.

### `src/app/api/polishd/route.ts` — ingest

```ts
import { createPolishdRoute } from "@polishd/next/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = createPolishdRoute();
```

> **`runtime` and `dynamic` must be declared here, inline.** Next parses route
> segment config statically, so re-exporting them from the package
> (`export { POST, runtime, dynamic } from "@polishd/next/route"`) fails the
> build. `nodejs` is required because the store uses `node:sqlite`/`pg`, neither
> of which runs on the Edge runtime.

### `src/app/polishd/page.tsx` — the dashboard

```tsx
import "@polishd/next/dashboard.css";
import { createPolishdPage } from "@polishd/next/dashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Server actions inherit this page's time limit; 300s gives the AI
// analyses headroom on hosts with strict function limits.
export const maxDuration = 300;

export default createPolishdPage();
```

Same inline-config rule as the route. In production this refuses to render
until you decide how it is protected — see
[Protecting the dashboard](#5-protecting-the-dashboard).

`init` also writes `export { metadata } from "@polishd/next/dashboard";` into
the page. That is the dashboard's own metadata, `robots: noindex` included;
without it `/polishd` takes your app's metadata and search engines may index
it.

### With `cacheComponents`

If your `next.config` sets `cacheComponents: true`, Next rejects `runtime` and
`dynamic` in the route and the page, and prerendering `/polishd` fails unless
the dashboard renders inside `<Suspense>`, because it reads cookies on every
request. `init` reads your config and writes both files to suit: no `runtime`
or `dynamic` (Node is already the runtime and nothing here is cached), and

```tsx
export default createPolishdPage({ suspense: true });
```

`doctor` checks the same way round.

### The dashboard's own shell

The dashboard is a route in *your* app, so it inherits your `<body>`. That
matters when your body doesn't scroll — the default shape of every dashboard
shell, chat UI, editor, and map app, all of which set `overflow: hidden` on
body and scroll their own inner regions.

By default Polishd renders into a self-contained shell (`position: fixed`, its
own background and scroll container) so host body styles can't strand content
below the fold. Opt out to inherit your page instead:

```tsx
export default createPolishdPage({ shell: false });
```

**If the dashboard still looks cut off**, an ancestor is establishing a
containing block — `transform`, `filter`, `contain`, or `will-change` on
anything above the route defeats `position: fixed`. Rare this close to the
root. The complete escape is a second root layout via a route group, which
gives the dashboard its own `<html>`/`<body>` and total isolation from your
global CSS:

```
app/
  (site)/layout.tsx      ← your existing root layout, moved into a group
  (polishd)/
    layout.tsx           ← renders its own <html> and <body>
    polishd/page.tsx
```

This is the nuclear option, and it has real costs: you must move your own root
layout into a group, and navigation between the two roots forces a full page
reload. Reach for it only for a host with genuinely hostile global CSS.

## 4. Styling

The dashboard ships its own stylesheet, compiled at publish time. One import,
which `init` writes for you:

```tsx
// app/polishd/page.tsx
import "@polishd/next/dashboard.css";
```

**Tailwind is not required in your app.** The dashboard renders identically
whether or not you use it, and whichever version you use.

The stylesheet is built so it cannot interfere with the app it lands in, and so
the app cannot interfere with it:

- **No global preflight.** Tailwind's reset is the part that restyles every
  element on a page, and it is deliberately left out. A scoped equivalent covers
  the dashboard's own subtree instead, so your headings, lists, buttons and form
  controls are untouched.
- **Every rule is scoped to `.polishd-root`**, checked at build time — no
  selector in the file can match your markup.
- **The scope is written twice** (`.polishd-root.polishd-root`) so the dashboard
  wins specificity ties. Tailwind class names are a global namespace: a host with
  its own `.flex` or `.hidden` would otherwise style the dashboard's markup, and
  which one won would depend on stylesheet order.
- **No cascade layers.** Unlayered CSS beats layered CSS outright regardless of
  specificity, so a plain `h1 { color: … }` in your app would override the
  dashboard's typography if its utilities stayed in `@layer utilities`.
- **An explicit font stack**, rather than inheriting yours — with no global
  preflight, inheriting would land on the browser default and render the whole
  dashboard in serif.

The one thing it cannot win is a host `!important` rule targeting the same
property. Nothing short of `!important` on our side would, and a package
shouting over its host is worse than a rare collision. If you hit one, the
route-group layout in [The dashboard's own shell](#the-dashboards-own-shell)
isolates the dashboard completely.

### Upgrading from 0.1.x

Upgrade, then remove the `@source "…/node_modules/@polishd/next/dist"` line (or
the `content` glob in `tailwind.config.*`).

From 0.2.3-dev.23 the dashboard imports its own stylesheet, so it renders with
the Polishd palette whether or not your page imports it. The old scan line was
never quite right: it compiles the dashboard's class names against *your*
Tailwind theme, which has no `line`, `surface` or `fg-3`, so borders fall back
to your default border colour and the greys vanish. The shipped stylesheet now
outranks that output, so the line is only wasted build work — but remove it.
`npx @polishd/next doctor` flags it if it's still there.

## 5. Protecting the dashboard

The dashboard is not a read-only report: its settings change the configured
model and **API base URL**, so whoever can reach it can point your requests at
their own endpoint and spend your key.

Locally it is open, with one console warning. **In production it refuses to
render** until you've chosen one of three options.

### Option 1 — the built-in token (no auth of your own required)

```bash
POLISHD_DASHBOARD_TOKEN=$(openssl rand -hex 32)
```

That's the whole setup. The locked screen shows a password field, and the token
is exchanged for an httpOnly, path-scoped cookie by a server action — so it
never appears in a URL, in browser history, in server logs, or in a `Referer`
header. The cookie carries an HMAC of the token rather than the token itself,
comparison is constant-time, expiry is enforced server-side, and the unlock form
is rate-limited per IP.

If your dashboard isn't at `/polishd`, say so, since that's what scopes the
cookie:

```tsx
import { createPolishdPage, polishdTokenAuth } from "@polishd/next/dashboard";

export default createPolishdPage({
  authenticate: polishdTokenAuth({
    basePath: "/admin/polishd",
    maxAgeSeconds: 60 * 60 * 24,   // default is one week
  }),
});
```

### Option 2 — your app's own auth

```tsx
import { createPolishdPage } from "@polishd/next/dashboard";
import { isAuthenticated } from "@/lib/auth";
import { MyLogin } from "./login";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default createPolishdPage({
  authenticate: isAuthenticated,
  unauthorized: <MyLogin />,
});
```

`authenticate` returns a boolean or a promise of one, and receives the request's
`cookies` and `headers`:

```tsx
authenticate: (ctx) => ctx.cookies.get("admin_session")?.value === expected,
```

Taking them as arguments rather than calling `cookies()` inside means the
callback is testable without standing up a request. A zero-argument callback
still works unchanged. When it returns false the `unauthorized` node renders, or
a minimal built-in screen if you didn't pass one. Polishd ships no auth library,
so it never pulls one into your dependency tree.

### Option 3 — public on purpose

```bash
POLISHD_DASHBOARD_PUBLIC=true
```

An explicit opt-in, greppable in your deployment config. You'll still get one
warning per boot in production, because that's the only place it's actionable.

### Why this is stricter than it looks

**The gate covers the AI server actions, not just the page.** A Next server
action is an independently addressable POST endpoint whose id ships inside your
public client bundle. Gating only the page render would leave the actions
callable by anyone — able to change the configured model and API base URL, and
spend your model tokens. Your check re-runs against the caller's cookies on
every action call.

That's also why production fails shut at the *policy* level rather than merely
rendering a locked page: a page that showed a lock while still registering
"open" would leave every action reachable behind a locked-looking door.

One consequence worth knowing: if you delete `app/polishd/page.tsx` but keep the
package installed, the actions remain routable and always deny. That's correct,
but the symptom — actions failing with an opaque digest — is puzzling if you
meet it cold.

## 6. Verify it works

```bash
npm run build && npm start
```

Then, in order:

The fastest check is the doctor, which inspects the whole wiring and, with
`--url`, confirms the live path too:

```bash
npx @polishd/next doctor --url http://localhost:3000
```

It catches the failures that produce no error: route segment config
re-exported rather than declared, capture or ingest missing, the dashboard
stylesheet not imported, and events being dropped for want of a session.

By hand:

1. **Cookie.** A probe from a page on the site is minted one (and stores no
   event):

   ```bash
   curl -si -X POST http://localhost:3000/api/polishd \
     -H 'content-type: application/json' -H 'origin: http://localhost:3000' \
     -d '{"probe":true,"events":[]}' | grep -i -E 'set-cookie|reason'
   ```

   It should show `polishd_session=<uuid>` with `HttpOnly`, then
   `"reason":"probe"`. A plain page request sets no cookie; that's expected.
2. **Dashboard.** Visit `/polishd` — expect HTTP 200, styled, with a "no events
   yet" state.
3. **Capture.** Click around your app, then reload the dashboard. Events flush
   every 10 seconds and on page hide, so give it a moment.
4. **Store.** In development, `.polishd/analytics.db` should exist. That file
   appearing is proof the whole write path works.

If the dashboard shows a notice about the store being unavailable, capture is
disabled — check Node ≥ 22.5 locally, or your database URL in production.

## 7. Deploying

Serverless hosts run on a read-only, ephemeral filesystem, so the development
SQLite file cannot persist there. Production capture needs Postgres.

1. Provision a database (Neon, Vercel Postgres, Supabase, RDS).
2. Set `POLISHD_DATABASE_URL` to the **pooled** connection string.
3. Set your host's Node version to 22.x or later.
4. Deploy. Tables are created automatically on first use.

Every event is stamped with the **build** it was captured on, so the Analytics
tab can scope its figures to a deploy and the Design tab knows which scans
describe the site as it ships now. On Vercel this is automatic (the public
commit variable is read). Elsewhere, set `NEXT_PUBLIC_POLISHD_BUILD` in the
build command so the bundle knows its own build:

```bash
NEXT_PUBLIC_POLISHD_BUILD=$COMMIT_REF next build    # Netlify; use your host's commit variable
```

Without it the server stamps its own commit variable where the host sets one
(`VERCEL_GIT_COMMIT_SHA`, `COMMIT_REF`, `CF_PAGES_COMMIT_SHA`, …), and in
development the checked-out commit. See the README's
[Builds](../README.md#builds).

For **site snapshots** in production on Vercel, connect a
[Blob store](https://vercel.com/docs/vercel-blob). Whichever variable the
connection injects switches image storage over automatically: `BLOB_STORE_ID`
(OIDC) or `BLOB_READ_WRITE_TOKEN`. `BLOB_WEBHOOK_PUBLIC_KEY` isn't needed, and
public and private stores both work. A self-hosted server with a writable disk
needs nothing. Nothing else is needed either: no `next.config` changes and no
browser in your deployment. In production the shots are taken by Polishd's
screenshot service, which the dashboard calls from your browser. **Page URLs
and pixels pass through that service.** It shoots only your site's public
pages and stores nothing. The first time you press Capture, a dialog asks you
once before it's ever used; if you decline, or there's no Blob store, the
section moves to the bottom of the tab, turned off, and says why. See the README's
[Site snapshots](../README.md#site-snapshots) for what the service does and
doesn't do. If your site sets a Content-Security-Policy, add
`https://shots.polishd.muskanvaswan.xyz` and `https://vercel.com` to
`connect-src`. `POLISHD_SNAPSHOT_SERVICE=off` stops the service from ever
being called; snapshots are then taken only in local development.

See [DATABASE.md](../DATABASE.md) for schema, pooling notes, and retention.

Until a database URL is set, Polishd runs as a safe no-op in production: a
console warning, a notice on the dashboard, and zero impact on your app. It is
designed never to be the reason your site goes down.

## 8. Optional — component-level tracking

Wrap anything you want attributed by name rather than by CSS selector:

```tsx
import { PolishdMonitor } from "@polishd/next/client";

<PolishdMonitor name="checkout-button">
  <CheckoutButton />
</PolishdMonitor>

<PolishdMonitor name={slug} content className="block">
  <Article />
</PolishdMonitor>
```

Interactive controls get hover and click attribution. Adding `content` also
measures viewport time, scroll depth, and rendered size — meant for articles and
regions rather than buttons.

## 9. Optional — configuration

Defaults suit a low-traffic site. To change them:

```ts
// polishd.config.ts
import { definePolishdConfig } from "@polishd/next";

export default definePolishdConfig({
  sampleRate: 1,                              // fraction of sessions captured
  rageClick: { count: 3, windowMs: 500 },     // N clicks on one element
  flushIntervalMs: 10_000,
  dashboardRoute: "/polishd",                 // never captured; see below
  build: process.env.NEXT_PUBLIC_POLISHD_BUILD, // the default; any label works
});
```

The dashboard's own traffic is **never captured**. Reading your analytics is
browsing too, and left alone it would rank "Refresh summary" as your site's
most-used feature. Nothing on `dashboardRoute` (or below it) is collected, and
anything captured before you upgraded is filtered out of the dashboard's
figures. Set `dashboardRoute` only if you mounted `createPolishdPage()`
somewhere other than `/polishd` — and pass the config to
`createPolishdRoute(config)` as well, so the server drops it too.

```ts
// src/instrumentation-client.ts
import { initPolishd } from "@polishd/next/client";
import config from "../polishd.config";

initPolishd(config);
```

> **This file is not loaded for you.** It can't be: the places that read
> config run in different runtimes — the browser and the Node route handler.

So pass the same object to both:

```ts
initPolishd(config);                             // instrumentation-client.ts
export const POST = createPolishdRoute(config);  // app/api/polishd/route.ts
```

Thread it into one but not the other and they disagree silently: the client
posting to one route while the handler listens on another, or the dashboard's
own traffic dropped on one side only.

For `sessionCookie` specifically, use the environment variable instead — every
runtime can read it, a proxy of yours included, so it can't go half-applied:

```bash
POLISHD_SESSION_COOKIE=my_session
```

## 10. Optional — connect a coding agent

Once a GitHub repository is connected (Settings → GitHub), the Settings tab
ends with a **Fix dispatch** card, and once it says Ready, each filed issue on
the Actionables tab offers **Create fix**: polishd asks the coding agent the
repo already runs — the Claude Code GitHub Action first, Copilot's coding
agent second — to scope the issue, confirm it's real and fixable, and open a
pull request linked to it, then follows it there. The card checks what the
repo has and how a fix starts there, helps you set an agent up, proves the
wiring with a live test, and keeps your choices about what may be sent
without asking.

How a fix starts depends on the workflow's `on:` block:

| The workflow hears | A fix starts | On the Actionables tab |
|---|---|---|
| `issue_comment` (the stock workflow) | after filing, with a comment | **Create fix** on any filed, open issue |
| `issues: opened` only | as the issue is filed — the brief goes in its body | **File and fix** beside File bug |
| new issues, with a `prompt` input (automation mode) | on every filing, whatever polishd does | File bug says it starts the agent |
| — (Copilot's coding agent) | after filing, with a comment and an assignment | **Create fix** |

The agent works on GitHub whether or not the dashboard is open, and the tab
reads where it got to whenever you open it or an issue. The Action pushes a
branch and leaves a "Create PR" link rather than opening a pull request, so
once that link appears the actionable offers **Create PR**, which opens the
pull request from the branch with `Fixes #N` so it's linked to the issue; an
agent's own pull request missing the closing keyword gets **Link PR** instead.
Nothing is written to a pull request without that click. Pull requests and
activity on every filed issue show on the tab whoever opened them.

**Re-check** reads the workflows on the default branch with the token you
already gave it (no Actions, Secrets or Administration permission is asked
for) and shows: the agent found, how it fires, the trigger phrase, the billing
path, your access, and what can't be read. **Send test issue** files an issue
titled "polishd dispatch test", waits up to three minutes for the agent's
reply, and closes it either way with a comment.

If nothing is found, the checklist on the card is, least effort first:

1. **With Claude Code:** run `claude` in a terminal, in the repo, then
   `/install-github-app` there — it is a Claude Code terminal command, not
   something the dashboard or desktop app can run. It installs the GitHub App, adds the secret and opens a pull request with
   the workflow. Merge it — GitHub runs issue-event workflows only from the
   default branch — then press Re-check.
2. **Otherwise, three links.**
   - Install the Claude GitHub App on the repository:
     <https://github.com/apps/claude/installations/new>.
   - Add one repository secret. Pick how runs are billed:

     | Choice | Secret name | Made with | Cost |
     |---|---|---|---|
     | Subscription token | `CLAUDE_CODE_OAUTH_TOKEN` | `claude setup-token` | draws on your Claude plan's usage limits |
     | API key | `ANTHROPIC_API_KEY` | the Anthropic Console | metered API usage, covered by a Max or Team plan's monthly credit when your Console organization is linked |

   - Add the workflow. The card's **Create .github/workflows/claude.yml on
     GitHub** button opens GitHub's new-file editor with polishd's recommended
     workflow already in it — the stock example from
     `anthropics/claude-code-action`: issues `opened` and `assigned`,
     `issue_comment` and `pull_request_review_comment` `created`,
     `pull_request_review` `submitted`, the `@claude` `if:` condition,
     `actions/checkout@v6` with `fetch-depth: 1`, `anthropics/claude-code-action@v1`,
     the secret line matching your radio choice, and `--max-turns` in
     `claude_args`. Press Commit there. **Copy workflow** gives the same text
     for any other route.
3. **Or Copilot:** turn on the Copilot coding agent in the repository's
   Copilot settings and polishd assigns issues to it instead.

polishd never writes a workflow file itself — that needs a Workflows (write)
permission its token doesn't have — and the only thing it writes to the
repository from this card is the test issue.

The card's editable fields are saved with the rest of the settings: send
fixes automatically (off — when on, an issue the source confirmed is sent as
soon as it's filed), the label on dispatched issues (`polishd-fix`), a daily
cap (5, counting every fix sent) and a pause switch that stops Create fix too.
Fixes need no token permissions beyond the Issues and Pull requests (write)
the connection already has.

## Troubleshooting

Try `npx @polishd/next doctor` first — it names most of what follows directly,
and `--url http://localhost:3000` checks the live path as well.

**Beacons return 200 but the dashboard stays empty**
The commonest failure, and the quietest. Ingest deliberately answers a missing
session cookie with `{"ok":true,"stored":0,"reason":"no_session"}` so beacons
never retry, and `sendBeacon` can't read a response anyway — so nothing in the
browser can tell you. The dashboard shows a banner when it detects this, and the
dev console warns on the first flush. The route mints a session for a page's
first batch, so this means it can't: something in front of your app (a CDN,
firewall or proxy) strips both the `Origin` and `Sec-Fetch-Site` headers it
reads, or a route of your own around `ingest()` passes no session id. On a
package up to 0.3.2-dev.0, it means the proxy that minted the cookie then isn't
running.

**Build fails: "can't recognize the exported `runtime` field in route"**
Route segment config was re-exported. Declare `runtime` and `dynamic` inline in
the route and page modules.

**`ExperimentalWarning: SQLite is an experimental feature and might change at
any time`**
Expected and harmless. That's Node warning about its own built-in `node:sqlite`
module, which the dev store uses — it isn't a sign Polishd is unstable, and it
doesn't appear in production, where Postgres is used instead. Nothing to fix.

**The dashboard is cut off — content below the fold is unreachable**
Your `<body>` doesn't scroll (`overflow: hidden`), which is normal for app
shells. Polishd renders into its own fixed, scrolling container by default, so
this should be handled; if it persists, an ancestor with `transform`, `filter`,
`contain` or `will-change` is defeating `position: fixed`. See
[The dashboard's own shell](#the-dashboards-own-shell).

**Every `/api/*` route suddenly 404s**
A proxy of yours has a matcher that touches `/api`, which under Next 16 with
Turbopack breaks route resolution for the whole segment. Exclude `/api` from
it.

**The dashboard has white borders and no greys, or is unstyled**
The package predates 0.2.3-dev.23, which made the dashboard load its own
stylesheet, and the page doesn't import `@polishd/next/dashboard.css`. Upgrade.
See [Styling](#4-styling).

**`ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite`**
Node is older than 22.5. Upgrade, or configure Postgres.

**No `polishd_session` cookie**
Expected on a page request: the cookie arrives with the response to the first
batch, not with the page. If no batch gets one either, see "Beacons return 200
but the dashboard stays empty" above.

**Dashboard is empty but the app works**
Expected before any events flush. If it persists, check the browser console for
failed requests to `/api/polishd`, and confirm the route file exists.

**Events stop after a deploy**
Almost always a missing or unreachable `POLISHD_DATABASE_URL`. The store latches
to a no-op and logs a warning on the server rather than failing requests.
