import assert from "node:assert/strict";
import { test } from "node:test";

import { POLISHD_THEME_COOKIE, themeFrom } from "./theme.ts";

test("dark unless the owner chose light", () => {
  assert.equal(themeFrom(undefined), "dark");
  assert.equal(themeFrom(null), "dark");
  assert.equal(themeFrom(""), "dark");
  assert.equal(themeFrom("dark"), "dark");
  assert.equal(themeFrom("LIGHT"), "dark", "only the exact value the toggle writes");
  assert.equal(themeFrom("light"), "light");
  assert.equal(POLISHD_THEME_COOKIE, "polishd_theme");
});
