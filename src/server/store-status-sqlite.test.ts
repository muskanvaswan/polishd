/**
 * The store's status when no URL is set and the SQLite file can't be written —
 * the serverless case. Its own file: the store latches its first result for
 * the life of the process.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

for (const key of ["POLISHD_DATABASE_URL", "BUFFD_DATABASE_URL", "POLISH_DATABASE_URL"]) {
  delete process.env[key];
}
// A path under a file, so the directory can never be created.
process.env.POLISHD_DB_PATH = "/dev/null/polishd/analytics.db";

const { storeStatus } = await import("./store.ts");

test("an unwritable SQLite path reports why, as a SQLite failure", async () => {
  const status = await storeStatus();
  assert.equal(status.ready, false);
  if (status.ready) return;
  assert.equal(status.tried, "sqlite");
  assert.equal(status.host, null);
  assert.match(status.error, /ENOTDIR|EEXIST|EACCES|EROFS|ENOENT/);
});
