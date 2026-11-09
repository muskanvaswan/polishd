/**
 * Tests for when the dashboard opens on the first-time setup, against a real
 * SQLite store.
 *
 * Run with `npm test`. Each run writes a throwaway database file; a
 * configured Postgres is never touched. A fresh install lands on Settings
 * until a model is connected — saved or from env — or the owner skips it.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

for (const key of Object.keys(process.env)) {
  if (/^(POLISHD|BUFFD)_(DATABASE_URL|AI_|GITHUB_)/.test(key)) delete process.env[key];
}
process.env.POLISHD_DB_PATH = join(mkdtempSync(join(tmpdir(), "polishd-onboarding-")), "test.db");

const { needsOnboarding, saveAISettings, skipOnboarding } = await import("./settings.ts");
const { setMeta } = await import("../server/store.ts");

test("a fresh install opens on the setup", async () => {
  assert.equal(await needsOnboarding(), true);
});

test("site details alone don't end it: there is still no model", async () => {
  await saveAISettings({ context: "A notes site", githubRepo: "acme/site" });
  assert.equal(await needsOnboarding(), true);
});

test("a key from env ends it, as it hides the wizard", async () => {
  await setMeta("ai_settings", "{}");
  process.env.POLISHD_AI_API_KEY = "sk-from-env";
  try {
    assert.equal(await needsOnboarding(), false);
  } finally {
    delete process.env.POLISHD_AI_API_KEY;
  }
  assert.equal(await needsOnboarding(), true);
});

test("a saved key ends it", async () => {
  await saveAISettings({ apiKey: "sk-saved" });
  assert.equal(await needsOnboarding(), false);
  await setMeta("ai_settings", "{}");
  assert.equal(await needsOnboarding(), true);
});

test("skipping ends it, and stays skipped", async () => {
  await skipOnboarding();
  assert.equal(await needsOnboarding(), false);
  assert.equal(await needsOnboarding(), false);
});
