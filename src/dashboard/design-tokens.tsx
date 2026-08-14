/**
 * Polishd — design citations, rendered as things you can read at a glance.
 *
 * The Design tab's prose cites raw tokens: `#ecae12`, `1.98:1`. Both read as
 * noise mid-sentence — a hex is a color nobody can picture, and a WCAG ratio
 * is an open-ended scale only accessibility people carry in their head. These
 * helpers rewrite those citations at render time: a hex becomes a swatch you
 * can see, a ratio becomes a 0–100% contrast score (the exact ratio stays in
 * the tooltip for anyone who wants it).
 *
 * Render-time only, on purpose. The stored flags, evidence strings and AI
 * digest keep their verbatim numbers — the review pipeline verifies an issue
 * by matching its citation against the digest we sent, so rewriting the data
 * itself would break that check.
 *
 * No `"use client"` here: stateless markup, used by the server-rendered
 * sections and the client review card alike. The one exception is the color
 * chip — it copies its hex on click, so it lives in `color-chip` behind its
 * own client boundary and is re-exported from here as part of the set.
 */
import type { ReactNode } from "react";

import { ColorToken } from "./color-chip";

export { ColorToken };

/** White on black — the top of the WCAG 2.x scale. */
const MAX_RATIO = 21;

/** Below this a pairing fails AA for body text; large text only needs 3:1. */
const AA_BODY = 4.5;
const AA_LARGE = 3;

/**
 * A WCAG ratio as a 0–100% score. Logarithmic, so the scale reads evenly
 * rather than bunching every real-world pairing into its bottom fifth:
 * 1:1 → 0%, 3:1 → 36%, AA's 4.5:1 → 49%, 21:1 → 100%.
 */
export function contrastPercent(ratio: number): number {
  const clamped = Math.min(Math.max(ratio, 1), MAX_RATIO);
  return Math.round((Math.log(clamped) / Math.log(MAX_RATIO)) * 100);
}

/**
 * A ratio as a contrast percentage. Tinted only when it's a problem — red
 * clears nothing, amber clears large text only. Anything at AA stays neutral:
 * these sentences quote the threshold as often as the measurement, and a green
 * "49% contrast" inside a failure note reads like the opposite of the finding.
 */
export function ContrastToken({ ratio }: { ratio: number }) {
  const tone =
    ratio >= AA_BODY ? "text-[#ccc]" : ratio >= AA_LARGE ? "text-amber-400" : "text-red-400";
  return (
    <span
      className={`inline-flex items-center rounded bg-[#161616] px-1 py-px align-middle text-[11px] font-medium tabular-nums ${tone}`}
      title={`${ratio}:1 — WCAG AA wants ${AA_BODY}:1 for body text, ${AA_LARGE}:1 for large text`}
    >
      {contrastPercent(ratio)}% contrast
    </span>
  );
}

/**
 * The measured pairing as a scale: how far the contrast gets, with a tick at
 * the level this text size actually needs.
 */
export function ContrastMeter({ ratio, required }: { ratio: number; required: number }) {
  const pct = contrastPercent(ratio);
  const need = contrastPercent(required);
  const passes = ratio >= required;
  return (
    <span
      className="flex items-center gap-2"
      role="img"
      aria-label={`Contrast ${pct}% of the scale, needs ${need}% — ${ratio}:1 against a ${required}:1 minimum`}
      title={`${ratio}:1 against the WCAG AA ${required}:1 minimum`}
    >
      <span className="relative h-1.5 w-20 overflow-hidden rounded-full bg-[#1c1c1c]">
        <span
          className={`absolute inset-y-0 left-0 rounded-full ${passes ? "bg-emerald-500" : "bg-red-500"}`}
          style={{ width: `${pct}%` }}
        />
        <span className="absolute inset-y-0 w-px bg-[#777]" style={{ left: `${need}%` }} />
      </span>
      <span
        className={`text-[12px] font-medium tabular-nums ${passes ? "text-emerald-400" : "text-red-400"}`}
      >
        {pct}%
      </span>
    </span>
  );
}

/**
 * Hexes (always 6 or 8 digits — the scanner normalizes them, so a CSS id like
 * `#nav` can't be mistaken for a color) and `4.5:1`-style ratios.
 */
const CITATION = /#[0-9a-f]{8}\b|#[0-9a-f]{6}\b|\d+(?:\.\d+)?:1(?![\d.])/gi;

/**
 * A finding's text with its citations swapped for the tokens above. Anything
 * unrecognized is left exactly as written.
 */
export function Annotated({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(CITATION)) {
    const at = m.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    const token = m[0];
    parts.push(
      token.startsWith("#") ? (
        <ColorToken key={at} hex={token.toLowerCase()} />
      ) : (
        <ContrastToken key={at} ratio={Number(token.slice(0, -2))} />
      ),
    );
    last = at + token.length;
  }
  if (parts.length === 0) return <>{text}</>;
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
