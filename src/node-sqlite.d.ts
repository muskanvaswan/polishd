/**
 * Minimal ambient types for Node's built-in `node:sqlite` module.
 *
 * Node 24 ships this module at runtime, but `@types/node@20` doesn't declare
 * it yet. This covers only the synchronous surface Buffd uses; remove once the
 * installed @types/node includes node:sqlite.
 */
declare module "node:sqlite" {
  interface StatementSync {
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  }

  export class DatabaseSync {
    constructor(path: string, options?: { open?: boolean; readOnly?: boolean });
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
