/**
 * Tests for polishd.defaults.json: how the file is read, where it sits under
 * the environment and the dashboard, and the key it can point at — against a
 * real SQLite store.
 *
 * Run with `npm test`. Each run writes a throwaway database file; a
 * configured Postgres is never touched.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

for (const key of Object.keys(process.env)) {
  if (/^(POLISHD|BUFFD)_(DATABASE_URL|AI_|GITHUB_)/.test(key)) delete process.env[key];
}
delete process.env.ACME_ANTHROPIC_KEY;
process.env.POLISHD_DB_PATH = join(mkdtempSync(join(tmpdir(), "polishd-defaults-")), "test.db");

const {
  getAISettingsPublic,
  needsOnboarding,
  parsePolishdDefaults,
  registerPolishdDefaults,
  resolveSettings,
  saveAISettings,
} = await import("./settings.ts");
const { getMeta, setMeta } = await import("../server/store.ts");

const FILE = {
  ai: { provider: "anthropic", model: "claude-opus-5-5", apiKeyEnv: "ACME_ANTHROPIC_KEY" },
  site: {
    description: "A notes site. Visitors read articles and browse by tag.",
    audience: "Developers who keep notes",
    values: "Fast, quiet, no dark patterns",
    sourceDirs: ["app", "components"],
  },
  github: { repo: "acme/notes", autoIssues: true },
  fix: { auto: false, label: "polishd-fix", dailyCap: 3 },
};

test("every section maps onto the setting it fills", () => {
  const { settings, apiKeyEnv, problems } = parsePolishdDefaults(FILE);
  assert.deepEqual(problems, []);
  assert.equal(apiKeyEnv, "ACME_ANTHROPIC_KEY");
  assert.deepEqual(settings, {
    provider: "anthropic",
    model: "claude-opus-5-5",
    context: FILE.site.description,
    audience: FILE.site.audience,
    ideology: FILE.site.values,
    sourceDirs: "app,components",
    githubRepo: "acme/notes",
    githubAutoIssues: true,
    dispatchAuto: false,
    dispatchLabel: "polishd-fix",
    dispatchDailyCap: 3,
  });
});

test("blank placeholders are simply unset", () => {
  const { settings, problems } = parsePolishdDefaults({
    site: { description: "", audience: "  ", values: "" },
    github: { repo: "acme/notes" },
  });
  assert.deepEqual(problems, []);
  assert.deepEqual(settings, { githubRepo: "acme/notes" });
});

test("a secret in the file is dropped and named, never read", () => {
  const { settings, problems } = parsePolishdDefaults({
    ai: { apiKey: "sk-ant-leaked", model: "claude-opus-5-5" },
    github: { token: "github_pat_leaked" },
  });
  assert.deepEqual(settings, { model: "claude-opus-5-5" });
  assert.equal(problems.length, 2);
  assert.match(problems[0], /ai\.apiKey is a secret.*POLISHD_AI_API_KEY/);
  assert.match(problems[1], /github\.token is a secret.*POLISHD_GITHUB_TOKEN/);
  assert.ok(!JSON.stringify(settings).includes("leaked"));
});

test("bad values and unknown keys are named, and the rest still reads", () => {
  const { settings, apiKeyEnv, problems } = parsePolishdDefaults({
    ai: { provider: "skynet", apiKeyEnv: "DATABASE_URL", refresh: "hourly" },
    site: { descripton: "typo", sourceDirs: [1, 2] },
    github: { repo: "not a repo" },
    fix: { dailyCap: "lots" },
    extras: {},
  });
  assert.deepEqual(settings, {});
  assert.equal(apiKeyEnv, undefined, "only a name ending in _KEY can be read as the key");
  assert.deepEqual(
    problems.map((p) => p.split(" ")[0] + " " + p.split(" ")[1]),
    [
      "ai.provider must",
      "ai.apiKeyEnv must",
      "ai.refresh must",
      "unknown key",
      "site.sourceDirs must",
      "github.repo must",
      "fix.dailyCap must",
      "unknown section",
    ],
  );
});

test("something that isn't an object reads as nothing", () => {
  assert.deepEqual(parsePolishdDefaults([]).settings, {});
  assert.deepEqual(parsePolishdDefaults("nope").problems, ["expected a JSON object; nothing was read from it"]);
});

test("registered, the file fills the dashboard's settings", async () => {
  registerPolishdDefaults(FILE);
  const s = await getAISettingsPublic();
  assert.equal(s.fromFile, true);
  assert.equal(s.model, "claude-opus-5-5");
  assert.equal(s.context, FILE.site.description);
  assert.equal(s.githubRepo, "acme/notes");
  assert.equal(s.dispatchDailyCap, 3);
  assert.equal(s.hasApiKey, false, "the named variable isn't set yet");
  assert.equal(s.apiKeyEnv, undefined);
});

test("the named variable supplies the key, and only its name reaches the browser", async () => {
  process.env.ACME_ANTHROPIC_KEY = "sk-ant-from-the-app";
  try {
    const { settings } = await resolveSettings();
    assert.equal(settings.apiKey, "sk-ant-from-the-app");
    const s = await getAISettingsPublic();
    assert.equal(s.hasApiKey, true);
    assert.equal(s.apiKeyEnv, "ACME_ANTHROPIC_KEY");
    assert.ok(!JSON.stringify(s).includes("from-the-app"));
    assert.equal(await needsOnboarding(), false, "a named key counts as a connected model");
  } finally {
    delete process.env.ACME_ANTHROPIC_KEY;
  }
});

test("POLISHD_AI_API_KEY and a saved key both beat the named variable", async () => {
  process.env.ACME_ANTHROPIC_KEY = "sk-ant-from-the-app";
  process.env.POLISHD_AI_API_KEY = "sk-ant-polishd-env";
  try {
    assert.equal((await resolveSettings()).settings.apiKey, "sk-ant-polishd-env");
    assert.equal((await getAISettingsPublic()).apiKeyEnv, undefined);
    delete process.env.POLISHD_AI_API_KEY;
    await saveAISettings({ apiKey: "sk-ant-saved" });
    assert.equal((await resolveSettings()).settings.apiKey, "sk-ant-saved");
  } finally {
    delete process.env.ACME_ANTHROPIC_KEY;
    delete process.env.POLISHD_AI_API_KEY;
    await setMeta("ai_settings", "{}");
  }
});

test("the environment beats the file, and the dashboard beats both", async () => {
  process.env.POLISHD_AI_MODEL = "claude-sonnet-5-5";
  try {
    assert.equal((await resolveSettings()).settings.model, "claude-sonnet-5-5");
    await saveAISettings({ model: "claude-haiku-5-5" });
    assert.equal((await resolveSettings()).settings.model, "claude-haiku-5-5");
  } finally {
    delete process.env.POLISHD_AI_MODEL;
    await setMeta("ai_settings", "{}");
  }
});

test("saving the form stores only what differs, so a later file edit still lands", async () => {
  // What the Settings form sends: every field, most of them unchanged.
  await saveAISettings({
    provider: "anthropic",
    model: "claude-opus-5-5",
    context: FILE.site.description,
    audience: "Developers and writers",
    ideology: FILE.site.values,
    sourceDirs: "app,components",
    githubRepo: "acme/notes",
    githubAutoIssues: true,
    dispatchAuto: false,
    dispatchLabel: "polishd-fix",
    dispatchDailyCap: 3,
  });
  assert.deepEqual(JSON.parse((await getMeta("ai_settings")) ?? "{}"), { audience: "Developers and writers" });

  registerPolishdDefaults({ ...FILE, site: { ...FILE.site, description: "A notes and recipes site." } });
  const s = await getAISettingsPublic();
  assert.equal(s.context, "A notes and recipes site.", "the edited file shows through");
  assert.equal(s.audience, "Developers and writers", "the owner's change still wins");
});

test("the package's own defaults aren't pinned either, so the file can still set them later", async () => {
  await setMeta("ai_settings", "{}");
  registerPolishdDefaults({ github: { repo: "acme/notes" } });
  // The form's save: autoIssues, cadence and the Fix choices at their defaults.
  await saveAISettings({
    githubRepo: "acme/notes",
    githubAutoIssues: false,
    refreshCadence: "manual",
    dispatchAuto: false,
    dispatchLabel: "polishd-fix",
    dispatchDailyCap: 5,
    dispatchPaused: false,
  });
  assert.equal(await getMeta("ai_settings"), "{}");
  registerPolishdDefaults({ github: { repo: "acme/notes", autoIssues: true }, fix: { dailyCap: 2 } });
  const s = await getAISettingsPublic();
  assert.equal(s.githubAutoIssues, true);
  assert.equal(s.dispatchDailyCap, 2);
});
