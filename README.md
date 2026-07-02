# @buffd/next

> **What gets measured gets improved.**

Drop-in **product analytics** for Next.js (App Router). Capture real user
behavioral signals — rage clicks, dead clicks, scroll depth, JS errors, web
vitals, component engagement — and explore them on a built-in, Vercel-style
dashboard at `/buffd`.

No third-party service. Events go to your own database: **SQLite in dev**
(zero-config, built into Node), **Postgres in production**. Anonymous by design —
one httpOnly UUID cookie per session, no fingerprinting, no PII.

---

## Install

```bash
npm install @buffd/next
npm install pg            # optional — only for Postgres in production
npx @buffd/next init      # scaffolds the glue files below
```

`init` detects your layout (`src/` or root), writes the four files, adds
`.buffd/` to `.gitignore`, and skips anything that already exists
(`--force` to overwrite, `--dry-run` to preview, `--config` to also emit a
`buffd.config.ts`).

## What gets wired up

```ts
// src/proxy.ts        (middleware.ts on Next 15) — sets the session cookie
import type { NextRequest } from "next/server";
import { withBuffdSession } from "@buffd/next/proxy";

export function proxy(request: NextRequest) {
  return withBuffdSession(request);
}
// Must be an inline literal — Next can't import config.matcher.
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon|assets).*)"],
};

// src/instrumentation-client.ts — starts capture before hydration
import { initBuffd } from "@buffd/next/client";
initBuffd();

// src/app/api/buffd/route.ts — the ingest endpoint
export { POST, runtime, dynamic } from "@buffd/next/route";

// src/app/buffd/page.tsx — the dashboard (unguarded by default)
import { createBuffdPage } from "@buffd/next/dashboard";
export const runtime = "nodejs";       // Next requires these inline in the page
export const dynamic = "force-dynamic";
export default createBuffdPage();
```

> **Get the matcher right.** Next statically parses `config.matcher`, so it must
> be an inline literal in your proxy file — it can't be imported. `npx @buffd/next
> init` writes the correct one for you. Excluding all of `/api` is load-bearing:
> under Next 16 + Turbopack, a proxy matcher that touches any `/api/*` route
> breaks resolution for the entire `/api` segment.

## Protecting the dashboard

By default `/buffd` is **public** (a dev-only console warning reminds you).
Gate it with an `authenticate` callback, and optionally render your own sign-in
UI when it fails:

```tsx
import { createBuffdPage } from "@buffd/next/dashboard";
import { isAuthenticated } from "@/lib/auth";
import { MyLogin } from "./login";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default createBuffdPage({
  authenticate: isAuthenticated,        // () => boolean | Promise<boolean>
  unauthorized: <MyLogin />,            // optional; a minimal screen otherwise
});
```

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
one-time **Scan codebase** step from the card's Project profile strip. Buffd
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
import { BuffdMonitor } from "@buffd/next/client";

<BuffdMonitor name="listen-button">
  <ListenButton />
</BuffdMonitor>

<BuffdMonitor name={slug} content className="block">
  <Article />
</BuffdMonitor>
```

## Configuration

Defaults suit a low-traffic site. Override via `buffd.config.ts` and pass it to
`initBuffd`:

```ts
// buffd.config.ts
import { defineBuffdConfig } from "@buffd/next";
export default defineBuffdConfig({
  sampleRate: 1,
  rageClick: { count: 3, windowMs: 500 },
});
```

```ts
// src/instrumentation-client.ts
import { initBuffd } from "@buffd/next/client";
import config from "../buffd.config";
initBuffd(config);
```

## Environment variables

| Var | When | Purpose |
|---|---|---|
| `BUFFD_DATABASE_URL` | production | Pooled Postgres connection string — enables capture |
| `BUFFD_DB_PATH` | dev (optional) | Custom SQLite path (default `.buffd/analytics.db`) |
| `BUFFD_AI_PROVIDER` | AI (optional) | `anthropic` \| `openai` \| `openai-compatible` \| `google` |
| `BUFFD_AI_MODEL` | AI (optional) | Model id (defaults per provider, e.g. `claude-opus-4-8`) |
| `BUFFD_AI_API_KEY` | AI (optional) | Model API key — preset instead of using the dashboard |
| `BUFFD_AI_BASE_URL` | AI (optional) | Base URL for `openai-compatible` providers |
| `BUFFD_AI_INSTRUCTIONS` / `BUFFD_AI_CONTEXT` | AI (optional) | Default instructions / site description |
| `BUFFD_AI_AUDIENCE` / `BUFFD_AI_IDEOLOGY` | AI (optional) | Target audience / product values for the profile scan |
| `BUFFD_AI_SOURCE_DIRS` | AI (optional) | Comma-separated folders to scan (default `src`/`app`/`components`/`pages`/`lib`) |
| `BUFFD_AI_REFRESH_CADENCE` | AI (optional) | `manual` \| `daily` \| `weekly` — summary auto-refresh cadence |

AI settings are optional — the dashboard's Settings panel configures the same
fields, and what you save there overrides these env defaults.

Local dev needs nothing. If no writable store is available the package degrades
to a safe no-op (a console warning, dashboard notice) — your app never breaks.
See [DATABASE.md](./DATABASE.md) for production setup.

## Entry points

| Import | Contents |
|---|---|
| `@buffd/next` | config, `defineBuffdConfig`, event types (isomorphic) |
| `@buffd/next/client` | `initBuffd`, `BuffdMonitor` |
| `@buffd/next/server` | store, ingest, queries, `withBuffdSession` (Node only) |
| `@buffd/next/route` | `POST`, `createBuffdRoute` |
| `@buffd/next/proxy` | `proxy`, `config`, `withBuffdSession`, `buffdMatcher` |
| `@buffd/next/dashboard` | `createBuffdPage`, `BuffdDashboard`, `loadBuffdDashboardData` |

## License

MIT
