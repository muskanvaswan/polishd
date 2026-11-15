# polishd-shots

The screenshot service behind `@polishd/next`'s **site snapshots**. A
dashboard running in a site owner's browser POSTs one route at a time here;
the service shoots that route on the site the browser is on (its `Origin`)
and returns WebP images. It never stores or logs them.

This is a separate Next.js app, deployed as its own Vercel project. It shares
the capture core with the package (`../src/capture/`), so the local-Chrome
path a dashboard falls back to on `localhost` and this service produce the
same shots.

## API (v1)

`POST /api/v1/shoot`. CORS allows any origin, without credentials. The
contract is defined in [`src/capture/protocol.ts`](../src/capture/protocol.ts).

```jsonc
// request — the site comes from the Origin header, never the body
{ "route": "/pricing", "device": "desktop", "theme": "light",
  "find": [{ "key": "radius:7px", "ref": { "kind": "radius", "value": "7px" } }] }
// or lists: { "routes": ["/", "/about"], "devices": ["phone"], "themes": ["light", "dark"] }

// response
{ "v": 1, "origin": "https://example.com",
  "shots": [{ "route": "/pricing", "device": "desktop", "theme": "light",
              "image": { "type": "image/webp", "width": 1440, "height": 4210, "data": "<base64>" },
              "hash": "…", "title": "Pricing", "status": 200,
              "previews": [{ "key": "radius:7px", "image": { … } }], "looked": ["radius:7px"] }] }

// errors
{ "v": 1, "error": { "code": "rate_limited", "message": "…", "scope": "origin", "retryAfter": 1800 } }
```

| | |
|---|---|
| Caps | 4 routes per request, phone/desktop × light/dark, 16 values to find |
| Response | Kept under ~4.2 MB (Vercel's limit is 4.5 MB). Quality steps down, then resolution. A shot that still doesn't fit returns `reason: "budget"`, to be requested on its own |
| Skips | `auth_wall`, `off_origin`, `protected` (Vercel's login), `bot_check`, `http_error`, `timeout`, `budget`, `failed` |
| Versioning | In the path. v1 only ever gains optional fields. A breaking change ships as `/api/v2` beside v1, and v1 stays up while released packages still call it |

`GET /api/v1` reports the configured limits, whether the limiter is up, and
`browser`: `ok` once a blank page has been opened and screenshotted on the
instance's browser, `wedged` when it couldn't be (that browser is retired on
the spot), `busy` when every capture slot was taken for the whole wait, or
`unavailable` when none could be launched. `pool` carries the counts behind
that. Point a monitor at `browser`, not `ok`: `ok` checks only the limiter,
and stayed true through a whole outage.

## What it will and won't shoot

- **Only the calling origin.** It comes from the browser-set `Origin` header.
  A non-browser caller can send any `Origin`, which is accepted: only public
  pages are reachable anyway, and the rate limits bound it.
- **Only public addresses.** Chromium's only way out is an in-process HTTP
  proxy ([`lib/proxy.ts`](./lib/proxy.ts)) with loopback not bypassed. For
  every connection (page, subresource, each redirect hop, WebSocket), the
  proxy resolves DNS itself, refuses unless *every* address is public
  ([`lib/net.ts`](./lib/net.ts)), and dials the exact address it checked.
  Refused: private, loopback, link-local and metadata (169.254.169.254,
  `fd00:ec2::254`, `metadata.google.internal`), CGNAT, multicast, reserved,
  documentation ranges, 6to4/Teredo/NAT64, and ports other than 80/443.
  WebRTC's direct UDP is disabled and Chromium resolves no names itself.
- **Navigation stays on the origin.** A script or click that navigates off the
  origin is answered `204`, so the page stays put. An HTTP redirect off the
  origin means no pixels; the response says where it went.
- **Its own analytics stay clean.** A site's `@polishd/next` beacons are
  answered locally, so captures never count as visits.

## Rate limits

Counted in shots (route × device × theme), in Upstash Redis over REST:

| Scope | Default | Env |
|---|---|---|
| per caller IP | 300 / hour | `SHOTS_LIMIT_IP_PER_HOUR` |
| per target site | 150 / hour | `SHOTS_LIMIT_ORIGIN_PER_HOUR` |
| everyone | 200 / day | `SHOTS_LIMIT_GLOBAL_PER_DAY` |

A full capture is up to 48 shots (12 routes × 2 devices × 2 themes). Keys hold
only the hostname or a hash of the IP, plus the window number, and expire
with the window.

On top of the shot limits, **a site gets two full captures a week**
(`SHOTS_CAPTURES_PER_WEEK`; `off` removes the limit). This one is about cost
rather than abuse ([`lib/captures.ts`](./lib/captures.ts)). A capture reaches
the service as forty-odd requests, so it's counted at the door: the first
full-page request from a site opens a capture and spends one of its week's,
and every request in the next twenty minutes belongs to it — a retry
included. A third capture is refused whole, as `rate_limited` with scope
`origin` and a `retryAfter` that runs to the end of the week (weeks are
counted from the epoch, so they turn on Thursday 00:00 UTC); the dashboard
says the site is being limited and when to try again. First-screen requests
(`viewport`), which are the design review's, aren't counted.

The global cap exists to protect the plan's included compute. On Vercel Hobby,
about 4 active-CPU hours a month covers roughly 4–7k shots (an estimate:
measure, then tune). Note that Hobby is for non-commercial use.

**On Vercel the service refuses work without Redis** (HTTP 503), because
per-instance memory isn't a limit once requests fan out. `SHOTS_LIMITER=memory`
overrides that on purpose. Locally an in-memory limiter is used.

## The browser

One Chromium per function instance, shared by the captures on it
([`lib/pool.ts`](./lib/pool.ts)), `SHOTS_MAX_CONCURRENT` of them at once
(default 2: a dashboard's own pair of requests run together, a third caller
waits). `@sparticuz/chromium` runs it single-process, so every context's
renderer and the GPU share one process whose sockets, descriptors and memory
accumulate across requests — and a browser that has run out stays alive and
connected, failing every shot in under a second with
`net::ERR_INSUFFICIENT_RESOURCES` (sometimes "Target page, context or browser
has been closed", or `Page.captureScreenshot: Unable to capture screenshot`
on a tall page). So a browser is never kept for good. It is replaced:

- **when a shot hits one of those faults.** The capture retires it, takes a
  fresh one and tries the shot once more; everything already shot is kept. A
  cell that fails even on the fresh browser says "the screenshot service's
  browser had to be replaced — try this page again".
- **after `SHOTS_BROWSER_MAX_SHOTS` shots** (24), or when its process is over
  `SHOTS_BROWSER_MAX_RSS_MB` (768) or `SHOTS_BROWSER_MAX_FDS` (700), read from
  `/proc` whenever a capture takes it.
- **when `GET /api/v1`'s probe fails**, which is why a monitor on that route
  also heals the instance it lands on.

A retired browser closes once the last capture on it finishes (killed after
five seconds if closing hangs), and its proxy with it. `[shots] browser #n
retired after k shots: …` in the function logs says why each one went. If
replacements come thick and fast, the instance is short of memory for the
concurrency it's given: lower `SHOTS_MAX_CONCURRENT`, or raise the
function's memory.

All of that is the **function engine**, the default: Chromium inside the
function that answers the request. The sandbox engine below is the way out
of it.

## The sandbox engine

`SHOTS_ENGINE=sandbox` moves Chromium out of the function and into a
[Vercel Sandbox](https://vercel.com/docs/sandbox), a small VM. The function
still answers the same API; it writes each request into the sandbox as a job,
runs the capture worker there ([`sandbox/worker.ts`](./sandbox/worker.ts)) and
reads the shots back ([`lib/sandbox.ts`](./lib/sandbox.ts)). The worker is
this service's own code — the same proxy, guard and capture core — so the
shots are the same. What changes:

- **A real browser.** Playwright's multi-process Chromium, launched for the
  job and gone with it. Nothing is shared between jobs, so there is nothing
  to wear out, and the pool above isn't used.
- **No secrets in reach.** The sandbox has none of the function's
  environment; the Redis token never shares a process with a page.
- **Its own meter.** Sandbox time is billed apart from function time: active
  CPU, and memory for as long as a sandbox is up, idle or not.

Measured on 2026-11-15 against a long landing page (full page, cut at the
12,000 px cap), two jobs at a time on 2 vCPUs: a sandbox is up in about 1.5
seconds, a shot takes 5–7 seconds, and costs about 5 seconds of active CPU
and 1 MB of transfer. Lighter pages cost less.

What that comes to depends on the plan the project is on:

- **Pro** has no free sandbox allowance: usage draws on the plan's monthly
  credit at $0.128 per active-CPU hour and $0.0212 per GB-hour of memory
  (transfer is included). A full capture of 48 such shots is about 4 minutes
  of CPU and a 4 GB sandbox up for about 5, so roughly 1.6 cents; the image
  is another 9 cents a month to store. `SHOTS_LIMIT_GLOBAL_PER_DAY` is the
  ceiling on the whole bill — at the default 200 shots a day, about $2 a
  month — and the weekly capture limit is the ceiling per site, about 15
  cents a month.
- **Hobby** includes 5 active-CPU hours, 420 GB-hours of memory and 5,000
  sandbox starts a month, and refuses new sandboxes (it doesn't bill) once
  they're used. CPU runs out first: about 3,600 such shots a month, some 120
  a day, which is below the default daily cap — lower it to match.

One sandbox per function instance, kept while requests keep coming: it
starts with `SHOTS_SANDBOX_TIMEOUT_MIN` (3) to live, gets two more whenever a
job finds it within 75 seconds of the end, and stops by itself when they stop
coming. Short on purpose — its memory is paid for until it stops.
`SHOTS_MAX_CONCURRENT` jobs run in it at once, each with its own browser, so
size it with `SHOTS_SANDBOX_VCPUS` (2, and 2 GB of memory each; Hobby allows
4). A sandbox that has gone, can't be extended (Hobby sessions end at 45
minutes) or fails a job is replaced, and that job is tried once more.
`[shots] sandbox #n dropped: …` in the function logs says why.

A sandbox that stops stays listed on the project. Each new one deletes the
stopped records of the ones before it (those tagged `service=polishd-shots`,
which is every sandbox this service starts); the image is untouched.

### The image

A sandbox starts from a snapshot that already has Chromium, its system
libraries and a copy of the capture code:

```bash
cd service
vercel link          # once: the service's Vercel project
vercel env pull      # a 12-hour token in .env.local
npm run sandbox:build
```

It takes a few minutes: it installs everything in a fresh sandbox, shoots
`https://example.com` there as a test, and prints the snapshot id. Set that
as `SHOTS_SANDBOX_SNAPSHOT_ID`, set `SHOTS_ENGINE=sandbox`, and redeploy.
The snapshot never expires and counts against the plan's snapshot storage
(15 GB on Hobby); pass `--delete <old id>` on the next build to remove the
one it replaces.

**Rebuild the image whenever the capture code changes** (`lib/`,
`../src/capture/`, `sandbox/`). The image holds a copy; deploying the
function doesn't update it. An image too old to understand a job says so in
the error, and `GET /api/v1` shows it as `browserDetail`.

To go back, unset `SHOTS_ENGINE`. Nothing else changes: the function engine
is still there.

`GET /api/v1` reports `"engine": "sandbox"`. It doesn't start a sandbox to
check — a monitor's pings would spend the month's sandbox starts — so
`browser` is `ok` until a job fails for a reason of the sandbox's, then
`unavailable` with the reason, until a job succeeds again.

## Deploying

1. New Vercel project from this repository, **Root Directory `service`**.
   Leave "Include files outside the root directory" on, since the capture core
   lives in `../src/capture`. Node 22+.
2. Storage → Marketplace → **Upstash Redis**, connected to the project. It
   injects `KV_REST_API_URL` / `KV_REST_API_TOKEN`; `UPSTASH_REDIS_REST_URL` /
   `UPSTASH_REDIS_REST_TOKEN` work too. Optionally tune the limits above.
3. Domain: `shots.polishd.muskanvaswan.xyz`, the URL released packages call
   (`SNAPSHOT_SERVICE_URL` in `src/capture/protocol.ts`).
4. Check `GET https://shots.polishd.muskanvaswan.xyz/api/v1` reports
   `"ok": true, "limiter": "redis", "browser": "ok"`.
5. Optional: switch to the sandbox engine (above).

No other secrets: the service holds no credentials for any site.

`next.config.ts` carries what the browser needs on Vercel:
`outputFileTracingIncludes` for `playwright-core/browsers.json` and
`@sparticuz/chromium/bin/**`, which Next's tracing can't see, and
`serverExternalPackages` for both. Turbopack and tracing are rooted at the
repository so `../src/capture` resolves. The browser is chosen from the
environment at runtime (`VERCEL`) rather than `process.platform`, which
Turbopack bakes in at build time.

## Running locally

```bash
cd service && npm install
SHOTS_ALLOW_LOOPBACK=1 npm run dev     # http://localhost:4100
```

`SHOTS_ALLOW_LOOPBACK=1` lets it shoot a site on this machine (any port),
while every other private range stays blocked. It's ignored on Vercel. Uses
your installed Chrome, or Playwright's Chromium.

To point a local app's dashboard at it, set this in the app's environment:

```bash
POLISHD_SNAPSHOT_SERVICE=http://localhost:4100/api/v1
```

Tests run with the package's: `npm test` at the repository root covers
`service/lib/**/*.test.ts` (address blocking, the proxy over real sockets,
origin parsing, limits, the browser pool's recycling and replacement, and
the sandbox engine's reuse, extension, replacement and retry — against a
fake sandbox; the image build's test shot is the check against a real one).
