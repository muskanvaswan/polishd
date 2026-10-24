import assert from "node:assert/strict";
import { test } from "node:test";

import {
  blobUploadMessage,
  chunkRanges,
  classifyServiceError,
  disabledMessage,
  protectedMessage,
  retryIn,
  serviceFailureMessage,
} from "./snapshot-messages.ts";

const ctx = { origin: "https://example.com", serviceOrigin: "https://shots.example" };

test("service errors are read by code", () => {
  assert.deepEqual(
    classifyServiceError(429, { v: 1, error: { code: "rate_limited", message: "x", scope: "ip", retryAfter: 120 } }),
    { kind: "rate_limited", scope: "ip", retryAfter: 120 },
  );
  assert.equal(classifyServiceError(403, { v: 1, error: { code: "origin_not_public", message: "m" } }).kind, "not_public");
  assert.equal(classifyServiceError(422, { v: 1, error: { code: "origin_unresolvable", message: "m" } }).kind, "not_public");
  assert.equal(classifyServiceError(400, { v: 1, error: { code: "bad_request", message: "m" } }).kind, "rejected");
  assert.deepEqual(classifyServiceError(503, { v: 1, error: { code: "unavailable", message: "m" } }), {
    kind: "down",
    status: 503,
  });
  // A gateway error page, not the service's JSON.
  assert.deepEqual(classifyServiceError(502, null), { kind: "down", status: 502 });
  assert.equal(classifyServiceError(429, "<html>").kind, "rate_limited");
});

test("a CSP block names the directive and both origins to allow", () => {
  const msg = serviceFailureMessage({ kind: "csp" }, ctx);
  assert.match(msg, /Content-Security-Policy/);
  assert.match(msg, /connect-src/);
  assert.match(msg, /https:\/\/shots\.example/);
  assert.match(msg, /https:\/\/vercel\.com/);
});

test("rate limits say whose limit and when to come back", () => {
  assert.match(
    serviceFailureMessage({ kind: "rate_limited", scope: "origin", retryAfter: 1800 }, ctx),
    /how often example\.com can be shot\. Try again in about 30 minutes\./,
  );
  assert.match(serviceFailureMessage({ kind: "rate_limited", scope: "ip", retryAfter: 30 }, ctx), /your network/);
  assert.match(serviceFailureMessage({ kind: "rate_limited", scope: "global", retryAfter: 7200 }, ctx), /everyone today.*about 2 hours/);
});

test("a down service says so, and when to try again", () => {
  assert.match(serviceFailureMessage({ kind: "unreachable" }, ctx), /didn't respond.*Try again/);
  assert.match(serviceFailureMessage({ kind: "down", status: 500 }, ctx), /HTTP 500.*Try again/);
});

test("a site the service can't reach is named, with the way out", () => {
  const msg = serviceFailureMessage({ kind: "not_public", message: "intranet.example resolves to a private address." }, ctx);
  assert.match(msg, /can't reach example\.com/);
  assert.match(msg, /resolves to a private address\)/);
  assert.match(msg, /public domain/);
});

test("each reason the section is off says why", () => {
  assert.match(disabledMessage("no_storage", "Connect a Vercel Blob store."), /Connect a Vercel Blob store/);
  assert.match(disabledMessage("no_storage", null), /nowhere to be stored/);
  assert.match(disabledMessage("declined", null), /wasn't allowed.*Review it/);
  assert.match(disabledMessage("turned_off", null), /POLISHD_SNAPSHOT_SERVICE=off/);
});

test("protected previews and upload failures get their own wording", () => {
  assert.match(protectedMessage("https://my-app-git-x.vercel.app"), /my-app-git-x\.vercel\.app is behind Vercel's Deployment Protection/);
  assert.match(blobUploadMessage("x", true), /connect-src/);
  assert.match(blobUploadMessage("HTTP 403", false), /HTTP 403/);
});

test("retry hints round to something a person would say", () => {
  assert.equal(retryIn(10), "a minute or so");
  assert.equal(retryIn(600), "about 10 minutes");
  assert.equal(retryIn(3500), "about an hour");
  assert.equal(retryIn(86_000), "about 24 hours");
});

test("chunked uploads cover every byte exactly once", () => {
  assert.deepEqual(chunkRanges(10, 4), [[0, 4], [4, 8], [8, 10]]);
  assert.deepEqual(chunkRanges(8, 4), [[0, 4], [4, 8]]);
  assert.deepEqual(chunkRanges(0, 4), [[0, 0]]);
});
