# Changelog

## Unreleased

### Cross-install telemetry ingest

A new `@polishd/next/telemetry` entry point exports a CORS-enabled ingest
route for collecting telemetry *from other polishd installations* — the
foundation for polishd dogfooding its own dashboards. Unlike the first-party
route, it answers preflights, accepts POSTs cross-origin, and splits identity
between body and headers: the session id is client-minted (the httpOnly
session cookie never crosses origins), while the *installation* is identified
by its hostname, derived server-side from the browser-set Origin header —
which page script cannot forge. Events land tagged with that hostname in an
`install_id` column — new, nullable, migrated automatically on both backends —
so one shared database can tell installations apart and name them by domain.
Nothing sends to this endpoint yet; the dashboard-side emitter and its
opt-in consent flow ship separately.

### The dashboard dogfoods itself — with consent

The dashboard now asks, once, whether it may share anonymous usage of
*itself* with the polishd project. Opt-in and off by default: say no and it
never asks again; say yes and a small emitter records clicks (with the same
rage/dead classification the host capture layer uses, via newly shared DOM
helpers), tab views, and one viewport sample — namespaced under `/~polishd/…`
paths, reported under the site's own domain (the disclosed, Origin-derived
install identity), and suspended the instant the URL leaves the dashboard. Nothing from the host site is ever sent: not its analytics,
not its visitors, not its URLs. `POLISHD_TELEMETRY=off` kills the feature
(prompt included), `POLISHD_TELEMETRY_ENDPOINT` redirects it for testing, and
`navigator.doNotTrack` is honored regardless of stored consent. Batches
travel as `text/plain` so the cross-origin POST stays preflight-free and
beacon-compatible.

## 0.2.1

### Losses can be ignored, and the model remembers why

A loss had one answer next to it — **File bug** — and no way to say the other
thing: that it isn't a problem. Nothing recorded that judgement, so the next
regenerate found the deliberate two-step checkout again, and again.

**Ignore** now sits beside File bug on every loss. One click, no explanation
required: the loss leaves the card, leaves the cached summary immediately, and
is dropped from every later summary *before* the four-loss cap applies — so
dismissing one promotes the next real problem into its place rather than
leaving a gap.

A **reason** is optional and offered after the dismissal, so the fast path
stays one click. Give one and it's replayed to the model verbatim on every
later call, alongside the problem it dismissed — context the analytics digest
can't carry ("the second CTA is deliberate", "that page is staff-only"). The
model is told not to re-report a dismissed problem under any wording, and to
read the rest of the data taking the stated reason as true. Reasons can be
edited afterwards, and **Undo** puts a loss back where the model can find it
again.

Dismissals key off the same evidence citation the GitHub issue log uses, so a
problem refound under different wording is still recognised as the one you
already reviewed. They fold into the summary fingerprint too: ignoring
something marks the summary stale exactly like new analytics does, so the next
refresh really does re-ask the model.

### Setup moved out of the way, into a Settings tab

The first screen of the dashboard was also its setup form. Provider, key, site
description, codebase profile and GitHub all lived behind a gear on the
analytics summary card — which pushed the actual analytics down the page, and
left the Design tab telling people to go and find "the Analytics tab's summary
card" to configure a model it uses too.

All of it now lives in a third sidebar tab, **Settings**, grouped into Model /
Your site / Codebase / GitHub with one save. First-run onboarding runs there as
well, and finishing it drops you on Analytics with your first summary. The
summary card keeps only the story and a gear that jumps to Settings; the one
piece of setup still worth seeing next to a summary — whether the model has
actually read your codebase — stays as a one-line nudge.

### Switching tabs responds immediately

Each tab is a full server render, so clicking "Design" used to do nothing
visible for a second or two, which reads as a dead button and gets clicked
again. The tab rail now answers on the click: the tab you picked highlights
straight away, its icon becomes a spinner, further clicks on it are ignored,
and the content column shows a skeleton until the render lands. Cross-tab links
inside a tab behave identically, and the dashboard's own scroll container
returns to the top rather than dropping you halfway down the new tab.

Links are still real anchors — ⌘-click and middle-click open a tab as before,
and with JavaScript off the rail falls back to ordinary navigation.

### A dashboard mounted off `/polishd` no longer reads itself back

The read side of the dashboard (its own queries) previously excluded only the
*default* route, so an app that mounted the dashboard elsewhere — say
`/polish` — saw its own dashboard traffic ranked among the site's pages, and
the Design tab could measure the dashboard's design as the site's. The route
now resolves dynamically everywhere:

- `createPolishdPage({ config })` — pass the same config you thread into
  `initPolishd()` and `createPolishdRoute()`; the page registers
  `dashboardRoute` for the queries running in the same runtime.
- `POLISHD_DASHBOARD_ROUTE` — the no-code channel; ingest and the queries
  both read it.
- The design scanner also recognizes the dashboard by its `.polishd-root`
  scope element, so it never measures the dashboard regardless of
  configuration.

Because the exclusion is applied at read time, dashboard rows captured before
this fix disappear from the stats without touching the database.

### Quieter, truer signals

- The "your proxy isn't running" banner no longer fires over a handful of
  cookie-less batches on a site that is otherwise storing events fine (bots,
  a cookie-blocking visitor, someone's curl test). It now requires the drops
  to be recent **and** material relative to stored volume — or a store with
  nothing in it at all, which is the real broken-proxy signature.
- The Design tab's per-section findings render as one combined note instead
  of a stack of alert boxes.
- Long lists (type styles, colors, contrast failures, radii, spacing, pages)
  collapse behind "Show more" past 5 rows.
- Dashboard tabs navigate client-side — switching tabs swaps the content
  without reloading the whole page.

### Design review — a new dashboard tab

The dashboard now has a sidebar with two tabs: **Analytics** (everything it
showed before) and **Design**, a new aesthetic layer. The Design tab renders
your site's brand guideline *reverse-engineered from the rendered pages*:

- **Typography** — every font family / size / weight combination actually in
  use, shown as specimens with real text sampled from the site.
- **Color palette** — the colors your pages paint, laid out like a brand
  palette and weighted by how much of the UI they cover, split by role
  (text / background / border).
- **Contrast** — every text-on-background pairing measured against WCAG AA,
  failures shown with live samples.
- **Corner radii and spacing** — the rounding and padding scales in use.

Each section flags what breaks the system deterministically — no model
involved: font-size sprawl (16 sizes is not a type scale), extra families,
near-duplicate colors (`#fefefe` next to `#ffffff`), contrast failures,
one-off values that appear on a single page, and padding that drifts off a
4px grid.

On top of the measured metrics, an **Aesthetic review** card asks the same
model you configured for the analytics summary how coherent the design reads
— strengths, and evidence-cited issues with concrete fixes. Like the summary,
it is fingerprint-cached: reopening the tab is free, and regenerating with
unchanged metrics never spends tokens. Refresh buttons for both the metrics
and the analysis sit on the tab.

Nothing new to wire up: pages measure their own rendered design once per
visitor session (a compact few-KB tally, sampled after the page settles) and
the data flows through the existing ingest route and store. The dashboard
itself is never scanned. Existing installs only need the new package version.

## 0.2.0

Everything in this release came out of the first real third-party integration of
the package, and most of it is the same underlying problem: Polishd assumed
things about the host app that it never checked and could not see.

### Upgrading from 0.1.x

**Styling keeps working with no changes.** Your existing `@source
".../@polishd/next/dist"` still compiles the dashboard's utilities exactly as
it did, so upgrading will not leave you with an unstyled page. Verified by
rendering the dashboard both ways: 491 elements, no visible differences.

There is **one required change**, and it is about access, not styling.

**Decide how the dashboard is protected in production.** It now refuses to serve
unless you have chosen one:

```bash
POLISHD_DASHBOARD_TOKEN=$(openssl rand -hex 32)   # built-in gate, no code
```

or pass your own `authenticate` to `createPolishdPage()`, or opt out explicitly
with `POLISHD_DASHBOARD_PUBLIC=true`. Development is unaffected.

Then run `npx @polishd/next doctor`, which checks that and much else.

#### Optional: move to the shipped stylesheet

Recommended, but at your own pace. **Order matters** — add the import first, and
only then remove the old wiring, so the dashboard is never unstyled in between:

1. Add to `app/polishd/page.tsx`:
   ```tsx
   import "@polishd/next/dashboard.css";
   ```
2. Confirm the dashboard still looks right.
3. *Then* delete the `@source ".../@polishd/next/dist"` line from your Tailwind
   entry stylesheet (or the `content` glob in `tailwind.config.*`).

Doing this drops Tailwind as a requirement for your app and stops your build
compiling utilities only the dashboard uses. `doctor` reports which of the two
setups it finds, and never calls a working 0.1.x setup broken.

#### If you are on Next 15, check this

0.1.0's CLI wrote `proxy.ts` regardless of the installed Next major, and **Next
15 does not load that file**. If you are on Next 15 your proxy has never run:
no session cookie, every beacon returning 200, and nothing captured, with no
error anywhere to show for it. Rename it to `middleware.ts` and rename the
exported function to `middleware`. `doctor` reports this explicitly.

### Breaking

- **The dashboard fails shut in production.** With no `POLISHD_DASHBOARD_TOKEN`,
  no `authenticate` callback and no `POLISHD_DASHBOARD_PUBLIC=true`, production
  renders a locked screen and every AI server action denies. Previously the
  default was open, and the warning about it was suppressed in production —
  exactly where it was worth acting on. The dashboard's settings can change the
  configured model and API base URL, so an open one is arbitrary spend on the
  owner's key, not merely an analytics leak.
- **The dashboard renders in its own shell** (`position: fixed`, own background
  and scroll container) rather than inheriting the host page. Pass
  `shell: false` to `createPolishdPage()` for the old behaviour.

### Added

- **`npx @polishd/next doctor`** — checks the wiring that fails silently: the
  proxy named and exported for the installed Next major, `config.matcher` as an
  inline literal excluding `/api`, `runtime`/`dynamic` declared rather than
  re-exported, the stylesheet import, access posture, Node version.
  `--url <origin>` adds live checks that the cookie is minted and events store.
- **Built-in token auth.** Setting `POLISHD_DASHBOARD_TOKEN` is the whole
  integration for an app with no auth of its own — no import, no page edit. The
  token is exchanged for an httpOnly, path-scoped cookie by a server action, so
  it never appears in a URL, in history, in logs or in a `Referer` header. The
  cookie holds an HMAC rather than the token, comparison is constant-time,
  expiry is enforced server-side, and the unlock form is rate limited.
  `polishdTokenAuth()` is exported for hosts that want to configure it.
- **`dist/dashboard.css`** — the dashboard ships its own stylesheet, compiled at
  publish time. Tailwind is no longer required in the host app.
- **`composePolishd(handler, { matcher })`** — for apps that already have a
  proxy. Declaring the handler's original scope re-applies it as an internal
  guard, so widening `config.matcher` to the union doesn't silently start
  running your handler on every request in the app.
- **`authenticate` receives the request context** (`cookies`, `headers`), so
  callbacks are ordinary functions of their inputs and testable without a live
  request. Zero-argument callbacks keep working unchanged.
- **`POLISHD_SESSION_COOKIE`** — read by both the proxy and the ingest route, so
  renaming the cookie cannot go half-applied.

### Fixed

- **`--force` destroyed hand-written proxies.** Both the exists-guard and the
  merge hint were skipped under the flag, so a user who passed it to regenerate
  an unrelated file lost their real proxy wholesale. Generated files now carry a
  sentinel; files the CLI did not author are never overwritten, with or without
  `--force`, and its own files are backed up to `.bak` before regenerating.
- **The CLI ignored the installed Next major**, always writing `proxy.ts`. On
  Next 15 — a supported version — that file never runs: no session cookie, every
  beacon still 200, nothing stored, no error anywhere. It now resolves the
  installed version and picks the filename and exported function to match.
- **The merge hint keyed off the wrong filename**, so the Next 16 collision —
  the one that actually happens — got no guidance and only `--force` as a
  remedy, which was the data-loss bug above.
- **A missing session cookie is no longer silent.** Ingest records the rejection
  in `polishd_meta`, the dashboard shows a banner naming the expected proxy
  filename per Next major, and the client warns once in the dev console.
- **`--dry-run` under-reported**, omitting the `.gitignore` change.
- **`polishd.config.ts` was documented as being loaded automatically.** Nothing
  imports it; it cannot be auto-loaded, because the three consumers run in three
  runtimes and the Edge one has no filesystem. The docs now say what actually
  has to happen.

### Also

- Node `>= 22.5.0` is checked by the CLI rather than left to a confusing
  "cannot find module `node:sqlite`" at first request.
- `bin/` is included in the published files. npm auto-includes the bin entry but
  not the modules it imports, so the CLI would otherwise have shipped broken.
- Docs carry a paste-ready prompt pointing a coding agent at `AGENTS.md`, in the
  README, `docs/SETUP.md` and `polishd --help`.

## 0.1.0

Initial release.
