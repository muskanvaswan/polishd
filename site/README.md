# polishd-site

Landing page for **[@polishd/next](https://www.npmjs.com/package/@polishd/next)** —
a Next.js (App Router) app. The page itself is static; the site also runs
polishd (dogfooding it) and hosts the project's telemetry collector.

## Polishd on the site

The site installs its own package, exactly the way `npx @polishd/next init`
would wire any host app: `instrumentation-client.ts` starts capture,
`app/api/polishd/route.ts` ingests (and mints the session cookie on a
visitor's first batch), and the dashboard is at `/polishd`, opening with the
site description from `polishd.defaults.json`.

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
| `POLISHD_ANALYTICS_SOURCE` | `telemetry` — the whole dashboard (Analytics, Design, AI summary) reads the cross-install telemetry instead of the site's own traffic. The site's own visitors are still stored: the Analytics tab's **Site** pill shows them |

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

## Search, sharing and agents

- `lib/links.ts` `SITE_URL` is the production origin, `https://polishd.site`.
  `metadataBase`, the canonical link, `og:url`, the sitemap and the JSON-LD all
  resolve against it, so the other domains serving the same deployment
  (`polishd.muskanvaswan.xyz`, `polishd-lac.vercel.app`) never compete with it
  in search. Change it there if the domain moves.
- `lib/seo.ts` holds the search title and description (what a result shows,
  in the words people search for) and the schema.org data: a `WebSite` and a
  `SoftwareApplication` for the package.
- The share card, `app/opengraph-image.png`, is `teaser/promo-poster.png`
  cropped to 1200×630; its alt text is `opengraph-image.alt.txt`. Next uses it
  for X too. Recut it from the poster when the poster changes.
- `app/robots.ts` and `app/sitemap.ts` generate `/robots.txt` and
  `/sitemap.xml`. `/polishd` is left crawlable on purpose: its page sets
  noindex (the package's own `metadata`), which a robots.txt block would hide.
- `/AGENTS.md` serves the repo's install procedure as plain markdown, read
  at build time (`app/AGENTS.md/route.ts`; main's copy from GitHub if the
  build can't see the repo root). It is for agents asked to install a package
  they don't know: npmjs.com answers them with a 403. `/llms.txt` indexes it
  and the docs.
- The install section ends on a button that copies the prompt for a coding
  agent, `lib/agent-prompt.ts`; the prompt itself isn't shown. Keep it in
  step with the copies in the root `README.md`, `docs/SETUP.md` and the CLI
  help in `bin/polishd.mjs`.

## The story the page tells

The page answers a developer's questions in the order they ask them. People
who skimmed the old page took Polishd for an agent skill; the hero says
plainly that it's an npm package running in your app, and `in-your-app` shows
the files once the reader knows what it does.

| Section | Does |
|---|---|
| `hero` | Centred: what it is and what you install. Below it, `polish-pass.tsx`: the promo film's opening, live, on the demo site — Queuebird scanned, its rough edges called out, the brush, the polished page. The window arrives tilted back and stands up as you scroll. Drag or arrow keys scrub it |
| `fingerprints` | "Building got fast. Finishing didn't." The one section laid out as a bento that fits a single screen: the headline as one cell, a tile per fingerprint around it, with the values Polishd measured on Queuebird |
| `how-it-works` | Five steps, scrolled through on the dashboard they happen in |
| `where-it-runs` | The data flow as a diagram, and exactly what can leave the server and when |
| `in-your-app` | "A package in your app. Not a service. Not a skill." Directly under `where-it-runs`, which already covers whose database, model and agent it uses; this one shows the files `init` writes |
| `demo` | The invitation to the live demo: the site, and its real dashboard |
| `install` | Four commands, and the prompt that hands them to a coding agent (`agent-prompt.tsx`) |
| `status` | The seven stages, Live or Coming (`lib/loop.ts`) |
| `faq` | The questions developers ask first |
| `closing` | The wordmark, install, the demo, and the film in a dialog (`film-button.tsx`, `public/film/`) |

House rules, because they were each a correction:

- No header. The wordmark is on the first and last screens; the links live in
  the footer.
- No labels above section headings.
- In a two-line headline the second line is the point, so it's the bright one
  and it carries the sheen. Grey never carries the important line.
- Numbers only where the content is a sequence (the five steps, the four
  commands, the seven stages).
- The one-screen bento is for `fingerprints` only. Every other section keeps
  its own layout and scrolls as a page; nothing snaps.
- No halftone background. The page is jet black with a hairline grid, film
  grain and one warm glow.

### The demo

`DEMO_URL` in `lib/links.ts` (`NEXT_PUBLIC_DEMO_URL` to override, default
`https://demo.polishd.site`) points at `demo/` in this repo: Queuebird, a dark
dev-tool launch page generated in one go, with the package installed. Its
dashboard at `/polishd` is the real one, open to look at and read-only.

Everything the landing page shows of a site is Queuebird: the hero, the
fingerprint tiles, the walkthrough's panels, the demo section. The numbers come
from Polishd's own dashboard for it (`lib/findings.ts`; `demo/README.md` says
how the traffic was recorded). The two AI reviews and the pull request in the
walkthrough are labelled examples: the numbers were captured with no model
connected. Real visitors add to the demo's traffic, so its live dashboard will
drift from the numbers quoted here.

## How it's put together

Tailwind v4, on the package's own dashboard tokens (`src/dashboard/dashboard.css`,
dark scheme): a `#0a0a0a` canvas, `#121212` cards on `#262626` hairlines, the
four-step grey ink scale (`fg` … `fg-4`), and colour reserved for status — green
ok, amber warn, red bad, a warm tan where another tool would reach for violet.
The page itself stays jet black around them. Open Sauce One is the dashboard's
UI face, Nohemi its titles, JetBrains Mono its code — the same three the site
uses.

- `app/globals.css` — the tokens, the ambient field (`.aura`, `.grain`,
  `.glow`), the reveal classes, and "The one slide": `.slide`, `.bento` and
  `.cell`, used by `fingerprints` alone.
- `components/kit.tsx` — `Wrap`, `SectionHead` (the two-line heading), the
  button-links, and `Slide` / `Headline` for the one bento section.
- `lib/queuebird.ts` — Queuebird's first screen for the hero, 1400×784, as
  generated and polished, as HTML strings, plus where each rough edge sits
  for the callouts. `components/queuebird-thumb.tsx` is the small one in the
  demo section.
- `components/wordmark.tsx` — the logo: "polis" and "d" in the highway face
  (Overpass) with the halftone polish bottle for the h, the same mark the
  dashboard's sidebar carries. The favicon, `app/icon.svg`, is the bottle as
  a solid silhouette, derived from the dot field in
  `components/dot-bottle.tsx`.
- `components/scroll-fx.tsx` — one page-wide observer that reveals anything
  tagged `className="r"` as it arrives.
- `public/film/` — the promo film, re-encoded for the web (1280px, 3.5MB), and
  its poster. Loaded only when the dialog opens.
- Reduced motion is honoured (the hero shows a still, half-polished frame and
  the window doesn't tilt), and a `<noscript>` block unhides everything for
  visitors without JS.
