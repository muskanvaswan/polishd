/**
 * Tests for the context a `js_error` carries: digest, top frame, last click.
 *
 * Run with `npm test`. The stacks are shaped like each engine's real output.
 * The case that started this is a production Server Components failure: the
 * message is the same redacted sentence every time, and the digest is the
 * only thing that ties it back to the server's log.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ERROR_INTERACTION_WINDOW_MS,
  errorContextMeta,
  errorDigest,
  topStackFrame,
} from "./error-context.ts";

test("V8: the first `at` frame, host and query string dropped", () => {
  const stack = [
    "TypeError: Cannot read properties of undefined (reading 'map')",
    "    at Summary (https://site.test/_next/static/chunks/app/page-4f2a.js?v=3:1:23456)",
    "    at renderWithHooks (https://site.test/_next/static/chunks/react-dom.js:1:999)",
  ].join("\n");
  assert.equal(topStackFrame(stack), "/_next/static/chunks/app/page-4f2a.js:1:23456");
  assert.equal(
    topStackFrame("Error: boom\n    at https://site.test:3000/a.js:12:5"),
    "/a.js:12:5",
    "an anonymous frame, and a port in the host",
  );
});

test("V8: a URL in the message line is not the frame", () => {
  const stack = "Error: failed to load https://api.test/x.js:1:2\n    at load (https://site.test/b.js:4:9)";
  assert.equal(topStackFrame(stack), "/b.js:4:9");
});

test("Firefox and Safari: `fn@url`, including function names with slashes", () => {
  assert.equal(topStackFrame("Summary@https://site.test/c.js:7:11\n@https://site.test/d.js:1:1"), "/c.js:7:11");
  assert.equal(topStackFrame("Foo/<@https://site.test/e.js:2:3"), "/e.js:2:3");
  assert.equal(topStackFrame("global code@https://site.test/f.js:9:1"), "/f.js:9:1");
});

test("paths with `@` and parentheses survive", () => {
  assert.equal(
    topStackFrame("    at x (https://site.test/_next/static/chunks/node_modules_@polishd_next_a1.js:1:42)"),
    "/_next/static/chunks/node_modules_@polishd_next_a1.js:1:42",
  );
  assert.equal(
    topStackFrame("    at Page (webpack-internal:///(app-pages-browser)/./app/page.tsx:12:5)"),
    "/(app-pages-browser)/./app/page.tsx:12:5",
  );
  assert.equal(
    topStackFrame("    at f (file:///Users/me/app/x.js:3:4)"),
    "/Users/me/app/x.js:3:4",
    "an empty host keeps the whole path",
  );
});

test("a long frame keeps its end, where the file name is", () => {
  const long = `https://site.test/${"deep/".repeat(60)}chunk-abc.js:1:2`;
  const frame = topStackFrame(`    at f (${long})`);
  assert.ok(frame && frame.length <= 200);
  assert.ok(frame?.startsWith("…"));
  assert.ok(frame?.endsWith("chunk-abc.js:1:2"));
});

test("no stack, no frame", () => {
  assert.equal(topStackFrame(undefined), undefined);
  assert.equal(topStackFrame(42), undefined);
  assert.equal(topStackFrame("Error: no frames here"), undefined);
  assert.equal(topStackFrame("    at <anonymous>"), undefined);
});

test("errorDigest reads Next's digest off errors and rejection reasons", () => {
  assert.equal(errorDigest(Object.assign(new Error("redacted"), { digest: "2941833417" })), "2941833417");
  assert.equal(errorDigest({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" }), "NEXT_HTTP_ERROR_FALLBACK;404");
  assert.equal(errorDigest({ digest: "x".repeat(500) })?.length, 120);
  for (const value of [new Error("plain"), "a string", null, undefined, { digest: 7 }, { digest: "" }]) {
    assert.equal(errorDigest(value), undefined);
  }
});

const click = { ts: 10_000, component: "settings", label: "Save", selector: "form>button.save" };

test("errorContextMeta: digest, frame, and the click just before", () => {
  const error = Object.assign(new Error("An error occurred in the Server Components render."), {
    digest: "2941833417",
    stack: "Error: An error occurred\n    at f (https://site.test/_next/static/chunks/a.js:1:777)",
  });
  assert.deepEqual(errorContextMeta(error, click, 10_400), {
    digest: "2941833417",
    frame: "/_next/static/chunks/a.js:1:777",
    lastComponent: "settings",
    lastLabel: "Save",
    lastSelector: "form>button.save",
  });
});

test("a click outside the window — or after the error — isn't attributed", () => {
  const late = click.ts + ERROR_INTERACTION_WINDOW_MS + 1;
  const reason = { message: "rejected" }; // a rejection reason with no stack
  assert.deepEqual(errorContextMeta(reason, click, late), {});
  assert.deepEqual(errorContextMeta(reason, click, click.ts - 1), {});
  assert.deepEqual(errorContextMeta(reason, null, click.ts), {});
  assert.deepEqual(
    errorContextMeta(reason, { ts: 0, label: "Only a label" }, 500),
    { lastLabel: "Only a label" },
    "absent parts are left out, not sent empty",
  );
});

test("with no stack, the frame falls back to the browser's own blame", () => {
  assert.deepEqual(
    errorContextMeta(null, null, 0, { source: "https://site.test/x.js?v=1", line: 1, col: 4321 }),
    { frame: "/x.js:1:4321" },
  );
  assert.deepEqual(errorContextMeta(null, null, 0, { source: "", line: 0, col: 0 }), {});
});

test("values stay inside ingest's per-value cap", () => {
  const huge = { ts: 0, component: "c".repeat(400), label: "l".repeat(400), selector: "s".repeat(900) };
  const meta = errorContextMeta({ digest: "d".repeat(900) }, huge, 0);
  for (const value of Object.values(meta)) assert.ok(value.length <= 300);
});
