/**
 * Polishd — fitting one page's design scan into a single event.
 *
 * Ingest caps a `design_scan` payload at 32,000 characters
 * (MAX_DESIGN_PAYLOAD_LEN in server/ingest.ts) and drops anything longer.
 * The scan's own caps keep an ordinary page to a couple of KB, but a huge,
 * class-heavy page with long font names and sample text can still overrun,
 * so serializing degrades in steps instead of overflowing: first the
 * declaration ids go (the counts stay, only cross-page dedupe is lost), then
 * the least-used values — every list is sorted most-used first, so shortening
 * a list only ever cuts its tail.
 *
 * Pure: types only — the test file builds worst-case payloads directly.
 */
import type { PolishdDesignScanPayload } from "../shared/types";

/** Keep the serialized payload under ingest's acceptance cap with headroom. */
export const MAX_PAYLOAD_CHARS = 28_000;

/** Blank the id string at `at` — the last slot of a tuple's declaration tail. */
function withoutIds<T extends unknown[]>(rows: T[], at: number): T[] {
  return rows.map((r) => (r.length > at ? ([...r.slice(0, at), ""] as unknown as T) : r));
}

/** Each list cut to its most-used `share`, keeping at least one entry. */
function keepTop(p: PolishdDesignScanPayload, share: number): PolishdDesignScanPayload {
  const cut = <T>(rows: T[]) => rows.slice(0, Math.max(1, Math.ceil(rows.length * share)));
  return {
    ...p,
    fonts: cut(p.fonts),
    text: cut(p.text),
    bg: cut(p.bg),
    border: cut(p.border),
    pairs: cut(p.pairs),
    radii: cut(p.radii),
    pad: cut(p.pad),
  };
}

/**
 * Serialize within MAX_PAYLOAD_CHARS, shrinking a pathological page until it
 * fits. Empty only if even each list's top tenth can't — which the scan's
 * string caps make impossible in practice.
 */
export function serializeDesignScan(payload: PolishdDesignScanPayload, max = MAX_PAYLOAD_CHARS): string {
  let out = JSON.stringify(payload);
  if (out.length <= max) return out;
  const lean: PolishdDesignScanPayload = {
    ...payload,
    fonts: withoutIds(payload.fonts, 8),
    text: withoutIds(payload.text, 4),
    bg: withoutIds(payload.bg, 4),
    border: withoutIds(payload.border, 4),
    radii: withoutIds(payload.radii, 4),
    pad: withoutIds(payload.pad, 4),
  };
  for (const share of [1, 0.75, 0.5, 0.25, 0.1]) {
    out = JSON.stringify(keepTop(lean, share));
    if (out.length <= max) return out;
  }
  return "";
}
