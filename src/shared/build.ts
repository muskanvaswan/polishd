/**
 * Polishd — build identifiers.
 *
 * Every stored event names the build of the site it was captured on: a git
 * commit sha where one is known, otherwise whatever label the host gave its
 * deployment. The label travels once per batch (`PolishdIngestBody.build`)
 * and is stamped on every row, so the dashboard can scope its figures to a
 * build and the Design tab can tell a scan of the current build from one of
 * the build before it.
 *
 * Pure and shared: the client sends labels, ingest sanitizes them, the
 * dashboard shortens them for display. Nothing here knows where a label came
 * from — see client/build.ts and server/build.ts for detection.
 */

/**
 * What a build label may look like: a sha, a version, a tag, a date, or a
 * `branch@sha` pair. Long enough for a full sha with room to spare, and
 * limited to characters that are safe to inline in SQL, a URL and a class
 * name — ingest drops anything else rather than guessing at it.
 */
const BUILD_RE = /^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,79}$/;

/** A full hex sha, as git prints it (12+ hex characters). */
const SHA_RE = /^[0-9a-f]{12,}$/i;

/** A build label as a client or environment supplied it, or null to drop it. */
export function sanitizeBuild(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return BUILD_RE.test(value) ? value : null;
}

/**
 * The label as the dashboard shows it: a sha to its first seven characters,
 * anything else as-is up to a readable length.
 */
export function shortBuild(build: string): string {
  if (SHA_RE.test(build)) return build.slice(0, 7);
  return build.length > 24 ? `${build.slice(0, 23)}…` : build;
}
