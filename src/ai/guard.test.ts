import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PolishdReadOnlyError,
  PolishdUnauthorizedError,
  isPolishdReadOnly,
  registerPolishdAuth,
  requirePolishdAuth,
  resolvePolishdReadOnly,
  type PolishdAuthContext,
} from "./guard.ts";

// A context the callbacks can read without a live request.
const ctx = (owner: boolean) =>
  ({
    cookies: { get: (name: string) => (owner && name === "owner" ? { value: "1" } : undefined) },
    headers: new Headers(),
  }) as unknown as PolishdAuthContext;

test("readOnly: unset and false mean writable, true means read-only", async () => {
  assert.equal(await resolvePolishdReadOnly(undefined, ctx(false)), false);
  assert.equal(await resolvePolishdReadOnly(false, ctx(false)), false);
  assert.equal(await resolvePolishdReadOnly(true, ctx(false)), true);
});

test("readOnly: a callback decides per request", async () => {
  const readOnly = (c: PolishdAuthContext) => !c.cookies.get("owner");
  assert.equal(await resolvePolishdReadOnly(readOnly, ctx(false)), true);
  assert.equal(await resolvePolishdReadOnly(readOnly, ctx(true)), false);
});

test("readOnly: a callback that throws counts as read-only", async () => {
  const readOnly = () => {
    throw new Error("auth helper blew up");
  };
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(await resolvePolishdReadOnly(readOnly, ctx(true)), true);
  } finally {
    console.warn = warn;
  }
});

test("readOnly: only a literal true from the callback counts", async () => {
  // Anything truthy-but-not-true is a host bug; it must not lock the owner out
  // silently, and it must not be read as "writable" by accident either way.
  const readOnly = () => "yes" as unknown as boolean;
  assert.equal(await resolvePolishdReadOnly(readOnly, ctx(false)), false);
});

test("a read-only open dashboard refuses writes and allows reads", async () => {
  registerPolishdAuth({ mode: "open", readOnly: true });
  await assert.rejects(requirePolishdAuth(), PolishdReadOnlyError);
  await assert.rejects(requirePolishdAuth("write"), PolishdReadOnlyError);
  await requirePolishdAuth("read");
  assert.equal(await isPolishdReadOnly(), true);
});

test("the read-only refusal is still an authorization failure", async () => {
  registerPolishdAuth({ mode: "open", readOnly: true });
  await assert.rejects(requirePolishdAuth(), PolishdUnauthorizedError);
});

test("a writable open dashboard allows both", async () => {
  registerPolishdAuth({ mode: "open" });
  await requirePolishdAuth();
  await requirePolishdAuth("read");
  assert.equal(await isPolishdReadOnly(), false);
});

// Guarded policies read the request's cookies through Next's `cookies()`,
// which only works inside a request; their read-only decision is the same
// `resolvePolishdReadOnly` exercised above with an explicit context.

test("setup-required denies reads and writes, and isn't reported read-only", async () => {
  registerPolishdAuth({ mode: "setup-required" });
  await assert.rejects(requirePolishdAuth("read"), PolishdUnauthorizedError);
  await assert.rejects(requirePolishdAuth(), PolishdUnauthorizedError);
  assert.equal(await isPolishdReadOnly(), false);
});
