/**
 * The store's status when the URL is set but nothing answers. Its own file:
 * the store latches its first result for the life of the process.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

// store.ts loads `pg` with `require`, which Next's bundler supplies; plain ESM
// under the test runner has none.
(globalThis as { require?: NodeRequire }).require = createRequire(import.meta.url);
process.env.POLISHD_DATABASE_URL = "postgres://polishd:s3cret@127.0.0.1:1/polishd";

const { storeStatus } = await import("./store.ts");

test("an unreachable database reports its host, never the URL", async () => {
  const status = await storeStatus();
  assert.equal(status.ready, false);
  if (status.ready) return;
  assert.equal(status.tried, "postgres");
  assert.equal(status.host, "127.0.0.1:1");
  assert.match(status.error, /ECONNREFUSED/);
  assert.doesNotMatch(JSON.stringify(status), /s3cret/);
});
