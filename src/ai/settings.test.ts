/**
 * Tests for the settings blob's fix-dispatch choices, against a real SQLite
 * store.
 *
 * Run with `npm test`. Each run writes a throwaway database file; a
 * configured Postgres is never touched. The choices are stored only — nothing
 * dispatches yet — so what matters is that they round-trip exactly, that the
 * defaults hold when nothing is saved, and that the public view the card
 * reads carries no secret.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

for (const key of Object.keys(process.env)) {
  if (/^(POLISHD|BUFFD)_(DATABASE_URL|AI_|GITHUB_)/.test(key)) delete process.env[key];
}
process.env.POLISHD_DB_PATH = join(mkdtempSync(join(tmpdir(), "polishd-settings-")), "test.db");

const {
  DISPATCH_DAILY_CAP_DEFAULT,
  DISPATCH_DAILY_CAP_MAX,
  DISPATCH_LABEL_DEFAULT,
  getAISettingsPublic,
  saveAISettings,
} = await import("./settings.ts");

test("nothing saved: dispatch is off, labelled polishd-fix, capped at the default, not paused", async () => {
  const s = await getAISettingsPublic();
  assert.equal(s.dispatchAuto, false);
  assert.equal(s.dispatchLabel, DISPATCH_LABEL_DEFAULT);
  assert.equal(s.dispatchDailyCap, DISPATCH_DAILY_CAP_DEFAULT);
  assert.equal(s.dispatchPaused, false);
});

test("the choices round-trip, trimmed, and survive an unrelated save", async () => {
  const saved = await saveAISettings({
    dispatchAuto: true,
    dispatchLabel: "  agent fix  ",
    dispatchDailyCap: 12,
    dispatchPaused: true,
  });
  assert.equal(saved.dispatchAuto, true);
  assert.equal(saved.dispatchLabel, "agent fix");
  assert.equal(saved.dispatchDailyCap, 12);
  assert.equal(saved.dispatchPaused, true);

  const after = await saveAISettings({ model: "some-model" });
  assert.equal(after.dispatchAuto, true);
  assert.equal(after.dispatchLabel, "agent fix");
  assert.equal(after.dispatchDailyCap, 12);
  assert.equal(after.dispatchPaused, true);
  assert.equal(after.model, "some-model");
});

test("a blank label and an unusable cap fall back to the defaults; a wild cap is clamped", async () => {
  let s = await saveAISettings({ dispatchLabel: "   ", dispatchDailyCap: Number.NaN });
  assert.equal(s.dispatchLabel, DISPATCH_LABEL_DEFAULT);
  assert.equal(s.dispatchDailyCap, DISPATCH_DAILY_CAP_DEFAULT);

  s = await saveAISettings({ dispatchDailyCap: 0 });
  assert.equal(s.dispatchDailyCap, 1, "a cap below one is one — pausing is its own switch");
  s = await saveAISettings({ dispatchDailyCap: 10_000 });
  assert.equal(s.dispatchDailyCap, DISPATCH_DAILY_CAP_MAX);
  s = await saveAISettings({ dispatchDailyCap: 2.6 });
  assert.equal(s.dispatchDailyCap, 3);

  s = await saveAISettings({ dispatchLabel: "a".repeat(80) });
  assert.equal(s.dispatchLabel.length, 50, "GitHub labels are at most 50 characters");
});

test("the public view carries the choices and no secret", async () => {
  await saveAISettings({ apiKey: "sk-secret", githubToken: "github_pat_secret", githubRepo: "acme/site" });
  const s = (await getAISettingsPublic()) as unknown as Record<string, unknown>;
  assert.equal(s.hasApiKey, true);
  assert.equal(s.hasGithubToken, true);
  assert.ok(!("apiKey" in s));
  assert.ok(!("githubToken" in s));
  assert.ok(!JSON.stringify(s).includes("secret"));
  assert.equal(typeof s.dispatchAuto, "boolean");
  assert.equal(typeof s.dispatchLabel, "string");
  assert.equal(typeof s.dispatchDailyCap, "number");
  assert.equal(typeof s.dispatchPaused, "boolean");
});
