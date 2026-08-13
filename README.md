# @polishd/next

> **What gets measured gets improved.**

Drop-in **product analytics** for Next.js (App Router). Capture real user
behavioral signals — rage clicks, dead clicks, scroll depth, JS errors, web
vitals, component engagement — and explore them on a built-in, Vercel-style
dashboard at `/polishd`. A second **Design** tab reverse-engineers your site's
design system from the rendered pages — typography, palette, radii, spacing —
and flags what breaks it.

No third-party service. Events go to your own database: **SQLite in dev**
(zero-config, built into Node), **Postgres in production**. Anonymous by design —
one httpOnly UUID cookie per session, no fingerprinting, no PII.

---

## Installing with a coding agent

Polishd ships a machine-readable install procedure. If you use Claude Code,
Cursor, Copilot, or any other coding agent, **paste this prompt** and let it do
the whole install:

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

`npx @polishd/next doctor` is the ground truth: it checks the wiring that fails
quietly — the proxy named for the wrong Next major, route segment config
re-exported instead of declared, a matcher that isn't an inline literal, the
dashboard stylesheet not imported. Add `--url http://localhost:3000` to also
verify live that the session cookie is minted and events actually store.

## Documentation

| | |
|---|---|
| **[docs/SETUP.md](./docs/SETUP.md)** | Full walkthrough — every variant, verification, troubleshooting |
| **[AGENTS.md](./AGENTS.md)** | Install procedure written for AI coding agents |
| **[DATABASE.md](./DATABASE.md)** | Production database setup, schema, retention |
| **[CHANGELOG.md](./CHANGELOG.md)** | Release notes — **start here if you're upgrading from 0.1.x** |

## Requirements

- Next.js **15+**, App Router (no Pages Router support)
- Node **22.5+** (the dev store uses the built-in `node:sqlite`)
- Postgres in production; nothing extra for local development

## Quickstart

```bash
npm install @polishd/next
npx @polishd/next init
npm run dev                  # then visit /polishd
npx @polishd/next doctor     # confirm the wiring
```

(`npx polishd init` is the shorter form once the package is installed;
`npx @polishd/next init` also works before it is.)

That's it locally — events write to `.polishd/analytics.db` with no
configuration. `init` detects your layout (`src/` or root), detects your
installed Next major to name the proxy file correctly, writes the four files
below, and adds `.polishd/` to `.gitignore`.

Files it already wrote are skipped unless you pass `--force`, which backs them
up to `.bak` first. **Files it did not write are never overwritten**, with or
without `--force` — if you already have a proxy, it prints how to merge instead
of clobbering your code. Other flags: `--dry-run` to preview, `--js` for
JavaScript, `--config` to also emit a `polishd.config.ts`.

`pg` installs automatically as an optional dependency and is loaded only when
you point Polishd at a Postgres URL.

## What gets wired up

```ts
// src/proxy.ts        (middleware.ts on Next 15) — sets the session cookie
import type { NextRequest } from "next/server";
import { withPolishdSession } from "@polishd/next/proxy";

export function proxy(request: NextRequest) {
  return withPolishdSession(request);
}
// Must be an inline literal — Next can't import config.matcher.
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon|assets).*)"],
};

// src/instrumentation-client.ts — starts capture before hydration
import { initPolishd } from "@polishd/next/client";
initPolishd();

// src/app/api/polishd/route.ts — the ingest endpoint
import { createPolishdRoute } from "@polishd/next/route";
export const runtime = "nodejs";        // must be declared here, not re-exported
export const dynamic = "force-dynamic";
export const POST = createPolishdRoute();

// src/app/polishd/page.tsx — the dashboard
import "@polishd/next/dashboard.css";   // self-contained; no Tailwind needed
import { createPolishdPage } from "@polishd/next/dashboard";
export const runtime = "nodejs";       // Next requires these inline in the page
export const dynamic = "force-dynamic";
export default createPolishdPage();    // see Protecting the dashboard
```

> **Route segment config can't be re-exported.** Next statically parses
> `runtime` and `dynamic`, so `export { POST, runtime, dynamic } from
> "@polishd/next/route"` fails the build — declare them inline as above. The same
> applies to the dashboard page.

> **Get the matcher right.** Next statically parses `config.matcher`, so it must
> be an inline literal in your proxy file — it can't be imported. `npx @polishd/next
> init` writes the correct one for you. Excluding all of `/api` is load-bearing:
> under Next 16 + Turbopack, a proxy matcher that touches any `/api/*` route
> breaks resolution for the entire `/api` segment.

## Composing with an existing proxy

Next allows exactly **one** proxy module per app (`proxy.ts` on Next 16+,
`middleware.ts` on Next 15), so if you already have one, Polishd has to go
inside it. `init` detects this and prints instructions rather than overwriting.

The subtle part is the matcher. One file means one `config.matcher`, so adding
Polishd means widening it to the union — and Polishd's matcher is near-total.
Your handler, which you deliberately scoped to a couple of routes, would
silently start running on every request in the app. Nothing errors; your
redirects and rewrites just begin firing where they never did before.

Declare your original scope and `composePolishd` re-applies it as an internal
guard:

```ts
// proxy.ts        (middleware.ts on Next 15, with the function named `middleware`)
import { composePolishd } from "@polishd/next/proxy";
import type { NextRequest } from "next/server";

function myProxy(request: NextRequest) {
  if (!hasSession(request)) return NextResponse.redirect(new URL("/login", request.url));
}

// Your handler still only runs on /admin/*, even though the matcher below
// now feeds Polishd every page request.
export const proxy = composePolishd(myProxy, { matcher: "/admin/:path*" });

// Written by hand: Next statically parses this and it must be an inline
// literal, so no helper can generate it. The union of your paths and Polishd's.
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon|assets).*)"],
};
```

Your handler runs first and its response is threaded through, so a redirect or
rewrite you return **carries the analytics cookie** rather than losing it.
Returning nothing is fine. `matcher` accepts Next's matcher strings
(`"/admin/:path*"`, `"/((?!api).*)"`) or a `RegExp` when you want to be exact;
omit it only if your handler genuinely did run on everything.

Widening the matcher is safe from Polishd's side: `withPolishdSession` returns
early once the cookie is present, so the extra paths cost a cookie lookup and
nothing else.

## Styling

The dashboard ships its own stylesheet. One import, no configuration:

```tsx
// app/polishd/page.tsx — `init` writes this for you
import "@polishd/next/dashboard.css";
```

**Tailwind is not required in your app.** The stylesheet is compiled at publish
time, so it doesn't depend on your build setup, your Tailwind version, or
whether you use Tailwind at all.

It is built not to interfere with the app it lands in:

- **No global preflight.** Tailwind's reset is what would restyle every element
  on your page; it's left out. A scoped equivalent applies to the dashboard's
  own subtree instead, so your headings, lists and buttons are untouched.
- **Every rule is scoped to `.polishd-root`**, verified at build time — nothing
  in the file can match your markup.
- **The scope is doubled (`.polishd-root.polishd-root`)** so the dashboard wins
  specificity ties against a host that happens to have its own `.flex`,
  `.hidden` or `.container`, rather than the winner depending on stylesheet
  order.
- **No cascade layers**, because unlayered host CSS beats layered CSS outright —
  a plain `h1 { color: … }` in your app would otherwise override the dashboard's
  own typography.

The one thing it can't win is a host `!important` rule aimed at the same
property. Nothing short of `!important` on our side would, and a package
shouting over its host is worse than a rare collision.

> **Upgrading from 0.1.x?** Nothing to do — your existing `@source
> "…/@polishd/next/dist"` keeps compiling the dashboard's utilities exactly as
> before, so the dashboard stays styled whether or not you add the import.
>
> To move over at your own pace, **add the import first, then** delete the
> `@source` line — in that order, so the dashboard is never unstyled in between.
> `polishd doctor` reports which setup it finds and won't call a working 0.1.x
> install broken.

## Protecting the dashboard

The dashboard is not a read-only report. Its settings change the configured
model and **API base URL**, so anyone who can reach it can point your requests
at their own endpoint and spend your key. Treat it as a credential-adjacent
surface.

In **development** it is open and says so once in the console. In
**production** Polishd refuses to serve it until you have made a decision.
There are three ways to make one.

### 1. A token — no code, works with no auth of your own

```bash
POLISHD_DASHBOARD_TOKEN=$(openssl rand -hex 32)
```

That is the whole integration. The locked screen shows a password field; the
token is exchanged for an httpOnly, path-scoped cookie by a server action, so
it never appears in a URL, in browser history, in server logs, or in a
`Referer` header. The cookie holds an HMAC of the token rather than the token
itself, comparison is constant-time, expiry is enforced server-side, and the
unlock form is rate-limited per IP.

Tune it if you moved the dashboard off `/polishd`:

```tsx
import { createPolishdPage, polishdTokenAuth } from "@polishd/next/dashboard";

export default createPolishdPage({
  authenticate: polishdTokenAuth({ basePath: "/admin/polishd" }),
});
```

### 2. Your app's own auth

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

`authenticate` receives the request's `cookies` and `headers`, so it is an
ordinary function of its inputs and can be unit tested without a live request:

```ts
const authenticate = (ctx) => ctx.cookies.get("session")?.value === expected;
```

A zero-argument callback still works unchanged.

### 3. Public on purpose

```bash
POLISHD_DASHBOARD_PUBLIC=true
```

An explicit, grep-able opt-in. You will still get one console warning per boot,
in production, because that is the only place it is worth acting on.

> **The gate covers the server actions, not just the page.** The AI actions
> (generate summary, save settings, scan codebase, file GitHub issues) are
> independently addressable POST endpoints whose ids ship in the public client
> bundle, so gating only the page would leave them callable by anyone. They
> re-run your check against the caller's cookies on every call, and deny when
> no dashboard page has registered a policy — including when you delete
> `app/polishd/page.tsx` but keep the package, in which case the actions stay
> routable and always deny.

## AI summary

The dashboard's top card turns the captured signals into a plain-English story
of how people are actually using your site, followed by a **wins** list (what's
working) and a **losses** list (specific problems). Losses are held to a higher
bar: each must cite the exact page, selector, or component from the data —
citations that don't appear in the analytics are discarded as hallucinations,
and the rest are matched to your source files so every loss shows the file it
lives in (or an honest "not matched to source" tag for dynamic content). It's
**bring-your-own-key**: on first visit the card walks you through a four-step
setup — connect a model (Anthropic, OpenAI, any OpenAI-compatible endpoint, or
Google), describe your site, scan your codebase, and pick a refresh cadence.
After that the card is just the story: the summary, when it was generated, a
**refresh** icon to force a regenerate, and a **gear** that opens the full
settings when you need them. Nothing is sent to a model until you ask.

It's built to spend as few tokens as possible:

- The model never sees raw events — only a compact, server-side **digest** of the
  already-aggregated numbers (a few hundred tokens for an entire site).
- The digest is **fingerprinted** and the summary is **cached**. Re-opening the
  dashboard costs nothing, and a regenerate with no new data returns the cached
  text without a model call.
- The output is capped to a single tight paragraph.

**Auto-refresh.** Pick a cadence (manual / daily / weekly) during setup or in
Settings. When you open the dashboard past the cadence and the data has
actually changed, the summary regenerates in the background after the page is
served — no external cron, serverless-friendly. Unchanged data never triggers
a model call, whatever the cadence.

The API key is stored server-side (in your database) and is **never** sent back
to the browser — the UI only ever shows whether one is set. You can also preset
everything from the environment (handy for CI / shared deploys); dashboard
settings take precedence.

**Where to get a key:**

| Provider | Get a key | Notes |
|---|---|---|
| Anthropic (Claude) | [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) | default model `claude-opus-4-8` |
| OpenAI | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) | default model `gpt-4o-mini` |
| OpenAI-compatible | e.g. [openrouter.ai/keys](https://openrouter.ai/keys), [console.groq.com/keys](https://console.groq.com/keys) | also set **Base URL** |
| Google (Gemini) | [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) | default model `gemini-1.5-flash` |

### Project profile — the one-time setup scan

To make the summary understand your *code* — not just the numbers — run the
one-time **Scan codebase** step from the card's Project profile strip. Polishd
reads your app's source from disk (pages and layouts first, then component
files, under a hard token budget), and asks the model to write a compact
profile: what the site is for, a map of its routes, and every interactive
component by its exact identifier. Optionally tell it your **target audience**
and **ideology / values** in Settings so the analysis judges the site by your
goals.

The profile is cached in your database and injected into every summary as
authoritative context, so:

- **Summaries never re-read source.** One scan, then pure digest + profile.
- **The codebase is only touched again** when analytics mention a component the
  profile doesn't cover — a tiny targeted read of just the files naming it —
  or when you explicitly re-scan (the strip shows a hint when new components
  appear).
- On serverless hosts where source isn't on disk, scan in local dev; the saved
  profile keeps serving in production.

> **What the model sees.** A compact, server-side digest of the aggregated
> analytics (page paths, element selectors, `data-component` names, sample
> text, error messages), the cached project profile, and the description you
> provide. Your source is read only during an explicit scan (or a targeted
> gap-fill), and always under strict size budgets.

## Design review

The dashboard's **Design** tab (in the sidebar) is your site's brand guideline
reverse-engineered from what actually shipped. Every page measures its own
rendered design once per visitor session — the computed typography, colors,
corner radii and padding, reduced to a compact tally of a few KB — and the tab
assembles the site-wide picture:

- **Typography** — every font family / size / weight combination in use,
  rendered as specimens with real text from your pages.
- **Color palette** — swatches weighted by how much of the UI each color
  covers, split by role (text / background / border).
- **Contrast** — each text-on-background pairing checked against WCAG AA.
- **Corner radii & spacing** — the rounding and padding scales in use.

The first layer of review is **deterministic** — rule-based checks, no model:
too many font sizes to be a type scale, extra font families, near-duplicate
colors (`#fefefe` living next to `#ffffff`), contrast failures with the exact
ratio, one-off values that appear on a single page, padding off the 4px grid.

The second layer is the **Aesthetic review** card: the same model you
configured for the analytics summary reads the measured tokens and findings
and answers the real question — does this read as one deliberate design, or an
accumulation of one-off decisions? Issues it raises must cite a token that
actually appears in the metrics (a hex value, a px size, a page path), and each
comes with a concrete fix. It follows the summary's token-thrift rules: the
model sees a few hundred tokens of aggregated metrics, the result is cached and
fingerprinted, and regenerating over unchanged metrics is free. Refresh buttons
for both the metrics and the analysis are on the tab.

Nothing extra to install or wire: the scan ships with the existing client,
flows through the existing ingest route, and the dashboard itself is never
scanned.

## Component-level tracking

Wrap any element to track it explicitly. Interactive controls get hover + click
attribution; pass `content` for articles/regions to also measure viewport time,
scroll depth, and rendered size.

```tsx
import { PolishdMonitor } from "@polishd/next/client";

<PolishdMonitor name="listen-button">
  <ListenButton />
</PolishdMonitor>

<PolishdMonitor name={slug} content className="block">
  <Article />
</PolishdMonitor>
```

## Configuration

Defaults suit a low-traffic site. Override via `polishd.config.ts`:

```ts
// polishd.config.ts
import { definePolishdConfig } from "@polishd/next";
export default definePolishdConfig({
  sampleRate: 1,
  rageClick: { count: 3, windowMs: 500 },
});
```

The dashboard never measures itself: nothing on `/polishd` (or below it) is
captured, so reading your analytics can't show up as your site's most-used
feature. **Moved the dashboard elsewhere?** Set `dashboardRoute` in your
config, thread the config into the client and route as shown below, and also
pass it to the page — the dashboard's own queries have no other way to learn
where they're mounted:

```tsx
export default createPolishdPage({ config: polishdConfig });
```

(`POLISHD_DASHBOARD_ROUTE` is the no-code alternative: ingest and the
dashboard's queries both read it.)

> **Nothing imports this file for you.** It cannot be auto-loaded: the three
> places that read config run in three different runtimes — the browser, the
> Edge proxy, and the Node route handler — and the Edge one has no filesystem.
> Pass it to each explicitly:

```ts
import config from "../polishd.config";

initPolishd(config);                             // instrumentation-client.ts
export const POST = createPolishdRoute(config);  // app/api/polishd/route.ts
const { proxy } = createPolishdProxy(config);    // proxy.ts
```

Thread it into one but not another and the layers disagree silently — a proxy
minting cookie `a` while ingest looks for `b` produces exactly the empty
dashboard described below.

For **`sessionCookie` specifically, prefer the environment variable**. It is the
one channel every runtime can read, so it cannot go half-applied:

```bash
POLISHD_SESSION_COOKIE=my_session
```

## Environment variables

| Var | When | Purpose |
|---|---|---|
| `POLISHD_DATABASE_URL` | production | Pooled Postgres connection string — enables capture |
| `POLISHD_DB_PATH` | dev (optional) | Custom SQLite path (default `.polishd/analytics.db`) |
| `POLISHD_DASHBOARD_TOKEN` | production | Protects `/polishd` with the built-in gate. Generate with `openssl rand -hex 32` |
| `POLISHD_DASHBOARD_PUBLIC` | production (optional) | `true` — serve the dashboard unguarded on purpose |
| `POLISHD_SESSION_COOKIE` | optional | Rename the anonymous session cookie. Read by both the proxy and ingest, so they cannot disagree |
| `POLISHD_DASHBOARD_ROUTE` | optional | Where the dashboard is mounted, if not `/polishd`. Read by ingest and the dashboard's queries so its own traffic is excluded; `createPolishdPage({ config })` is the code-side equivalent |
| `POLISHD_AI_PROVIDER` | AI (optional) | `anthropic` \| `openai` \| `openai-compatible` \| `google` |
| `POLISHD_AI_MODEL` | AI (optional) | Model id (defaults per provider, e.g. `claude-opus-4-8`) |
| `POLISHD_AI_API_KEY` | AI (optional) | Model API key — preset instead of using the dashboard |
| `POLISHD_AI_BASE_URL` | AI (optional) | Base URL for `openai-compatible` providers |
| `POLISHD_AI_INSTRUCTIONS` / `POLISHD_AI_CONTEXT` | AI (optional) | Default instructions / site description |
| `POLISHD_AI_AUDIENCE` / `POLISHD_AI_IDEOLOGY` | AI (optional) | Target audience / product values for the profile scan |
| `POLISHD_AI_SOURCE_DIRS` | AI (optional) | Comma-separated folders to scan (default `src`/`app`/`components`/`pages`/`lib`) |
| `POLISHD_AI_REFRESH_CADENCE` | AI (optional) | `manual` \| `daily` \| `weekly` — summary auto-refresh cadence |
| `POLISHD_GITHUB_REPO` | GitHub (optional) | Repository as `owner/repo` — enables filing bugs from AI-found losses |
| `POLISHD_GITHUB_TOKEN` | GitHub (optional) | Fine-grained PAT: Contents (read), Issues & Pull requests (write) |
| `POLISHD_GITHUB_AUTO_ISSUES` | GitHub (optional) | `true` — file a GitHub issue automatically for each new problem a summary finds |

AI settings are optional — the dashboard's Settings panel configures the same
fields, and what you save there overrides these env defaults.

Local dev needs nothing. If no writable store is available the package degrades
to a safe no-op (a console warning, dashboard notice) — your app never breaks.
See [DATABASE.md](./DATABASE.md) for production setup.

## Troubleshooting

Run `npx @polishd/next doctor` first — it catches most of these by name, and
`--url http://localhost:3000` checks the live path as well.

| Symptom | Cause | Fix |
|---|---|---|
| Dashboard empty, beacons all return 200 | The proxy isn't running, so no session cookie is minted and ingest drops every batch | Check the file is named for your Next major — `proxy.ts` on 16+, `middleware.ts` on 15 — and exports a function of the same name. The dashboard shows a banner when it detects this |
| Every `/api/*` route 404s | The proxy matcher touches `/api` | Restore the `(?!api…)` exclusion. Under Next 16 + Turbopack this breaks the whole `/api` segment |
| Build fails: *"can't recognize the exported `runtime` field"* | Route segment config re-exported | Declare `runtime`/`dynamic` inline in the module |
| Dashboard renders unstyled | `@polishd/next/dashboard.css` isn't imported | See [Styling](#styling) |
| Dashboard content cut off below the fold | A host `body` that doesn't scroll | Fixed by default; if an ancestor sets `transform`/`filter`/`contain`, pass `shell: false` and see [docs/SETUP.md](./docs/SETUP.md) |
| `ExperimentalWarning: SQLite is an experimental feature` | Node's built-in `node:sqlite` | **Expected and harmless.** Node prints this for its own SQLite module on 22.x. Not a sign the package is unstable, and it disappears in production where Postgres is used |
| `ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite` | Node < 22.5 | Upgrade Node, or configure Postgres |
| Server actions fail with an opaque digest | No dashboard page registered a policy | Expected if you deleted `app/polishd/page.tsx` — the actions fail closed by design |

## Entry points

| Import | Contents |
|---|---|
| `@polishd/next` | config, `definePolishdConfig`, `resolveSessionCookie`, event types (isomorphic) |
| `@polishd/next/client` | `initPolishd`, `PolishdMonitor` |
| `@polishd/next/server` | store, ingest, queries, `withPolishdSession` (Node only) |
| `@polishd/next/route` | `POST`, `createPolishdRoute` |
| `@polishd/next/proxy` | `proxy`, `config`, `withPolishdSession`, `polishdMatcher`, `composePolishd` |
| `@polishd/next/dashboard` | `createPolishdPage`, `polishdTokenAuth`, `PolishdDashboard`, `loadPolishdDashboardData` |

## CLI

| Command | Purpose |
|---|---|
| `npx @polishd/next init` | Scaffold the glue files. `--dry-run`, `--force`, `--js`, `--config` |
| `npx @polishd/next doctor` | Check an install. `--url <origin>` adds live checks |

## Development

This repository contains the package only. To work on it:

```bash
npm install
npm run build        # tsc -> dist (ESM + .d.ts)
npm run typecheck
```

To test a change against a real app, `npm pack` and install the tarball into a
scratch Next.js project — that exercises the published `exports` map and the
"use client"/"use server" boundaries the way a consumer will.

## License

MIT — see [LICENSE](./LICENSE).
