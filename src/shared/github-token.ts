/**
 * Polishd — the link that opens GitHub's new-token form already filled in
 * (pure; shared by the dashboard and, mirrored, by the CLI in bin/shared.mjs).
 *
 * GitHub can't mint a fine-grained token from the API or a CLI, but its
 * creation page takes the token's name, owner, lifetime and permissions as
 * query parameters. Everything Polishd needs is set, so the owner only picks
 * the repository — the one thing the URL can't carry — and presses Generate.
 */

/** What Polishd's GitHub calls need: read the source, file issues, link pull requests. */
export const GITHUB_TOKEN_PERMISSIONS = {
  contents: "read",
  issues: "write",
  pull_requests: "write",
} as const;

/** A year, the longest GitHub allows short of no expiry at all. */
const EXPIRES_IN_DAYS = 366;

/** GitHub caps a token's name at 40 characters. */
const NAME_MAX = 40;

/** The new fine-grained token form, prefilled for `repo` ("owner/name") when given. */
export function githubTokenUrl(repo?: string): string {
  const valid = repo && /^[\w.-]+\/[\w.-]+$/.test(repo) ? repo : undefined;
  const params = new URLSearchParams();
  params.set("name", (valid ? `Polishd ${valid}` : "Polishd").slice(0, NAME_MAX));
  params.set(
    "description",
    `Polishd reads the source, files issues and links fix pull requests${valid ? ` on ${valid}` : ""}. ` +
      `Under Repository access, pick only ${valid ?? "the site's repository"}.`,
  );
  // The owner is the one part of the repo the form can preselect.
  if (valid) params.set("target_name", valid.split("/")[0]);
  params.set("expires_in", String(EXPIRES_IN_DAYS));
  for (const [permission, level] of Object.entries(GITHUB_TOKEN_PERMISSIONS)) {
    params.set(permission, level);
  }
  return `https://github.com/settings/personal-access-tokens/new?${params}`;
}
