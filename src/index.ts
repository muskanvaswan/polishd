/**
 * @buffd/next — isomorphic entry point.
 *
 * Safe to import anywhere (client or server). Exposes only config + the event
 * schema; nothing here touches Node, the DOM, or the database. For capture use
 * `@buffd/next/client`, for storage/queries `@buffd/next/server`.
 */
export * from "./config";
export * from "./shared/types";
