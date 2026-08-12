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
- **Tailwind CSS** (v3 or v4) if you want the dashboard styled. See
  [Styling](#4-styling) — this step is easy to miss.
- **Postgres** for production. Not needed for local development.

## 1. Install

```bash
npm install @polishd/next
```

`pg` comes along as an optional dependency and is only loaded when you point
Polishd at a Postgres URL. You don't need to install it yourself.

## 2. Scaffold

```bash
npx polishd init
```

This detects whether your app uses `src/` or the repo root, writes four files,
adds `.polishd/` to `.gitignore`, and wires Tailwind. Useful flags:

| Flag | Effect |
|---|---|
| `--dry-run` | Print what would happen; write nothing |
| `--force` | Overwrite files that already exist |
| `--js` | Emit JavaScript instead of TypeScript |
| `--config` | Also write a starter `polishd.config.ts` |

If a file already exists, `init` skips it and tells you. For an existing
`middleware.ts` it prints a merge snippet rather than clobbering your code.

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

**Already have a proxy or middleware?** Don't replace it. Thread your response
through instead, and merge the matcher — keeping the `api` exclusion:

```ts
export function proxy(request: NextRequest) {
  const response = myExistingLogic(request);
  return withPolishdSession(request, response);
}
```

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
import { createPolishdPage } from "@polishd/next/dashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default createPolishdPage();
```

Same inline-config rule as the route. **This is unguarded** — see
[Protecting the dashboard](#5-protecting-the-dashboard).

## 4. Styling

The dashboard is built entirely from Tailwind utility classes and ships no
stylesheet of its own. Tailwind has to be told to scan the package — it will not
find it by default. Miss this and `/polishd` loads fine but renders as unstyled
HTML.

**Tailwind v4** (no config file; your CSS starts with `@import "tailwindcss"`):

```css
@import "tailwindcss";
@source "../../node_modules/@polishd/next/dist";
```

The path is relative to the stylesheet. From `src/app/globals.css` that's
`../../`. v4's automatic content detection deliberately skips `node_modules`, so
this line is not optional.

**Tailwind v3** — add the glob to `content` in `tailwind.config.ts`:

```ts
content: [
  "./src/**/*.{ts,tsx}",
  "./node_modules/@polishd/next/dist/**/*.js",
],
```

**Not using Tailwind?** Everything works, but the dashboard will be unstyled.
The colors are self-contained (no dependency on your theme), so adding Tailwind
purely for the dashboard is a reasonable option if you want it to look right.

## 5. Protecting the dashboard

By default `/polishd` is **public**, with a development-only console warning.
Before deploying, gate it:

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

`authenticate` returns a boolean or a promise of one. When it returns false the
`unauthorized` node renders, or a minimal built-in screen if you didn't pass
one. Polishd ships no auth code, so it never pulls an auth library into your
dependency tree.

**This also guards the AI server actions.** That matters more than it might
sound: a Next server action is an independently addressable POST endpoint whose
id ships inside your public client bundle. Gating only the page render would
leave the actions callable by anyone — able to change the configured model and
API base URL, and spend your model tokens. The callback re-runs against the
caller's cookies on every action call.

To stay open locally but protected in production:

```tsx
authenticate: async () =>
  process.env.NODE_ENV !== "production" || (await isAuthenticated()),
```

## 6. Verify it works

```bash
npm run build && npm start
```

Then, in order:

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

Pass the same object to `createPolishdRoute(config)` and `createPolishdProxy(config)`
if you change `apiRoute` or `sessionCookie`, so all three agree.

## Troubleshooting

**Build fails: "can't recognize the exported `runtime` field in route"**
Route segment config was re-exported. Declare `runtime` and `dynamic` inline in
the route and page modules.

**Every `/api/*` route suddenly 404s**
Your proxy matcher is matching `/api`. Restore the `(?!api|...)` exclusion.

**The dashboard is unstyled**
Tailwind isn't scanning the package. See [Styling](#4-styling).

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
