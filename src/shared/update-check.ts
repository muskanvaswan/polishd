/**
 * Polishd — "is there a newer @polishd/next?", decided without a dependency.
 *
 * Why ask at all: `npm install` never moves an installed version. The lockfile
 * pins it, and below 1.0 the `^0.x.y` range npm saves stops at the next minor,
 * so even `npm update` can't reach most releases. Left alone, an install stays
 * on whatever version it first got, indefinitely.
 *
 * Shared by the dashboard (server side) and `npx @polishd/next doctor`. The CLI
 * is plain Node with no build step of its own, so it loads the *compiled* copy
 * of this file straight out of `dist/` — which only works while this module
 * imports nothing, because the build emits extensionless relative specifiers
 * Node can't resolve. Keep it import-free; a test holds that line.
 */

export const POLISHD_PACKAGE = "@polishd/next";

/** The package's dist-tags — about 40 bytes, e.g. `{"latest":"0.2.2","dev":"0.2.3-dev.7"}`. */
export const DIST_TAGS_URL = "https://registry.npmjs.org/-/package/@polishd/next/dist-tags";

export const CHANGELOG_URL = "https://github.com/muskanvaswan/polishd/blob/main/CHANGELOG.md";

export type PolishdDistTags = Record<string, string>;

export interface PolishdUpdate {
  /** The version installed here. */
  current: string;
  /** The newer version on offer. */
  version: string;
  /** The dist-tag it is published under — what the install command names. */
  tag: "latest" | "dev";
}

// ── Versions ─────────────────────────────────────────────────────────────────

interface ParsedVersion {
  core: [number, number, number];
  /** Prerelease identifiers (`dev.7` → ["dev", "7"]); empty for a release. */
  pre: string[];
}

export function parseVersion(v: string): ParsedVersion | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(v.trim());
  if (!m) return null;
  return {
    core: [Number(m[1]), Number(m[2]), Number(m[3])],
    pre: m[4] ? m[4].split(".") : [],
  };
}

function compareCore(a: ParsedVersion["core"], b: ParsedVersion["core"]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** Semver §11: numeric ids numerically, below alphanumeric ones; a release outranks its prereleases. */
function compareParsed(a: ParsedVersion, b: ParsedVersion): number {
  const core = compareCore(a.core, b.core);
  if (core !== 0) return core;
  if (a.pre.length === 0 || b.pre.length === 0) return b.pre.length - a.pre.length;
  for (let i = 0; i < Math.min(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i];
    const y = b.pre[i];
    if (x === y) continue;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) return Number(x) - Number(y);
    if (xn !== yn) return xn ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return a.pre.length - b.pre.length;
}

/** Negative when a < b, zero when equal, positive when a > b; null if either isn't a version. */
export function compareVersions(a: string, b: string): number | null {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  return pa && pb ? compareParsed(pa, pb) : null;
}

/**
 * The release this install should move to, or null when it is current.
 *
 * Someone on a stable release is only ever offered stable releases. Someone
 * already running a dev build opted into that channel, so a newer dev build
 * counts for them too — and a stable release that has overtaken their build
 * wins outright, since it is the same code, finished.
 */
export function pickUpdate(current: string, tags: PolishdDistTags): PolishdUpdate | null {
  const installed = parseVersion(current);
  if (!installed) return null;
  const channels: PolishdUpdate["tag"][] = installed.pre.length > 0 ? ["latest", "dev"] : ["latest"];

  let best: PolishdUpdate | null = null;
  for (const tag of channels) {
    const version = tags[tag];
    if (typeof version !== "string") continue;
    // `latest` is checked first, so on a tie it is the one recommended.
    if (!((compareVersions(version, current) ?? 0) > 0)) continue;
    if (best && !((compareVersions(version, best.version) ?? 0) > 0)) continue;
    best = { current, version, tag };
  }
  return best;
}

/**
 * Whether a package.json range lets `npm update` reach `version`: true, false,
 * or null for range syntax this doesn't model (a `||` union, a git URL, …).
 *
 * Only the shapes package managers actually write are modelled — an exact pin,
 * `^`, `~`, and the any-version forms — because the point is to explain why an
 * update didn't happen, not to reimplement semver ranges.
 */
export function rangeAdmits(range: string, version: string): boolean | null {
  const target = parseVersion(version);
  if (!target) return null;
  const r = range.trim();
  // Tags and wildcards skip prereleases, as npm's own resolution does.
  if (r === "" || r === "*" || r === "latest") return target.pre.length === 0;

  const pinned = parseVersion(r.replace(/^=/, ""));
  if (pinned) return compareParsed(pinned, target) === 0;

  const op = r[0];
  const floor = op === "^" || op === "~" ? parseVersion(r.slice(1)) : null;
  if (!floor) return null;
  if (compareParsed(target, floor) < 0) return false;
  // A prerelease only satisfies a range whose own bound is a prerelease of the
  // same version — `^0.2.2` never resolves to `0.2.3-dev.1`.
  if (target.pre.length > 0 && !(floor.pre.length > 0 && compareCore(floor.core, target.core) === 0)) {
    return false;
  }
  const [major, minor, patch] = floor.core;
  const ceiling: ParsedVersion["core"] =
    op === "~" ? [major, minor + 1, 0]
    : major > 0 ? [major + 1, 0, 0]
    // Below 1.0 the caret narrows: `^0.2.2` is <0.3.0, `^0.0.3` is <0.0.4.
    : minor > 0 ? [0, minor + 1, 0]
    : [0, 0, patch + 1];
  return compareCore(target.core, ceiling) < 0;
}

// ── Package managers ─────────────────────────────────────────────────────────

export type PolishdPackageManager = "npm" | "pnpm" | "yarn" | "bun";

/** Checked in order in each directory; the first present names the manager. */
export const LOCKFILES: [file: string, manager: PolishdPackageManager][] = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["package-lock.json", "npm"],
  ["npm-shrinkwrap.json", "npm"],
];

/** From `npm_config_user_agent`, which every manager sets on the scripts it runs. */
export function packageManagerFromUserAgent(ua: string | undefined): PolishdPackageManager | null {
  const name = ua?.split("/")[0];
  return name === "npm" || name === "pnpm" || name === "yarn" || name === "bun" ? name : null;
}

/** The command that moves an install onto `tag`, rewriting its saved range as it goes. */
export function installCommand(pm: PolishdPackageManager, tag: PolishdUpdate["tag"]): string {
  const spec = `${POLISHD_PACKAGE}@${tag}`;
  return pm === "npm" ? `npm install ${spec}` : `${pm} add ${spec}`;
}

/** The manager's update-within-range command, for explaining why it didn't help. */
export function updateCommand(pm: PolishdPackageManager): string {
  return pm === "yarn" ? "yarn upgrade" : `${pm} update`;
}

// ── The check itself ─────────────────────────────────────────────────────────

/**
 * `POLISHD_UPDATE_CHECK=off` (or 0/false/no), or the `NO_UPDATE_NOTIFIER`
 * convention that npm and most CLIs honour.
 */
export function updateCheckDisabled(env: Record<string, string | undefined>): boolean {
  const flag = env.POLISHD_UPDATE_CHECK;
  if (flag !== undefined && /^(0|false|off|no)$/i.test(flag.trim())) return true;
  return env.NO_UPDATE_NOTIFIER !== undefined;
}

/**
 * Fetch the package's dist-tags. Never throws: offline, a firewalled server,
 * or a slow registry all come back as null, and callers stay quiet about it.
 */
export async function fetchDistTags(timeoutMs = 2500): Promise<PolishdDistTags | null> {
  try {
    const res = await fetch(DIST_TAGS_URL, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    if (!body || typeof body !== "object") return null;
    const tags: PolishdDistTags = {};
    for (const [tag, version] of Object.entries(body)) {
      if (typeof version === "string") tags[tag] = version;
    }
    return tags;
  } catch {
    return null;
  }
}
