# @buffd/next

Drop-in **friction analytics** for Next.js (App Router). Capture real user
friction signals — rage clicks, dead clicks, scroll depth, JS errors, web
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
