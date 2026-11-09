import assert from "node:assert/strict";
import { test } from "node:test";

import { describeStoreFailure, redactStoreError } from "./store-failure.ts";

test("no URL and an unwritable SQLite file means no database", () => {
  const f = describeStoreFailure({
    tried: "sqlite",
    host: null,
    error: "EROFS: read-only file system, mkdir '/var/task/.polishd'",
  });
  assert.equal(f.kind, "no-database");
  assert.match(f.detail, /EROFS/);
});

test("no URL on a Node without node:sqlite means upgrade Node", () => {
  const f = describeStoreFailure({
    tried: "sqlite",
    host: null,
    error: "No such built-in module: node:sqlite",
  });
  assert.equal(f.kind, "node");
});

test("a URL without the pg driver installed says so", () => {
  const f = describeStoreFailure({ tried: "postgres", host: "db.example:5432", error: "Cannot find module 'pg'" });
  assert.equal(f.kind, "pg-missing");
});

test("a Postgres failure names the host and a likely cause", () => {
  const cases: Array<[string, RegExp]> = [
    ["getaddrinfo ENOTFOUND ep-cool-pooler.aws.neon.tech", /doesn't resolve/],
    ["connect ECONNREFUSED 127.0.0.1:5432", /Nothing accepted/],
    ["Connection terminated due to connection timeout", /timed out/],
    ['password authentication failed for user "polishd"', /username or password/],
    ['database "polishd" does not exist', /doesn't exist/],
    ["sorry, too many clients already", /pooled connection string/],
  ];
  for (const [error, hint] of cases) {
    const f = describeStoreFailure({ tried: "postgres", host: "db.example:5432", error });
    assert.equal(f.kind, "postgres", error);
    assert.equal(f.host, "db.example:5432");
    assert.match(f.hint ?? "", hint, error);
  }
  const unknown = describeStoreFailure({ tried: "postgres", host: null, error: "something odd" });
  assert.equal(unknown.hint, null);
});

test("nothing that could carry the password survives redaction", () => {
  const raw =
    "could not connect: postgres://polishd:s3cret@db.example:5432/polishd?sslmode=require " +
    "(host=db.example password=s3cret)";
  const out = redactStoreError(raw);
  assert.doesNotMatch(out, /s3cret/);
  assert.match(out, /<url>/);
  assert.match(out, /password=<redacted>/);
  assert.equal(describeStoreFailure({ tried: "postgres", host: null, error: raw }).detail, out);
});
