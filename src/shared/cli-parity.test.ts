/**
 * The CLI ships as plain Node with no build step, so it carries its own copies
 * of three things the package also defines: the GitHub token link, the Fix
 * workflow, and the keys polishd.defaults.json may hold. These tests keep each
 * pair identical, so `init` never writes what the dashboard reads differently.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { recommendedWorkflow } from "../ai/dispatch-readiness.ts";
import { DEFAULTS_FIELDS, DEFAULTS_SECRETS } from "../ai/settings.ts";
import { githubTokenUrl } from "./github-token.ts";
import { POLISHD_TABLES } from "./store-tables.ts";

// Loaded by URL: the CLI is untyped JavaScript, and this names what's used.
const cli = (await import(new URL("../../bin/shared.mjs", import.meta.url).href)) as {
  githubTokenUrl(repo?: string): string;
  recommendedWorkflow(secret: "oauth-token" | "api-key"): string;
  DEFAULTS_KEYS: Record<string, string[]>;
  DEFAULTS_SECRET_KEYS: string[];
  POLISHD_TABLES: Record<string, string[]>;
};

test("the GitHub token link is the same in both", () => {
  for (const repo of ["acme/notes", "a-very-long-organisation-name/and-a-long-repo", undefined, "not a repo"]) {
    assert.equal(cli.githubTokenUrl(repo), githubTokenUrl(repo), String(repo));
  }
});

test("the link asks for exactly what Polishd's calls need, under GitHub's name limit", () => {
  const url = new URL(githubTokenUrl("a-very-long-organisation-name/and-a-long-repo"));
  assert.equal(url.origin + url.pathname, "https://github.com/settings/personal-access-tokens/new");
  assert.ok((url.searchParams.get("name") ?? "").length <= 40);
  assert.equal(url.searchParams.get("target_name"), "a-very-long-organisation-name");
  assert.equal(url.searchParams.get("contents"), "read");
  assert.equal(url.searchParams.get("issues"), "write");
  assert.equal(url.searchParams.get("pull_requests"), "write");
  assert.equal(new URL(githubTokenUrl()).searchParams.get("target_name"), null);
});

test("init writes the workflow the Fix card recommends", () => {
  assert.equal(cli.recommendedWorkflow("oauth-token"), recommendedWorkflow({ secret: "oauth-token" }));
  assert.equal(cli.recommendedWorkflow("api-key"), recommendedWorkflow({ secret: "api-key" }));
});

test("doctor knows the same defaults keys and secrets the package reads", () => {
  const fromPackage = Object.fromEntries(
    Object.entries(DEFAULTS_FIELDS).map(([section, fields]) => [section, Object.keys(fields)]),
  );
  assert.deepEqual(cli.DEFAULTS_KEYS, fromPackage);
  assert.deepEqual([...cli.DEFAULTS_SECRET_KEYS].sort(), Object.keys(DEFAULTS_SECRETS).sort());
});

test("db check and the store agree on which tables are Polishd's", () => {
  assert.deepEqual(cli.POLISHD_TABLES, POLISHD_TABLES);
});
