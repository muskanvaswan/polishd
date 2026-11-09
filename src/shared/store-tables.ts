/**
 * Polishd — its tables, and which tables by those names are its own (pure;
 * shared by the store, and mirrored by `polishd db check` in bin/db.mjs).
 *
 * Polishd's tables carry its name, so they can sit in a database the app
 * already uses without clashing with the app's own. Until 0.3.2 the events
 * table was plain `events`, which an app may well have too; the store renames
 * Polishd's old one on open, and leaves an app's alone.
 *
 * A table is Polishd's by its columns, not its name. One by a Polishd name
 * without them belongs to someone else, and the store refuses it rather than
 * adopt it with "create if not exists" and alter it.
 */
export const EVENTS_TABLE = "polishd_events";
export const META_TABLE = "polishd_meta";
/** The events table's name before 0.3.2. */
export const LEGACY_EVENTS_TABLE = "events";

const EVENT_COLUMNS = ["session_id", "type", "ts", "path", "received_at"] as const;

export const POLISHD_TABLES = {
  [EVENTS_TABLE]: EVENT_COLUMNS,
  [META_TABLE]: ["key", "value", "updated_at"],
} as const;

export type PolishdTable = keyof typeof POLISHD_TABLES;
type AnyTable = PolishdTable | typeof LEGACY_EVENTS_TABLE;

const required = (table: AnyTable): readonly string[] =>
  table === LEGACY_EVENTS_TABLE ? EVENT_COLUMNS : POLISHD_TABLES[table];

/** Whose table this is, from the columns it has (none: it doesn't exist). */
export function tableOwner(table: AnyTable, columns: readonly string[]): "absent" | "polishd" | "foreign" {
  if (columns.length === 0) return "absent";
  return missingColumns(table, columns).length === 0 ? "polishd" : "foreign";
}

export function missingColumns(table: AnyTable, columns: readonly string[]): string[] {
  return required(table).filter((c) => !columns.includes(c));
}

/** In every such error, so the dashboard can tell it from a connection failure. */
export const FOREIGN_TABLE_MARK = "isn't Polishd's";

export function foreignTableError(table: PolishdTable, columns: readonly string[]): string {
  const missing = missingColumns(table, columns);
  return (
    `This database already has a table named "${table}" that ${FOREIGN_TABLE_MARK} ` +
    `(it has no ${missing.join(", ")} column${missing.length > 1 ? "s" : ""}). ` +
    `Polishd won't write to it: give Polishd a database of its own.`
  );
}

/** Every table name the store looks at before creating anything. */
export const INSPECTED_TABLES = [EVENTS_TABLE, META_TABLE, LEGACY_EVENTS_TABLE] as const;

/**
 * What the store should do before creating its tables, given the columns
 * each name has: refuse (a Polishd name taken by someone else), and whether
 * to rename Polishd's pre-0.3.2 `events` table into place.
 */
export function planTables(columnsOf: (table: AnyTable) => readonly string[]): {
  refuse: string | null;
  renameLegacy: boolean;
} {
  for (const table of Object.keys(POLISHD_TABLES) as PolishdTable[]) {
    if (tableOwner(table, columnsOf(table)) === "foreign") {
      return { refuse: foreignTableError(table, columnsOf(table)), renameLegacy: false };
    }
  }
  return {
    refuse: null,
    renameLegacy:
      tableOwner(EVENTS_TABLE, columnsOf(EVENTS_TABLE)) === "absent" &&
      tableOwner(LEGACY_EVENTS_TABLE, columnsOf(LEGACY_EVENTS_TABLE)) === "polishd",
  };
}
