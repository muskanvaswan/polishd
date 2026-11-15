# polishd-demo

**demo.polishd.site** — Queuebird, a dark dev-tool launch page generated in one
go, the way an AI tool writes them, with
[`@polishd/next`](https://www.npmjs.com/package/@polishd/next) installed. A
bar at the bottom of every page opens the site's real Polishd dashboard at
`/polishd`, and lists the site's nine bugs so you can fix them one at a time.
Queuebird isn't a real product.

## What's in it

| Path | What |
|---|---|
| `app/(site)/` | Queuebird itself: `/`, `/pricing`, `/docs` |
| `components/site/` | Queuebird's components. The rough edges are in the code the way a one-shot generation leaves them: Tailwind's `zinc` and `neutral` greys side by side, four purples and a rainbow of icon colours, dim greys for captions, a size for every heading, radii that disagree, a few hand-typed paddings — and four things that look clickable and aren't: copy icons in a `<div>`, a Monthly / Yearly switch made of spans, code tabs made of spans, and "Changelog" / "Learn more" spans styled as links |
| `components/demo-bar.tsx` | The bar: what this site is, the list of bugs with a switch for each, and the link to the dashboard |
| `lib/fixes.ts` | The nine bugs, and the fix behind each switch |
| `instrumentation-client.ts`, `app/api/polishd/route.ts`, `app/polishd/page.tsx`, `polishd.defaults.json` | Polishd, installed with `npx @polishd/next init`. Two files are edited for the demo; each says why at the top |
| `proxy.ts` | Makes the dashboard read-only in production |
| `seed/` | Seven recorded visits, and the script that replays them as traffic |

### The dashboard is the real one

`/polishd` is Polishd's own dashboard for this site, with nothing in front of
it. A real app protects that page with a token or its own auth, because the
dashboard can change the model settings and spend the model key. This demo
wants anyone to be able to look around, so:

- **In production it's read-only.** `proxy.ts` refuses every request that
  isn't a plain read, and `app/polishd/page.tsx` refuses server actions again
  through the dashboard's own `authenticate`. Visitors can open every tab,
  chart and drawer. Buttons that change something — regenerate, ignore, file
  a bug, save settings — fail.
- **In development it's yours.** `npm run dev` leaves the dashboard fully
  open, so that's where you connect a model and run the reviews.
- `POLISHD_TELEMETRY=off` (in `.env`) turns off the dashboard's opt-in prompt,
  which visitors couldn't answer.

### The bar stays out of the numbers

Polishd measures the page it's installed on: every click, and every colour
the page paints. The bar isn't part of Queuebird, so it's an iframe: its clicks
never reach the page, and the design scan skips iframes.

A fixed bug isn't the site being measured either, so
`instrumentation-client.ts` drops anything captured while any fix is on. The
dashboard always describes the site as generated.

### How a fix applies

Each fix is a Tailwind variant declared in `app/globals.css`
(`@custom-variant fx-palette (&:where([data-fix~="palette"] *))`), and the
site's classes carry the rough value and the fixed one side by side:

```tsx
<p className="text-sm text-neutral-500 fx-contrast:text-fg-2">…</p>
```

Behaviour fixes render both versions and swap them: the copy icon's `<div>`
is `fx-copy:hidden`, and the `<button>` beside it is `hidden fx-copy:inline-flex`.
Turning a bug's switch on adds its fix to `data-fix` on `<html>`; while it
lands, `data-morph` eases each changed property so you can watch it. "Fix all
of them" sweeps the brush across the page and turns on all nine.

Every flaw on the page is one Polishd measures, and the fixes change only
those. There are no gradients or glows to remove: Polishd doesn't measure
them, so a site that had them would still have them after polishing, and the
before and after would look alike. What changes is what was flagged: seven
purples fold into one accent, the second grey scale goes, dim text comes up
to AA, the type, radii and padding land on a scale, and the dead controls
work.

Re-scanned with every fix on, Polishd's Design tab has 13 colours where there
were 33, 4 radii where there were 7, six font sizes where there were 18, no
off-scale padding, and every text pair passing WCAG AA where 12 failed. One
colour is still marked one-off: the red of the single "failed" status pill
(`#fb7185`). To repeat that check, run the app with
`NEXT_PUBLIC_DEMO_CAPTURE_FIXED=on` and a throwaway `POLISHD_DB_PATH`, open
`/?polish=1`, `/pricing?polish=1` and `/docs?polish=1`, and read
`/polishd?tab=design`. Stop the dev server fully before deleting `.next`: a
restart that races the old process comes up answering 404 on every route.

### Two things to know about the theme

- **The palette colours are pinned to hex.** Tailwind v4 defines its default
  palette in `oklch()`, Chrome reports those colours as `oklch()`, and
  `@polishd/next` 0.3.2's design scan only reads `rgb()` — it would skip every
  one of them, contrast included. `app/globals.css` pins the colours this site
  uses to their hex values (Tailwind v3's); the classes are unchanged. Remove
  the block once the scan reads `oklch()`.
- **`--default-mono-font-family` is Geist Mono.** Tailwind's preflight gives
  `<code>` the default mono stack, which is otherwise not the site's.

## Run it

```bash
npm install
npm run dev        # http://localhost:3300 — dashboard at /polishd
npm run seed       # once, against an empty store: 200 sessions to look at
```

The store is `.polishd/analytics.db` (SQLite). To connect a model, open
`/polishd`: its first-time setup asks for the key. Or put it in `.env.local`,
which is gitignored:

```bash
printf 'POLISHD_AI_API_KEY=%s\n' "$(pbpaste)" >> .env.local
```

## The traffic

`seed/templates.json` is seven visits to this site, made by hand in a browser
and recorded by Polishd's own capture: desktop and phone; copying the install
command, trying the code tabs, the Yearly switch, "Changelog" and "Learn
more", reading the docs, leaving early. `seed/replay.mjs` posts them to
`/api/polishd` as 200 sessions over two weeks, each with its own session
cookie. The traffic is simulated; every event in it is one the package
recorded, and everything the dashboard says about it is the package's own.

To re-record after changing the site, run `NEXT_PUBLIC_DEMO_BAR=off npm run dev`,
browse it, and rebuild `templates.json` from the store.

## Deploy (Vercel)

A new Vercel project with **Root Directory** `demo`, and `demo.polishd.site`
pointed at it. The landing page links there; to link somewhere else, build the
site with `NEXT_PUBLIC_DEMO_URL`.

1. **A database.** `POLISHD_DATABASE_URL`, a pooled Postgres URL of the demo's
   own — never the Polishd site's. Without one the dashboard shows its setup
   screen and nothing is captured.
2. **Seed it:** `ORIGIN=https://demo.polishd.site npm run seed`.
3. **The model.** Set `POLISHD_AI_API_KEY` (and `POLISHD_AI_PROVIDER` /
   `POLISHD_AI_MODEL` if not the defaults) in the project's environment. Then
   run the reviews once from your machine, where the dashboard isn't
   read-only, against the same database:

   ```bash
   vercel env pull .env.local --environment production
   npm run dev      # open /polishd, finish setup, generate the summary and the design review
   ```

   The results are stored in the database, so the deployed dashboard shows
   them. Visitors can't regenerate them or change the settings.

Real visitors are captured too, so the numbers move: someone can click around
Queuebird, open the dashboard and find their own session in it.
