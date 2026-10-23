/**
 * Tests for the Vercel Blob rules behind site snapshots.
 *
 * Run with `npm test`. The subject takes its environment and its SDK call as
 * arguments, so no store, token, or network is involved.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  blobConfigured,
  createBlobUploader,
  isPrivateBlobUrl,
  type BlobAccess,
} from "./snapshot-blob.ts";

test("a store connected over OIDC counts as configured", () => {
  // What Vercel injects today: the store id (the OIDC token is per-request,
  // not an env var we can see) plus a webhook key that plays no part here.
  assert.equal(
    blobConfigured({ BLOB_STORE_ID: "store_abc123", BLOB_WEBHOOK_PUBLIC_KEY: "pk" }),
    true,
  );
});

test("the classic read-write token still counts as configured", () => {
  assert.equal(blobConfigured({ BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_abc_xyz" }), true);
});

test("either variable alone is enough, and both together are fine", () => {
  assert.equal(
    blobConfigured({ BLOB_STORE_ID: "store_abc123", BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_abc_xyz" }),
    true,
  );
});

test("no Blob variables means disk storage", () => {
  assert.equal(blobConfigured({}), false);
  // The webhook key on its own is not a store connection.
  assert.equal(blobConfigured({ BLOB_WEBHOOK_PUBLIC_KEY: "pk" }), false);
});

test("blank values count as unset, matching the SDK", () => {
  assert.equal(blobConfigured({ BLOB_STORE_ID: "", BLOB_READ_WRITE_TOKEN: "   " }), false);
});

test("private-store URLs are recognized by host", () => {
  assert.equal(
    isPrivateBlobUrl("https://abc123.private.blob.vercel-storage.com/polishd/snapshots/x/r0-a.png"),
    true,
  );
  assert.equal(
    isPrivateBlobUrl("https://abc123.public.blob.vercel-storage.com/polishd/snapshots/x/r0-a.png"),
    false,
  );
});

test("lookalike hosts and junk are not private-store URLs", () => {
  // The path or a query string mentioning the host doesn't make it one.
  assert.equal(
    isPrivateBlobUrl("https://evil.example/abc.private.blob.vercel-storage.com/a.png"),
    false,
  );
  assert.equal(isPrivateBlobUrl("https://private.blob.vercel-storage.com.evil.example/a.png"), false);
  assert.equal(isPrivateBlobUrl("not a url"), false);
  assert.equal(isPrivateBlobUrl(""), false);
});

/** A fake `put` for a store created with `storeAccess`, recording each attempt. */
function fakeStore(storeAccess: BlobAccess) {
  const attempts: BlobAccess[] = [];
  const put = async (access: BlobAccess) => {
    attempts.push(access);
    if (access !== storeAccess) throw new Error(`store is ${storeAccess}`);
    return { url: `https://s.${access}.blob.vercel-storage.com/${attempts.length}.png` };
  };
  return { attempts, put };
}

test("a public store uploads public on the first try and stays public", async () => {
  const upload = createBlobUploader();
  const store = fakeStore("public");
  await upload(store.put);
  await upload(store.put);
  assert.deepEqual(store.attempts, ["public", "public"]);
});

test("a private store falls back to private once, then goes straight there", async () => {
  const upload = createBlobUploader();
  const store = fakeStore("private");
  const first = await upload(store.put);
  assert.match(first.url, /\.private\.blob\./);
  await upload(store.put);
  await upload(store.put);
  assert.deepEqual(store.attempts, ["public", "private", "private", "private"]);
});

test("each uploader works the access mode out for itself", async () => {
  const privateUpload = createBlobUploader();
  await privateUpload(fakeStore("private").put);
  const fresh = fakeStore("public");
  await createBlobUploader()(fresh.put);
  assert.deepEqual(fresh.attempts, ["public"]);
});

test("when both modes fail, the error names both reasons", async () => {
  const upload = createBlobUploader();
  await assert.rejects(
    upload(async (access) => {
      throw new Error(access === "public" ? "store is private" : "file too large");
    }),
    { message: "store is private (retried as a private upload: file too large)" },
  );
});

test("when both modes fail the same way, the reason appears once", async () => {
  const upload = createBlobUploader();
  await assert.rejects(
    upload(async () => {
      throw new Error("Vercel Blob: This store has been suspended.");
    }),
    { message: "Vercel Blob: This store has been suspended." },
  );
});

test("a failed probe isn't remembered — the next upload probes again", async () => {
  const upload = createBlobUploader();
  let down = true;
  const attempts: BlobAccess[] = [];
  const put = async (access: BlobAccess) => {
    attempts.push(access);
    if (down) throw new Error("service unavailable");
    return { url: "u" };
  };
  await assert.rejects(upload(put));
  down = false;
  await upload(put);
  assert.deepEqual(attempts, ["public", "private", "public"]);
});
