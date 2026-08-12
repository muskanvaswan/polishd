# Changelog

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
