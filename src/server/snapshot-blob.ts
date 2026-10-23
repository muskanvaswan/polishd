/**
 * Polishd — the Vercel Blob rules behind site snapshots (server only).
 *
 * Whether a store is connected, which access mode it accepts, and which
 * recorded URLs need credentials to read back. Kept free of imports — the SDK
 * call is handed in — so `node --test` can pin the rules down without a store
 * or a network. `snapshots.ts` does the actual I/O.
 */

/** A Blob store is created public or private, and stays that way. */
export type BlobAccess = "public" | "private";

/**
 * True when a Vercel Blob store is connected to the project, whichever way
 * Vercel wired it. A store connected over OIDC injects `BLOB_STORE_ID`, which
 * `@vercel/blob` pairs with the short-lived OIDC token Vercel issues to every
 * function at runtime; the classic connection injects a static
 * `BLOB_READ_WRITE_TOKEN`. The SDK resolves the credential itself (OIDC
 * first), so presence of either variable is the whole signal — no
 * Polishd-specific configuration on top. Blank values count as unset, as
 * they do in the SDK.
 */
export function blobConfigured(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return Boolean(env.BLOB_STORE_ID?.trim() || env.BLOB_READ_WRITE_TOKEN?.trim());
}

/**
 * True for a blob in a private store —
 * `https://<store>.private.blob.vercel-storage.com/…`. Those refuse anonymous
 * reads, so they are read back through the SDK, which attaches the store's
 * credential; a public store's URLs are a plain fetch.
 */
export function isPrivateBlobUrl(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith(".private.blob.vercel-storage.com");
  } catch {
    return false;
  }
}

/**
 * Upload with whichever access mode the connected store was created with.
 * Nothing in the environment says which that is, so the first upload tries
 * public (what every store was before private storage existed) and, when
 * that's refused, private. The mode that worked is kept for the rest of the
 * process. When both fail the error carries both reasons — only one of them
 * is the real problem, and there's no telling which from here.
 */
export function createBlobUploader() {
  let known: BlobAccess | null = null;
  return async <T>(put: (access: BlobAccess) => Promise<T>): Promise<T> => {
    if (known) return put(known);
    let publicError: unknown;
    try {
      const result = await put("public");
      known = "public";
      return result;
    } catch (err) {
      publicError = err;
    }
    try {
      const result = await put("private");
      known = "private";
      return result;
    } catch (privateError) {
      const asPublic = messageOf(publicError);
      const asPrivate = messageOf(privateError);
      throw new Error(
        asPublic === asPrivate
          ? asPublic
          : `${asPublic} (retried as a private upload: ${asPrivate})`,
      );
    }
  };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : "unknown error";
}
