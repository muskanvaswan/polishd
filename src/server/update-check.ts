/**
 * Polishd — the dashboard's update check (server only).
 *
 * Compares the version compiled into this app's bundle with the registry's
 * `latest` (and, for an install already on a dev build, `dev`) tags, and hands
 * the dashboard what it needs to say so: the versions, and the exact command
 * for this app's package manager.
 *
 * What it costs: one ~40-byte GET to registry.npmjs.org, at most every six
 * hours per server process (an hour after a failure, so an offline box doesn't
 * retry on every render), and never on the render's critical path — the
 * notice streams in behind its own Suspense boundary. It sends nothing about
 * the app; the registry sees a request for a public package's tags.
 *
 * Off with `POLISHD_UPDATE_CHECK=off`, or `NO_UPDATE_NOTIFIER`.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

import { POLISHD_VERSION } from "../version";
import {
  LOCKFILES,
  fetchDistTags,
  installCommand,
  packageManagerFromUserAgent,
  pickUpdate,
  updateCheckDisabled,
  type PolishdDistTags,
  type PolishdPackageManager,
  type PolishdUpdate,
} from "../shared/update-check";

const FRESH_MS = 6 * 3_600_000;
const RETRY_MS = 3_600_000;

let cached: { tags: PolishdDistTags | null; until: number } | null = null;
let inflight: Promise<PolishdDistTags | null> | null = null;

/** Memoized per process; concurrent renders share one request. */
function distTags(): Promise<PolishdDistTags | null> {
  if (cached && Date.now() < cached.until) return Promise.resolve(cached.tags);
  inflight ??= fetchDistTags().then((tags) => {
    cached = { tags, until: Date.now() + (tags ? FRESH_MS : RETRY_MS) };
    inflight = null;
    return tags;
  });
  return inflight;
}

let manager: PolishdPackageManager | null = null;

/**
 * The nearest lockfile up from the app's root — monorepos keep it at the
 * workspace root — then whatever manager launched the server, then npm.
 * Production bundles usually ship without a lockfile, which is why the
 * fallbacks exist; the owner reading the notice is almost always in dev.
 */
function packageManager(): PolishdPackageManager {
  if (manager) return manager;
  for (let dir = process.cwd(); ; dir = dirname(dir)) {
    const hit = LOCKFILES.find(([file]) => existsSync(join(dir, file)));
    if (hit) return (manager = hit[1]);
    if (dirname(dir) === dir) break;
  }
  return (manager = packageManagerFromUserAgent(process.env.npm_config_user_agent) ?? "npm");
}

export interface PolishdUpdateNotice extends PolishdUpdate {
  /** The install command, spelled for this app's package manager. */
  command: string;
}

/** A newer release to tell the owner about, or null — including on any failure. */
export async function loadPolishdUpdate(): Promise<PolishdUpdateNotice | null> {
  if (updateCheckDisabled(process.env)) return null;
  const tags = await distTags();
  const update = tags ? pickUpdate(POLISHD_VERSION, tags) : null;
  if (!update) return null;
  return { ...update, command: installCommand(packageManager(), update.tag) };
}
