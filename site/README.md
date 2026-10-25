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
| `POLISHD_ANALYTICS_SOURCE` | `telemetry` — the whole dashboard (Analytics, Design, AI summary) reads the cross-install telemetry instead of the site's own traffic |

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

### Snapshots of the dashboard

The site's Design tab measures Polishd's own dashboard (it reads dashboard
telemetry), so its flagged values live on the dashboard's tabs. Production
captures can't shoot those, because they sit behind `POLISHD_DASHBOARD_TOKEN`.
Capture them locally instead, against production data:

```bash
vercel env pull .env.local   # production DB, Blob store and analytics source
npm run dev                  # then /polishd → Design → Capture snapshot
```

Your Chrome shoots the site's pages and each dashboard tab, and the pictures
upload to the production Blob store, so the live dashboard shows them.

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
| `design` | The Design tab's measurements as cards: the palette as the Overview's brand board draws it, type specimens, contrast, the aesthetic review, radii and spacing |
| `proof` | The shipped half, as the Analytics tab's components: stat tiles with sparklines, device sizes, the summary with its pointer to the actionables |
| `actionables` | The Actionables tab — both reviews' findings in one list, with Mark fixed / Ignore / File bug and the GitHub state — beside the fix prompt and its verdicts |
| `loop` | The centrepiece — the six-stage ring |
| `frontier` | Stages 05–06, drawn dashed |
| `install` | Three commands |
| `closing` | *Make your website look polishd* |

## How it's put together

Tailwind v4, on the package's own dashboard tokens (`src/dashboard/dashboard.css`,
dark scheme): a `#0a0a0a` canvas, `#121212` cards on `#262626` hairlines, the
four-step grey ink scale (`fg` … `fg-4`), and colour reserved for status — green
ok, amber warn, red bad, a warm tan where another tool would reach for violet.
Nothing blue; the accent is the text colour itself. The page itself stays jet
black around them. Open Sauce One is the dashboard's UI face, Nohemi its titles,
JetBrains Mono its code — the same three the site uses.

- `components/dash/` — the dashboard's own components, replicated for the
  product sections: `ui.tsx` its vocabulary (card, header strip, badges,
  status pill, callout, colour and contrast chips, illustrative buttons),
  `icons.tsx` the glyph set, `tiles.tsx` the stat tiles with sparklines,
  `brand-board.tsx` the Overview's brand board (its palette), `pointer.tsx`
  the line a review card ends on, pointing at the actionables. Sections compose these as
  cards rather than drawing a whole tab. When the dashboard changes, this is
  the folder to bring along.
- `components/wordmark.tsx` — the logo: "polis" and "d" in the highway face
  (Overpass) with the halftone polish bottle for the h, the same mark the
  dashboard's sidebar carries. Used in the header and the hero.
  The favicon in `app/layout.tsx` is the bottle as a solid silhouette,
  derived from the dot field in `components/dot-bottle.tsx` — the dots don't
  survive 16px, the shape does.
- `components/loop-ring.tsx` — the ring. Six nodes; the shipped arc is solid and
  the beta arc dashed. A white arc travels the shipped stretch and an amber one
  continues into beta, closing the circle on the last stage.
- `components/sections/loop.tsx` — the only stateful section. An observer band
  across the middle of the viewport decides which stage you're reading; the ring
  is sticky beside it on `lg`, and sits above the stage list on smaller screens.
- `components/scroll-fx.tsx` — one page-wide observer that reveals anything
  tagged `className="r"`, counts up every `[data-count]` figure inside it,
  fills `.fill` meters and lets the `.spark` sparklines draw in. Elements
  already scrolled past on load reveal instantly rather than staying hidden.
- Reduced motion is honoured, and a `<noscript>` block unhides everything for
  visitors without JS.

The dashboard numbers in `design`, `proof` and `actionables` are illustrative —
they mirror a real Polishd install (a desktop-first publication read mostly on phones, set in
Georgia and Helvetica with one rust for actions) so the layout is shown at
realistic density. Every component is the dashboard's own, on its tokens.
