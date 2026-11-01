import assert from "node:assert/strict";
import { register } from "node:module";
import { test } from "node:test";

// The subject imports a sibling without an extension, as the build requires.
register(
  "data:text/javascript," +
    encodeURIComponent(`
      export async function resolve(specifier, context, next) {
        try {
          return await next(specifier, context);
        } catch (err) {
          const bare = /^\\.\\.?\\//.test(specifier) && !/\\.[cm]?[jt]sx?$/.test(specifier);
          if (err?.code !== "ERR_MODULE_NOT_FOUND" || !bare) throw err;
          return next(specifier + ".ts", context);
        }
      }`),
);
const { analyticsHref, parseAnalyticsRange, rangeBuild, rangeLabel, rangeSince } = await import(
  "./analytics-range.ts"
);
const { parseAnalyticsSource } = await import("./analytics-source.ts");

const DAY = 86_400_000;

test("parseAnalyticsRange only admits the allowlist", () => {
  assert.equal(parseAnalyticsRange("7d"), "7d");
  assert.equal(parseAnalyticsRange("90d"), "90d");
  assert.equal(parseAnalyticsRange("all"), "all");
  assert.equal(parseAnalyticsRange("build"), "build");
  assert.equal(parseAnalyticsRange(undefined), "all");
  assert.equal(parseAnalyticsRange("3d"), "all");
  assert.equal(parseAnalyticsRange("7d; DROP TABLE events"), "all");
});

test("a named build survives only when it's a clean label", () => {
  assert.equal(parseAnalyticsRange("build:f804613"), "build:f804613");
  assert.equal(rangeBuild("build:f804613"), "f804613");
  assert.equal(parseAnalyticsRange("build:it's"), "all");
  assert.equal(parseAnalyticsRange("build:"), "all");
  assert.equal(rangeBuild("7d"), null);
  assert.equal(rangeBuild("build"), null, "the current build is resolved by the dashboard, not named here");
});

test("rangeSince measures back from now for windows only", () => {
  const now = 10_000 * DAY;
  assert.equal(rangeSince("24h", now), now - DAY);
  assert.equal(rangeSince("7d", now), now - 7 * DAY);
  assert.equal(rangeSince("30d", now), now - 30 * DAY);
  assert.equal(rangeSince("all", now), null);
  assert.equal(rangeSince("build", now), null);
  assert.equal(rangeSince("build:abc", now), null);
});

test("rangeLabel reads as the end of a sentence", () => {
  assert.equal(rangeLabel("all"), "all time");
  assert.equal(rangeLabel("24h"), "the last 24 hours");
  assert.equal(rangeLabel("7d"), "the last 7 days");
  assert.equal(rangeLabel("build"), "this build");
  assert.equal(rangeLabel("build", "f804613"), "build f804613");
  assert.equal(rangeLabel("build:f804613c2a9e4b7d", "f804613"), "build f804613");
  assert.equal(rangeLabel("build:v1.2"), "build v1.2");
});

test("parseAnalyticsSource only admits the two datasets", () => {
  assert.equal(parseAnalyticsSource("site"), "site");
  assert.equal(parseAnalyticsSource("telemetry"), "telemetry");
  assert.equal(parseAnalyticsSource(undefined), null);
  assert.equal(parseAnalyticsSource("Telemetry"), null);
  assert.equal(parseAnalyticsSource("site' OR 1=1"), null);
});

test("analyticsHref carries the source only when the view names one", () => {
  assert.equal(analyticsHref("7d"), "?tab=analytics&range=7d");
  assert.equal(analyticsHref("7d", null), "?tab=analytics&range=7d");
  assert.equal(analyticsHref("all", "site"), "?tab=analytics&range=all&source=site");
  assert.equal(
    analyticsHref("build:v1.2", "telemetry"),
    "?tab=analytics&range=build%3Av1.2&source=telemetry",
  );
});
