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

`GET /api/v1` reports the configured limits and whether the limiter is up.

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

The global cap exists to protect the plan's included compute. On Vercel Hobby,
about 4 active-CPU hours a month covers roughly 4–7k shots (an estimate:
measure, then tune). Note that Hobby is for non-commercial use.

**On Vercel the service refuses work without Redis** (HTTP 503), because
per-instance memory isn't a limit once requests fan out. `SHOTS_LIMITER=memory`
overrides that on purpose. Locally an in-memory limiter is used.

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
   `"ok": true, "limiter": "redis"`.

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
origin parsing, limits).
