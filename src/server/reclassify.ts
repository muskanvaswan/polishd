/**
 * Polishd — one-time history reclassification (server only).
 *
 * The capture layer stopped recording clicks on text as dead/rage clicks —
 * reading isn't friction. Rows stored by older clients still carry the old
 * semantics though, and the precedent here (see `getRecentErrors`) is that a
 * fix applies to history, not just to new sessions. Deleting the owner's data
 * is off the table, so misclassified rows are retyped to `text_click`: kept in
 * the table, visible to raw debugging, counted by nothing — exactly as if the
 * new client had captured them.
 *
 * The stored columns carry enough to re-run the live decision: `selector`
 * keeps the same 4-level tag path the client's ancestor walk saw, and `text`
 * holds the target's label — see `shared/text-signals.ts`, which both sides
 * import so they can't drift.
 *
 * Runs once per database, guarded by a `polishd_meta` version key, triggered
 * lazily from the dashboard read path so the ingest hot path never pays for
 * it. Idempotent and chunked, so a crash mid-way (the key is only written at
 * the end) or two serverless instances racing just redo harmless UPDATEs.
 */
import { reclassifiedClickType } from "../shared/text-signals";
import { exec, getMeta, query, setMeta, storeReady } from "./store";

/** Bump when the classification rules change and history should be re-swept. */
const SEMANTICS_KEY = "signal_semantics";
const SEMANTICS_VERSION = "2";

const UPDATE_CHUNK = 500;

let sweep: Promise<void> | null = null;

/** Kick off (or join) the one-time sweep. Never throws, never blocks ingest. */
export function ensureReclassifiedHistory(): Promise<void> {
  return (sweep ??= run().catch((err) => {
    // Leave the meta key unwritten and let a later dashboard load retry.
    sweep = null;
    console.warn(
      "[polishd] history reclassification failed, will retry:",
      err instanceof Error ? err.message : err,
    );
  }));
}

async function run(): Promise<void> {
  if (!(await storeReady())) return;
  if ((await getMeta(SEMANTICS_KEY)) === SEMANTICS_VERSION) return;

  // All rows, including cross-install telemetry — every writer used the same
  // client classification, so every writer's history has the same skew.
  const rows = await query(
    `SELECT id, type, selector, text FROM events WHERE type IN ('dead_click', 'rage_click')`,
  );

  const ids: number[] = [];
  for (const r of rows) {
    const selector = typeof r.selector === "string" ? r.selector : undefined;
    const text = typeof r.text === "string" ? r.text : undefined;
    if (reclassifiedClickType(String(r.type), selector, text) === "text_click") {
      ids.push(Number(r.id));
    }
  }

  for (let i = 0; i < ids.length; i += UPDATE_CHUNK) {
    const chunk = ids.slice(i, i + UPDATE_CHUNK);
    const ok = await exec(
      `UPDATE events SET type = 'text_click' WHERE id IN (${chunk.map(() => "?").join(", ")})`,
      chunk,
    );
    if (!ok) return; // no key written — retried on the next dashboard load
  }

  if (ids.length > 0) {
    console.log(
      `[polishd] reclassified ${ids.length} historical dead/rage click(s) as text clicks — ` +
        `clicks on text are reading, not friction, and no longer count.`,
    );
  }
  await setMeta(SEMANTICS_KEY, SEMANTICS_VERSION);
}
