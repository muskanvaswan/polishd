# Setting up Polishd

A complete walkthrough for adding Polishd to a Next.js app — what each piece
does, every variant you might hit, and how to confirm it's working.

If you just want the short version, the [README](../README.md) quickstart is
three commands. If you're an AI coding agent, read [AGENTS.md](../AGENTS.md)
instead.

---

## Requirements

- **Next.js 15 or later**, App Router. There is no Pages Router support.
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

This detects whether your app uses `src/` or the repo root, detects your
installed Next major so the proxy file gets the right name, writes four files,
and adds `.polishd/` to `.gitignore`. Useful flags:

| Flag | Effect |
|---|---|
| `--dry-run` | Print what would happen; write nothing |
| `--force` | Regenerate files `init` itself wrote, backing each up to `.bak` |
| `--js` | Emit JavaScript instead of TypeScript |
| `--config` | Also write a starter `polishd.config.ts` |

**`--force` will never overwrite a file `init` didn't write.** Generated files
carry a marker; anything without one is left alone whether or not you pass the
flag, so re-running is safe even if you've since hand-written a proxy. When it
finds a proxy it didn't author, it prints merge instructions instead — see
[Composing with an existing proxy](#composing-with-an-existing-proxy).

Then check the result:

```bash
npx @polishd/next doctor
```

### Installing with a coding agent

Paste this to Claude Code, Cursor, Copilot, or any other coding agent:

```text
Install @polishd/next into this Next.js app.

Follow the procedure in AGENTS.md from the package exactly — after installing,
read node_modules/@polishd/next/AGENTS.md. If the package isn't installed yet,
read it at https://github.com/muskanvaswan/polishd/blob/main/AGENTS.md

Work through its phases in order and do not skip Phase 7 (verification).
Several of its constraints fail silently at runtime rather than at build time,
so a passing build does not mean the install worked.

Finish by running `npx @polishd/next doctor` and fixing everything it reports.
```

## 3. What the four files do

Paths below assume a `src/` layout; drop the `src/` prefix if your `app/`
directory sits at the repo root.

### `src/proxy.ts` — anonymous sessions

Every visitor gets one httpOnly UUID cookie. No fingerprinting, no PII, so it's
GDPR-safe by construction. The ingest endpoint trusts this cookie as the only
source of session identity — the browser never sends a session id itself.

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

**On Next 15**, name the file `middleware.ts` and the exported function
`middleware`. Everything else is identical.

> **The matcher is load-bearing.** Next parses `config.matcher` statically, so
> it has to be an inline literal in this file — it cannot be imported from the
> package. And it must exclude all of `/api`: under Next 16 with Turbopack, a
> proxy matcher that touches any `/api/*` route breaks route resolution for the
> entire `/api` segment. The proxy's only job is setting a cookie, which page
> navigations already trigger.

### Composing with an existing proxy

**Already have a proxy or middleware?** Don't replace it — Next loads exactly
one such module, so Polishd has to go inside yours.

Threading the response is the easy half:

```ts
export function proxy(request: NextRequest) {
  const response = myExistingLogic(request);
  return withPolishdSession(request, response);
}
```

A redirect or rewrite you return keeps working and carries the analytics cookie.

The hard half is the matcher, and it's easy to miss. One file means one
`config.matcher`, so merging means widening it to the union of both — and
Polishd's matcher is near-total. A handler you deliberately scoped to two routes
now runs on **every request in the app**. Nothing errors. Your redirects just
start firing where they never did before.

`composePolishd` fixes that if you tell it the original scope:

```ts
import { composePolishd } from "@polishd/next/proxy";

function myProxy(request: NextRequest) {
  if (!hasSession(request)) return NextResponse.redirect(new URL("/login", request.url));
}

// Still runs only on /admin/*, even though the matcher below is near-total.
export const proxy = composePolishd(myProxy, { matcher: "/admin/:path*" });

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon|assets).*)"],
};
```

Read your existing `config.matcher` before replacing it and pass exactly that
value. `matcher` takes Next's matcher strings (`"/admin/:path*"`,
`"/((?!api).*)"`) or a `RegExp` for full control. Omit it only if your handler
really did run everywhere.

Widening is safe from Polishd's side: `withPolishdSession` returns early once
the cookie exists, so the extra paths cost a cookie lookup and nothing more.

The union literal still has to be written by hand — Next parses it statically,
so no helper can generate it.

### `src/instrumentation-client.ts` — capture

Next runs this before hydration, so capture starts on the first paint.

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

export default createPolishdPage();
```

Same inline-config rule as the route. In production this refuses to render
until you decide how it is protected — see
[Protecting the dashboard](#5-protecting-the-dashboard).

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

The `@source "…/node_modules/@polishd/next/dist"` line in your Tailwind entry
stylesheet (or the `content` glob in `tailwind.config.*`) is now obsolete. It
still works, so nothing breaks — but you can delete it and stop compiling
utilities you no longer use. `npx @polishd/next doctor` flags it if it finds one.

Add the stylesheet import to your dashboard page; that is the only required
change.

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

It catches the failures that produce no error: a proxy named for the wrong Next
major, `config.matcher` that isn't an inline literal, route segment config
re-exported rather than declared, the dashboard stylesheet not imported, and events
being dropped for want of a session cookie.

By hand:

1. **Cookie.** `curl -sI http://localhost:3000/ | grep -i set-cookie` should
   show `polishd_session=<uuid>` with `HttpOnly`.
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

> **This file is not loaded for you.** It can't be: the three places that read
> config run in three different runtimes — the browser, the Edge proxy, and the
> Node route handler — and the Edge one has no filesystem to read it from.

So pass the same object to all three:

```ts
initPolishd(config);                             // instrumentation-client.ts
export const POST = createPolishdRoute(config);  // app/api/polishd/route.ts
const { proxy } = createPolishdProxy(config);    // proxy.ts
```

Thread it into one but not another and they disagree silently. A proxy minting
cookie `a` while ingest reads `b` produces exactly the "beacons return 200,
dashboard stays empty" failure below.

For `sessionCookie` specifically, use the environment variable instead — it's
the one channel all three runtimes can read, so it can't go half-applied:

```bash
POLISHD_SESSION_COOKIE=my_session
```

## Troubleshooting

Try `npx @polishd/next doctor` first — it names most of what follows directly,
and `--url http://localhost:3000` checks the live path as well.

**Beacons return 200 but the dashboard stays empty**
The commonest failure, and the quietest. Ingest deliberately answers a missing
session cookie with `{"ok":true,"stored":0,"reason":"no_session"}` so beacons
never retry, and `sendBeacon` can't read a response anyway — so nothing in the
browser can tell you. The dashboard shows a banner when it detects this, and the
dev console warns on the first flush. Causes, in order of likelihood: the proxy
file is named for the wrong Next major; its matcher doesn't cover the pages
you're visiting; a merge with an existing proxy went wrong; or the proxy and the
route disagree about the cookie name (set `POLISHD_SESSION_COOKIE`).

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
Your proxy matcher is matching `/api`. Restore the `(?!api|...)` exclusion.

**The dashboard is unstyled**
The page is missing `import "@polishd/next/dashboard.css";`. See [Styling](#4-styling).

**`ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite`**
Node is older than 22.5. Upgrade, or configure Postgres.

**No `polishd_session` cookie**
The proxy file is missing or misnamed — `proxy.ts` on Next 16, `middleware.ts`
on Next 15 — or its matcher excludes the path you're testing.

**Dashboard is empty but the app works**
Expected before any events flush. If it persists, check the browser console for
failed requests to `/api/polishd`, and confirm the route file exists.

**Events stop after a deploy**
Almost always a missing or unreachable `POLISHD_DATABASE_URL`. The store latches
to a no-op and logs a warning on the server rather than failing requests.
