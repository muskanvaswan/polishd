# @polishd/next

> **What gets measured gets improved.**

Drop-in **product analytics** for Next.js (App Router). Capture real user
behavioral signals — rage clicks, dead clicks, scroll depth, JS errors, web
vitals, component engagement — and explore them on a built-in, Vercel-style
dashboard at `/polishd`.

No third-party service. Events go to your own database: **SQLite in dev**
(zero-config, built into Node), **Postgres in production**. Anonymous by design —
one httpOnly UUID cookie per session, no fingerprinting, no PII.

---

## Documentation

| | |
|---|---|
| **[docs/SETUP.md](./docs/SETUP.md)** | Full walkthrough — every variant, verification, troubleshooting |
| **[AGENTS.md](./AGENTS.md)** | Install procedure written for AI coding agents |
| **[DATABASE.md](./DATABASE.md)** | Production database setup, schema, retention |

## Requirements

- Next.js **15+**, App Router (no Pages Router support)
- Node **22.5+** (the dev store uses the built-in `node:sqlite`)
- Tailwind CSS v3 or v4, if you want the dashboard styled — see [Styling](#styling-required)
- Postgres in production; nothing extra for local development

## Quickstart

```bash
npm install @polishd/next
npx polishd init
npm run dev          # then visit /polishd
```

That's it locally — events write to `.polishd/analytics.db` with no
configuration. `init` detects your layout (`src/` or root), writes the four
files below, adds `.polishd/` to `.gitignore`, wires Tailwind, and skips
anything that already exists (`--force` to overwrite, `--dry-run` to preview,
`--js` for JavaScript, `--config` to also emit a `polishd.config.ts`).

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

// src/app/polishd/page.tsx — the dashboard (unguarded by default)
import { createPolishdPage } from "@polishd/next/dashboard";
export const runtime = "nodejs";       // Next requires these inline in the page
export const dynamic = "force-dynamic";
export default createPolishdPage();
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

## Styling (required)

The dashboard is built from Tailwind utility classes and ships **no stylesheet
of its own**, so Tailwind has to scan the package's `dist` — it won't find it by
default. `init` wires this up for you; if you're doing it by hand:

```css
/* Tailwind v4 — in the CSS file that imports tailwind */
@import "tailwindcss";
@source "../../node_modules/@polishd/next/dist";   /* relative to this file */
```

```ts
/* Tailwind v3 — in tailwind.config.ts */
content: [
  "./src/**/*.{ts,tsx}",
  "./node_modules/@polishd/next/dist/**/*.js",
],
```

Skip this and `/polishd` renders as unstyled HTML. Tailwind v4's automatic content
detection deliberately ignores `node_modules`, so the `@source` line is not
optional.

## Protecting the dashboard

By default `/polishd` is **public** (a dev-only console warning reminds you).
Gate it with an `authenticate` callback, and optionally render your own sign-in
UI when it fails:

```tsx
import { createPolishdPage } from "@polishd/next/dashboard";
import { isAuthenticated } from "@/lib/auth";
import { MyLogin } from "./login";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default createPolishdPage({
  authenticate: isAuthenticated,        // () => boolean | Promise<boolean>
  unauthorized: <MyLogin />,            // optional; a minimal screen otherwise
});
```

The same callback also guards the AI **server actions** (generate summary, save
settings, scan codebase, file GitHub issues). That matters: a server action is
an addressable POST endpoint whose id ships in the public client bundle, so
gating only the page would leave those actions callable by anyone. They re-run
`authenticate` against the caller's cookies on every call, and deny when no
dashboard page has registered a policy.

If you pass no `authenticate`, the dashboard **and** its actions are public —
anyone who finds the URL can read your analytics, change the configured model
and API base URL, and spend your model tokens. Always gate it in production.

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

Defaults suit a low-traffic site. Override via `polishd.config.ts` and pass it to
`initPolishd`:

```ts
// polishd.config.ts
import { definePolishdConfig } from "@polishd/next";
export default definePolishdConfig({
  sampleRate: 1,
  rageClick: { count: 3, windowMs: 500 },
});
```

```ts
// src/instrumentation-client.ts
import { initPolishd } from "@polishd/next/client";
import config from "../polishd.config";
initPolishd(config);
```

## Environment variables

| Var | When | Purpose |
|---|---|---|
| `POLISHD_DATABASE_URL` | production | Pooled Postgres connection string — enables capture |
| `POLISHD_DB_PATH` | dev (optional) | Custom SQLite path (default `.polishd/analytics.db`) |
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

## Entry points

| Import | Contents |
|---|---|
| `@polishd/next` | config, `definePolishdConfig`, event types (isomorphic) |
| `@polishd/next/client` | `initPolishd`, `PolishdMonitor` |
| `@polishd/next/server` | store, ingest, queries, `withPolishdSession` (Node only) |
| `@polishd/next/route` | `POST`, `createPolishdRoute` |
| `@polishd/next/proxy` | `proxy`, `config`, `withPolishdSession`, `polishdMatcher` |
| `@polishd/next/dashboard` | `createPolishdPage`, `PolishdDashboard`, `loadPolishdDashboardData` |

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
