import assert from "node:assert/strict";
import { test } from "node:test";

import { selectBuildScans } from "./design-builds.ts";
import type { DesignScanRow } from "./design-aggregate.ts";

const payload = { v: 1 as const, el: 10, fonts: [], text: [], bg: [], border: [], pairs: [], radii: [], pad: [] };
const scan = (path: string, build: string | null, ts = 1): DesignScanRow => ({ path, ts, build, payload });
const paths = (rows: DesignScanRow[]) => rows.map((s) => s.path).sort();

const OLD = "1111111111111111111111111111111111111111";
const NEW = "2222222222222222222222222222222222222222";
const current = { build: NEW, firstSeen: 5_000 };

test("with no build known, every newest scan is merged, as before", () => {
  const latest = [scan("/", null), scan("/about", null)];
  const out = selectBuildScans(latest, null, new Set(["/", "/about"]));
  assert.deepEqual(out, { scans: latest, coverage: null });
});

test("a fresh deploy with no scans yet keeps the old picture and lists what's pending", () => {
  const latest = [scan("/", OLD), scan("/about", OLD), scan("/pricing", OLD)];
  const out = selectBuildScans(latest, current, new Set(["/", "/about"]));
  assert.deepEqual(paths(out.scans), ["/", "/about", "/pricing"]);
  assert.deepEqual(out.coverage, {
    build: NEW,
    firstSeen: 5_000,
    scanned: 0,
    pending: ["/", "/about"],
    carried: 3,
    complete: false,
  });
});

test("while some pages are rescanned the rest are carried from the old build", () => {
  const latest = [scan("/", NEW, 9), scan("/about", OLD), scan("/pricing", OLD)];
  const out = selectBuildScans(latest, current, new Set(["/", "/about", "/pricing"]));
  assert.deepEqual(paths(out.scans), ["/", "/about", "/pricing"]);
  assert.equal(out.coverage?.scanned, 1);
  assert.deepEqual(out.coverage?.pending, ["/about", "/pricing"]);
  assert.equal(out.coverage?.carried, 2);
  assert.equal(out.coverage?.complete, false);
});

test("a page viewed on the new build but never scanned anywhere is pending too", () => {
  const latest = [scan("/", NEW)];
  const out = selectBuildScans(latest, current, new Set(["/", "/new-page"]));
  assert.deepEqual(out.coverage?.pending, ["/new-page"]);
  assert.equal(out.coverage?.complete, false);
  assert.deepEqual(paths(out.scans), ["/"], "nothing to carry: the page has no scan at all");
  assert.equal(out.coverage?.carried, 0);
});

test("once every served page is scanned on the new build, the old build's scans go", () => {
  // /pricing was removed in the new build: never served, never scanned on it.
  const latest = [scan("/", NEW, 9), scan("/about", NEW, 9), scan("/pricing", OLD)];
  const out = selectBuildScans(latest, current, new Set(["/", "/about"]));
  assert.deepEqual(paths(out.scans), ["/", "/about"]);
  assert.deepEqual(out.coverage, {
    build: NEW,
    firstSeen: 5_000,
    scanned: 2,
    pending: [],
    carried: 0,
    complete: true,
  });
});

test("a build nobody has viewed a page on isn't complete just because nothing is pending", () => {
  const latest = [scan("/", OLD), scan("/about", OLD)];
  const out = selectBuildScans(latest, current, new Set());
  assert.equal(out.coverage?.complete, false);
  assert.deepEqual(paths(out.scans), ["/", "/about"]);
  assert.equal(out.coverage?.carried, 2);
});

test("scans stamped with no build count as another build's", () => {
  const latest = [scan("/", NEW), scan("/legacy", null)];
  const out = selectBuildScans(latest, current, new Set(["/"]));
  assert.equal(out.coverage?.complete, true);
  assert.deepEqual(paths(out.scans), ["/"]);
});
