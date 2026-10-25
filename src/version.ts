/**
 * Polishd — the package version, as a constant.
 *
 * Bundled code can't read its own `package.json` reliably: a host's bundler
 * may inline it whole, or leave it out of the deployment. So the version is
 * written here instead, by `scripts/sync-version.mjs`, which `npm version`
 * runs (the `version` lifecycle script) and stages into the release commit.
 * `version.test.ts` fails if the two ever disagree.
 */
export const POLISHD_VERSION = "0.2.3-dev.24";
