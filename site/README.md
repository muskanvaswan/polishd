# polishd-site

Landing page for **[@polishd/next](https://www.npmjs.com/package/@polishd/next)** —
a Next.js (App Router) app. The page itself is static; the site also runs
polishd (dogfooding it) and hosts the project's telemetry collector.

## Polishd on the site

The site installs its own package, exactly the way `polishd init` would wire
any host app: `proxy.ts` mints the session cookie, `instrumentation-client.ts`
starts capture, `app/api/polishd/route.ts` ingests, and the dashboard is at
`/polishd`.

On top of that, `app/api/polishd-telemetry/route.ts` is the **cross-install
telemetry collector** — the endpoint every polishd installation's dashboard
reports to when its owner opts in (see the root README's "Dashboard
telemetry"). Those events land in this site's database tagged with an
anonymous install id, so dashboard usage across all installations is read on
this site's own `/polishd` dashboard.

Production needs (Vercel → Project → Environment Variables):

| Var | Purpose |
|---|---|
| `POLISHD_DATABASE_URL` | Pooled Postgres connection string — the site runs on an ephemeral FS, so SQLite can't persist |
| `POLISHD_DASHBOARD_TOKEN` | Protects `/polishd`; generate with `openssl rand -hex 32` |

Local dev needs nothing — events land in `.polishd/analytics.db` (gitignored).

```bash
npm install
npm run dev      # http://localhost:3000
```

| | |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Static production build (prerenders `/`) |
| `npm run start` | Serve the build |
| `npm run typecheck` | `tsc --noEmit` |

Deploy anywhere that runs Next — Vercel picks it up with the root directory set
to `site/`.

## The story the page tells

Shipping is cheap now, so working software is no longer the bar — taste is. The
page argues that in one arc, then shows the loop that gets you there:

**track → measure → analyse → surface → experiment → verify → ship, or repeat.**

Stages 01–04 ship today; 05–06 are in build. Every stage on the page carries its
own `Live` / `In beta` status, and the frontier section says outright that the
API for the unshipped half isn't settled. Nothing claims to exist that doesn't.

| Section | Does |
|---|---|
| `hero` | The thesis — *Build fast, refine relentlessly* |
| `loop` | The centrepiece — the six-stage ring |
| `proof` | The shipped half, as real dashboard output |
| `frontier` | Stages 05–06, drawn dashed |
| `install` | Three commands |
| `closing` | *Make your website look polishd* |

## How it's put together

Tailwind v4, with design tokens taken straight from the package's own dashboard
(`src/dashboard/index.tsx`): `#000` page, `#0a0a0a` cards, `#2e2e2e` hairlines,
11px/`0.08em` uppercase labels, tabular numerals, and the same red / amber /
emerald / blue / violet accents.

- `components/loop-ring.tsx` — the ring. Six nodes; the shipped arc is solid and
  the beta arc dashed. A white arc travels the shipped stretch and an amber one
  continues into beta, closing the circle on the last stage.
- `components/sections/loop.tsx` — the only stateful section. An observer band
  across the middle of the viewport decides which stage you're reading; the ring
  is sticky beside it on `lg`, and sits above the stage list on smaller screens.
- `components/scroll-fx.tsx` — one page-wide observer that reveals anything
  tagged `className="r"`, counts up `[data-count]` figures and fills `.fill`
  meters. Elements already scrolled past on load reveal instantly rather than
  staying hidden.
- Reduced motion is honoured, and a `<noscript>` block unhides everything for
  visitors without JS.

The dashboard numbers in `proof` are illustrative — they mirror a real Polishd
install so the layout is shown at realistic density.
