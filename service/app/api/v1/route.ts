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
 */
import { SNAPSHOT_PROTOCOL_VERSION } from "../../../../src/capture/protocol.ts";
import { browserPool, probeBrowser } from "../../../lib/browser.ts";
import { loadConfig } from "../../../lib/config.ts";
import { CORS_HEADERS, json } from "../../../lib/http.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** The probe may wait for a slot, then launch a browser, then shoot: well inside this. */
export const maxDuration = 30;

const config = loadConfig();

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(): Promise<Response> {
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
