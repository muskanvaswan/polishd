/**
 * Polishd — the build the client bundle was made from.
 *
 * Read from variables Next inlines at build time. `process.env.NEXT_PUBLIC_*`
 * is replaced textually, member expression by member expression, wherever it
 * appears in the compiled bundle — this package's code included — so each
 * read below has to be spelled out in full; a loop over key names would
 * survive to the browser and find nothing.
 *
 *   • `NEXT_PUBLIC_POLISHD_BUILD` — set it to anything: the commit, a version,
 *     a date. `NEXT_PUBLIC_POLISHD_BUILD=$COMMIT_REF next build` works on
 *     every host.
 *   • `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA` — Vercel sets it when system
 *     environment variables are exposed (the default for new projects).
 *   • `NEXT_DEPLOYMENT_ID` — Next's `deploymentId` config, when the host uses
 *     it. Changes on every deploy, so it's last: a redeploy of the same
 *     commit reads as a new build.
 *
 * An explicit `build` in the config always wins (see init.ts). When nothing
 * is set the batch carries no build and ingest stamps the server's instead.
 */
import { sanitizeBuild } from "../shared/build";

/** The bundle's build label, or null when the build didn't say. */
export function detectClientBuild(): string | null {
  // Guarded for a bundler that leaves `process` undefined in the browser —
  // the inlined values below are then whatever it did replace, if anything.
  if (typeof process === "undefined" || !process.env) return null;
  return (
    sanitizeBuild(process.env.NEXT_PUBLIC_POLISHD_BUILD) ??
    sanitizeBuild(process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA) ??
    sanitizeBuild(process.env.NEXT_DEPLOYMENT_ID)
  );
}
