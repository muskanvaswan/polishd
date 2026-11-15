/**
 * GET /api/v1 — what this service is, how it's limited, and whether its
 * browser works.
 *
 * `ok` is the limiter check it always was: whether the service takes work at
 * all. `browser` is new, and the one to watch: a blank page is opened and
 * screenshotted on this instance's pooled browser, which is exactly what
 * failed for a whole afternoon while `ok` stayed true. A wedged browser found
 * this way is retired on the spot, so a monitor hitting this route also
 * heals the instance it lands on.
 *
 * With the sandbox engine there's no browser on this instance to probe, and
 * starting a sandbox for every monitor ping would spend the plan's sandbox
 * creations on nothing. `browser` then reports what the last job found:
 * `ok` until one fails for a reason of the sandbox's, `unavailable` after
 * that (or with no image configured), with the reason in `browserDetail`.
 */
import { SNAPSHOT_PROTOCOL_VERSION } from "../../../../src/capture/protocol.ts";
import { browserPool, probeBrowser } from "../../../lib/browser.ts";
import { loadConfig } from "../../../lib/config.ts";
import { CORS_HEADERS, json } from "../../../lib/http.ts";
import { sandboxEngine } from "../../../lib/sandbox.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** The probe may wait for a slot, then launch a browser, then shoot: well inside this. */
export const maxDuration = 30;

const config = loadConfig();

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

function sandboxHealth(): Response {
  const stats = sandboxEngine(config).stats();
  const detail = config.sandbox.snapshotId ? stats.lastError : "no sandbox image configured";
  return json({
    v: SNAPSHOT_PROTOCOL_VERSION,
    service: "polishd-shots",
    ok: config.limiter !== null,
    limiter: config.limiter?.kind ?? "none",
    limits: Object.fromEntries(
      config.rules.map((r) => [r.scope, { shots: r.limit, windowSeconds: r.windowSec }]),
    ),
    captures: config.captures ? { perSitePerWeek: config.captures.perWeek } : null,
    engine: "sandbox",
    browser: detail ? "unavailable" : "ok",
    ...(detail ? { browserDetail: detail } : {}),
    sandbox: {
      up: stats.up,
      active: stats.active,
      waiting: stats.waiting,
      created: stats.created,
      limits: {
        concurrent: config.browser.maxConcurrent,
        vcpus: config.sandbox.vcpus,
        idleMinutes: Math.round(config.sandbox.timeoutMs / 60_000),
      },
    },
  });
}

export async function GET(): Promise<Response> {
  if (config.engine === "sandbox") return sandboxHealth();
  const probe = await probeBrowser(config);
  const stats = browserPool(config).stats();
  return json({
    v: SNAPSHOT_PROTOCOL_VERSION,
    service: "polishd-shots",
    ok: config.limiter !== null,
    limiter: config.limiter?.kind ?? "none",
    limits: Object.fromEntries(
      config.rules.map((r) => [r.scope, { shots: r.limit, windowSeconds: r.windowSec }]),
    ),
    captures: config.captures ? { perSitePerWeek: config.captures.perWeek } : null,
    engine: "function",
    browser: probe.state,
    ...(probe.detail ? { browserDetail: probe.detail } : {}),
    pool: {
      probeMs: probe.ms,
      active: stats.active,
      waiting: stats.waiting,
      launched: stats.launched,
      ...(stats.browser
        ? { shots: stats.browser.shots, ageSeconds: Math.round(stats.browser.ageMs / 1000) }
        : {}),
      limits: {
        concurrent: config.browser.maxConcurrent,
        shots: config.browser.maxShots,
        rssMb: Math.round(config.browser.maxRssBytes / 1_048_576),
        fds: config.browser.maxFds,
      },
    },
  });
}
