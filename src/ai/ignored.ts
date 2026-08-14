/**
 * Polishd — ignored losses (server only).
 *
 * The counterpart to filing a bug. A loss is a claim the model made from the
 * analytics; "File bug" says *yes, and here's the tracker issue*, and this says
 * *no — stop telling me about it*, with or without a reason.
 *
 * A dismissal is not just a UI toggle, or the next regenerate would hand the
 * same problem straight back:
 *
 *   1. Ignored losses are dropped from every summary that renders — the fresh
 *      one and the cached one alike — before the four-loss cap applies, so
 *      dismissing one promotes a real problem into its place rather than
 *      leaving a gap.
 *   2. The dismissals (and their reasons) are replayed into the prompt of every
 *      later model call, so the model knows what has already been reviewed and
 *      rejected, and why. "Checkout CTA is fine, it's a two-step flow on
 *      purpose" is context no digest can carry.
 *   3. They fold into the summary fingerprint, so ignoring something marks the
 *      cached summary stale and a regenerate actually re-asks the model.
 *
 * Keyed by the evidence citation — the same key the GitHub issue log uses (see
 * issues.ts) — so a problem refound under slightly different wording is still
 * recognised as the one that was dismissed.
 */
import { getMeta, setMeta } from "../server/store";
import { fingerprintDigest } from "./digest";
import type { PolishdIgnoredLoss, PolishdLossItem, PolishdSummary } from "./types";

const IGNORED_KEY = "ignored_losses";

/** Keep the log (and the prompt section built from it) bounded. */
const MAX_STORED = 50;
const MAX_IN_PROMPT = 20;
const MAX_ISSUE_CHARS = 160;
const MAX_REASON_CHARS = 240;

/** Same normalization as the issue log: one citation, one verdict. */
export function ignoreKey(evidence: string): string {
  return evidence.trim().toLowerCase();
}

type IgnoredLog = Record<string, PolishdIgnoredLoss>;

async function loadLog(): Promise<IgnoredLog> {
  const raw = await getMeta(IGNORED_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as IgnoredLog;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** Every dismissal, newest first. */
export async function loadIgnoredLosses(): Promise<PolishdIgnoredLoss[]> {
  return Object.values(await loadLog()).sort((a, b) => b.ignoredAt - a.ignoredAt);
}

/** The evidence keys to filter losses by. */
export function ignoredKeys(list: PolishdIgnoredLoss[]): Set<string> {
  return new Set(list.map((i) => ignoreKey(i.evidence)));
}

const clip = (s: string, max: number): string => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/**
 * Dismiss one loss, with an optional reason. Re-ignoring an already-ignored
 * loss updates its reason (that's the "add a reason afterwards" path), keeping
 * the original timestamp so the log stays in the order things were reviewed.
 */
export async function ignoreLoss(
  loss: Pick<PolishdLossItem, "issue" | "evidence">,
  reason?: string,
): Promise<PolishdIgnoredLoss | null> {
  const evidence = loss.evidence.trim();
  if (!evidence) return null;
  const key = ignoreKey(evidence);
  const log = await loadLog();
  const trimmed = reason?.trim();

  const entry: PolishdIgnoredLoss = {
    issue: clip(loss.issue, MAX_ISSUE_CHARS),
    evidence,
    reason: trimmed ? clip(trimmed, MAX_REASON_CHARS) : undefined,
    ignoredAt: log[key]?.ignoredAt ?? Date.now(),
  };
  log[key] = entry;

  // Bound the log: oldest dismissals fall off first.
  const keys = Object.keys(log);
  if (keys.length > MAX_STORED) {
    for (const k of keys
      .sort((a, b) => log[a].ignoredAt - log[b].ignoredAt)
      .slice(0, keys.length - MAX_STORED)) {
      delete log[k];
    }
  }

  return (await setMeta(IGNORED_KEY, JSON.stringify(log))) ? entry : null;
}

/** Undo a dismissal. Returns false only when the store refused the write. */
export async function unignoreLoss(evidence: string): Promise<boolean> {
  const log = await loadLog();
  const key = ignoreKey(evidence);
  if (!(key in log)) return true; // already gone — nothing to undo
  delete log[key];
  return setMeta(IGNORED_KEY, JSON.stringify(log));
}

/**
 * The dismissals as prompt context: what the owner already reviewed and
 * rejected, so the model doesn't spend a loss slot re-reporting it. Reasons are
 * included verbatim — they're the part the analytics can't tell the model.
 */
export function ignoredSection(list: PolishdIgnoredLoss[]): string | null {
  if (list.length === 0) return null;
  const lines = list
    .slice(0, MAX_IN_PROMPT)
    .map(
      (i) =>
        `- "${i.issue}" (cited: ${i.evidence}) — ` +
        (i.reason ? `dismissed because: ${i.reason}` : "dismissed without a reason"),
    );
  return (
    "ALREADY REVIEWED AND DISMISSED BY THE SITE OWNER (do not report these " +
    "again, in these or any other words — treat a stated reason as true):\n" +
    lines.join("\n")
  );
}

/** Hash of the dismissals, so a new one invalidates the cached summary. */
export function ignoredFingerprint(list: PolishdIgnoredLoss[]): string {
  if (list.length === 0) return "";
  return fingerprintDigest(
    list
      .slice(0, MAX_IN_PROMPT)
      .map((i) => `${ignoreKey(i.evidence)}:${i.reason ?? ""}`)
      .sort()
      .join("|"),
  );
}

/** Drop dismissed losses from a summary about to be rendered. */
export function withoutIgnored(
  summary: PolishdSummary,
  keys: Set<string>,
): PolishdSummary {
  if (!summary.losses?.length || keys.size === 0) return summary;
  const losses = summary.losses.filter((l) => !keys.has(ignoreKey(l.evidence)));
  return losses.length === summary.losses.length ? summary : { ...summary, losses };
}
