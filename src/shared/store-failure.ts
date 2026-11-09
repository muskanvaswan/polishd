/**
 * Polishd — why no analytics store opened, in words the dashboard can show
 * (shared: no server, no React).
 *
 * The store latches to a no-op when it can't open (server/store.ts), and the
 * dashboard then has nothing to show. Rather than an empty dashboard with a
 * warning, it shows a setup screen built from this: what kind of failure it
 * was, a likely cause, and the error itself with anything URL-shaped removed,
 * since a connection string carries the database password.
 */

export type StoreFailureKind =
  /** No `POLISHD_DATABASE_URL`, and the local SQLite file can't be written. */
  | "no-database"
  /** No `POLISHD_DATABASE_URL`, and this Node has no `node:sqlite`. */
  | "node"
  /** A URL is set, but the optional `pg` driver isn't installed. */
  | "pg-missing"
  /** A URL is set, and connecting to it failed. */
  | "postgres";

export interface StoreFailure {
  kind: StoreFailureKind;
  /** The database's host and port, for a Postgres failure. */
  host: string | null;
  /** A likely cause, when the error says enough to name one. */
  hint: string | null;
  /** The error, redacted. */
  detail: string;
}

const POSTGRES_HINTS: Array<[RegExp, string]> = [
  [/ENOTFOUND|EAI_AGAIN|getaddrinfo/i, "The host in the URL doesn't resolve. Check it for typos."],
  [/ECONNREFUSED/i, "Nothing accepted the connection at that host and port."],
  [
    /ETIMEDOUT|timeout|timed out/i,
    "The connection timed out. Check the database accepts connections from this deployment, " +
      "for example in its IP allow list.",
  ],
  [/password authentication failed|authentication failed/i, "The username or password in the URL is wrong."],
  [/database ".*" does not exist|role ".*" does not exist/i, "The database or user named in the URL doesn't exist."],
  [/SSL|TLS|certificate/i, "The TLS handshake failed. Use the connection string your provider gives, including its sslmode."],
  [/too many (clients|connections)/i, "The database is out of connections. Use the pooled connection string."],
];

/** Remove anything that could carry a credential: URLs, and key=value passwords. */
export function redactStoreError(message: string): string {
  return message
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s'"`]+/gi, "<url>")
    .replace(/(password|pwd|passwd)\s*=\s*[^\s;&'"`]+/gi, "$1=<redacted>");
}

export function describeStoreFailure(failure: {
  tried: "postgres" | "sqlite";
  host: string | null;
  error: string;
}): StoreFailure {
  const detail = redactStoreError(failure.error);
  if (failure.tried === "sqlite") {
    const node = /node:sqlite|ERR_UNKNOWN_BUILTIN_MODULE|No such built-in module/i.test(failure.error);
    return { kind: node ? "node" : "no-database", host: null, hint: null, detail };
  }
  if (/Cannot find (module|package) ['"]pg['"]/i.test(failure.error)) {
    return { kind: "pg-missing", host: failure.host, hint: null, detail };
  }
  const hint = POSTGRES_HINTS.find(([re]) => re.test(failure.error))?.[1] ?? null;
  return { kind: "postgres", host: failure.host, hint, detail };
}
