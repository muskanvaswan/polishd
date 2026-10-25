/**
 * Polishd — taking the owner's dismissals out of the rule-based checks.
 *
 * Ignoring a design-review issue (ai/ignored.ts) already keeps it out of every
 * later review. But the deterministic flags (design-flags.ts) run over the
 * same measurements, so "13px padding is deliberate" would go on being
 * flagged in the Design tab's notes, and quoted to the model, after the owner
 * had answered it. This turns the dismissals into the values they cite, which
 * the checks then leave out:
 *
 *   - An issue about type, radii or padding dismisses the px values it cites
 *     in that section (`type:13px`, `radius:6px`, `spacing:13px`). One whose
 *     section the data can't settle dismisses each value in every section
 *     that renders it.
 *   - A palette issue dismisses its colors (`color:#fafafa`).
 *   - A contrast issue dismisses its pairs (`contrast:#0a0a0a #888888`, the
 *     two colors sorted), or with one color cited, every pair using it.
 *   - Evidence that names no values ("5 distinct radii") falls back to the
 *     issue's own wording ("Radii mix 4, 6, 8, 10 and 12px"), read the same
 *     way. An issue that names none anywhere ("too many font families")
 *     can't be placed and dismisses nothing.
 *
 * A dismissal marked fixed counts the same: either way the owner has dealt
 * with it. Undoing the dismissal brings the values back on the next read, as
 * nothing here is stored.
 *
 * Pure, with type-only imports from the store side; the test file drives it.
 */
import type { DismissedDesignIssue, KnownDesignValues } from "../ai/design-suggestions";
import { designIssueSignature, hexKey, pxKey } from "../ai/design-suggestions";
import { radiusPx } from "../shared/design-values";

/** Why a value is left out: the issue that cited it, as the owner answered it. */
export interface DesignDismissal {
  /** The dismissed issue's wording. */
  issue: string;
  reason?: string;
  /** Dismissed as fixed rather than as not a problem. */
  fixed?: boolean;
}

/** Dismissed values, by `typeKey`, `radiusKey`, `spacingKey`, `colorKey` or `contrastKey`. */
export type DesignDismissedValues = Record<string, DesignDismissal>;

export const typeKey = (px: number): string => `type:${pxKey(px)}`;
export const spacingKey = (px: number): string => `spacing:${pxKey(px)}`;
/** A radius label's key; "full" has none, as no px value names it. */
export const radiusKey = (value: string): string | null => {
  const px = radiusPx(value);
  return Number.isFinite(px) ? `radius:${pxKey(px)}` : null;
};
export const colorKey = (hex: string): string => `color:${hexKey(hex)}`;
export const contrastKey = (a: string, b: string): string => `contrast:${[hexKey(a), hexKey(b)].sort().join(" ")}`;

/** The dismissal covering a contrast pair: the pair itself, or either color cited alone. */
export function contrastDismissal(
  dismissed: DesignDismissedValues,
  fg: string,
  bg: string,
): DesignDismissal | undefined {
  return dismissed[contrastKey(fg, bg)] ?? dismissed[`contrast:${hexKey(fg)}`] ?? dismissed[`contrast:${hexKey(bg)}`];
}

/** The dismissal covering a radius label, if any. */
export function radiusDismissal(dismissed: DesignDismissedValues, value: string): DesignDismissal | undefined {
  const key = radiusKey(value);
  return key ? dismissed[key] : undefined;
}

/**
 * The values the dismissed issues cite, read against the current data. The
 * list comes newest first, so a value two dismissals cite carries the newer
 * one's reason.
 */
export function dismissedDesignValues(
  dismissed: readonly DismissedDesignIssue[],
  known: KnownDesignValues,
): DesignDismissedValues {
  const out: DesignDismissedValues = {};
  const add = (key: string, d: DismissedDesignIssue) => {
    if (key in out) return;
    out[key] = {
      issue: d.issue,
      ...(d.reason ? { reason: d.reason } : {}),
      ...(d.fixed ? { fixed: true } : {}),
    };
  };
  for (const d of dismissed) {
    const signature =
      d.signature.category === "other" ? designIssueSignature(d.issue, d.issue, known) : d.signature;
    const { category, values } = signature;
    if (category === "other" || !values) continue;
    const cited = values.split(" ");
    switch (category) {
      case "contrast":
        if (cited.length === 1) add(`contrast:${cited[0]}`, d);
        for (let i = 0; i < cited.length; i++) {
          for (let j = i + 1; j < cited.length; j++) add(contrastKey(cited[i], cited[j]), d);
        }
        break;
      case "palette":
        for (const hex of cited) add(`color:${hex}`, d);
        break;
      case "size":
        for (const px of cited) {
          for (const kind of ["type", "radius", "spacing"] as const) {
            if (known[kind].has(px)) add(`${kind}:${px}`, d);
          }
        }
        break;
      default:
        for (const px of cited) add(`${category}:${px}`, d);
    }
  }
  return out;
}
