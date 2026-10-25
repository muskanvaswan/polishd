/**
 * Polishd — what an actionable is, and how the list of them is put together.
 *
 * The analytics summary finds losses; the design review finds issues; the
 * owner files some of them as GitHub issues. Those used to be three places —
 * a rail under each review, and a tab listing the tracker. An actionable is
 * the one thing all three describe: a problem worth acting on, where it came
 * from, and the issue filed for it, if any.
 *
 * The join is by the citation. The issue log that `File bug` writes is keyed
 * by the finding's evidence (lower-cased and trimmed; see ai/issues.ts), and
 * so is the list of filed issues the Actionables tab reads back, so a filed
 * issue finds its finding again however many summaries have run since. A
 * filed issue whose finding is no longer in the current summary or review —
 * fixed, dismissed, or re-worded away — stays listed on its own, with the
 * state the tracker gives it, so filing is never the last anyone hears of it.
 *
 * Pure, with type-only imports: the server shell counts with it, the client
 * list renders from it, and the test file pins the join and the order.
 */
import type { PolishdDesignIssue, PolishdFiledIssue, PolishdLossItem } from "../ai/types";

/** The finding behind an actionable, from whichever review reported it. */
export type ActionableFinding =
  | { source: "analytics"; loss: PolishdLossItem }
  | { source: "design"; issue: PolishdDesignIssue };

/** The GitHub issue filed for an actionable. */
export interface ActionableLink {
  url: string;
  number: number;
}

export interface Actionable {
  /** Stable within a render: `loss:<evidence>`, `design:<key>`, `filed:<number>`. */
  id: string;
  /** Null for an issue filed from a finding no current review holds. */
  finding: ActionableFinding | null;
  /** The issue filed for it, when there is one. */
  link: ActionableLink | null;
  /**
   * That issue as the tracker reports it — set when the list was loaded with
   * GitHub connected and the issue is polishd's. Null with a `link` means the
   * link is known (from the finding) but the live state wasn't loaded.
   */
  filed: PolishdFiledIssue | null;
}

/** How the issue log keys a finding — the same rule as `issueKey` in ai/issues.ts. */
export function logKey(evidence: string): string {
  return evidence.trim().toLowerCase();
}

/**
 * A finding's identity in the dashboard: its citation and its wording. Two
 * design issues can cite identical evidence ("#888888 on #0a0a0a" for
 * captions, and for placeholders), so evidence alone would make ignoring one
 * hide both — the same reason the dismissal log stores each issue apart.
 * (Also exported from fix-prompt.ts; one definition, re-exported there.)
 */
export function findingKey(f: { issue: string; evidence: string }): string {
  return `${f.evidence.trim()}\u0000${f.issue.trim()}`;
}

/** The finding's wording, or the tracker's title for an issue without one. */
export function actionableTitle(a: Actionable): string {
  if (a.finding) return a.finding.source === "analytics" ? a.finding.loss.issue : a.finding.issue.issue;
  return a.filed?.detail?.title ?? a.filed?.claim ?? `Issue #${a.link?.number ?? "?"}`;
}

/** The citation an actionable was found from. */
export function actionableEvidence(a: Actionable): string {
  if (a.finding) return a.finding.source === "analytics" ? a.finding.loss.evidence : a.finding.issue.evidence;
  return a.filed?.evidence ?? "";
}

/**
 * Open issues before closed, the unknown in between, newest first within each
 * — the order a tracker's own list uses, and the one that keeps what still
 * needs doing at the top.
 */
function trackedOrder(a: Actionable, b: Actionable): number {
  const rank = (x: Actionable) => {
    const state = x.filed?.detail?.state;
    return state === "open" ? 0 : state === "closed" ? 2 : 1;
  };
  const age = (x: Actionable) =>
    x.filed?.detail?.createdAt ?? x.filed?.filedAt ?? x.link?.number ?? 0;
  return rank(a) - rank(b) || age(b) - age(a);
}

export interface ActionableGroups {
  /** Findings with no issue filed — what's left to decide. */
  open: Actionable[];
  /** Everything filed: current findings with their issue, then older filings. */
  tracked: Actionable[];
}

/**
 * The actionables, grouped: what still needs deciding first, then what's
 * already in the tracker. Within the open group the summary's losses come
 * before the review's issues, each in its review's order (worst first).
 */
export function groupActionables(
  losses: readonly PolishdLossItem[],
  designIssues: readonly PolishdDesignIssue[],
  filed: readonly PolishdFiledIssue[],
): ActionableGroups {
  const byKey = new Map(filed.map((f) => [f.evidence, f] as const));
  const claimed = new Set<string>();
  const open: Actionable[] = [];
  const tracked: Actionable[] = [];

  const place = (
    id: string,
    finding: ActionableFinding,
    evidence: string,
    own: { issueUrl?: string; issueNumber?: number },
  ) => {
    const key = logKey(evidence);
    const f = byKey.get(key) ?? null;
    if (f) claimed.add(key);
    const link: ActionableLink | null = f
      ? { url: f.url, number: f.number }
      : own.issueUrl
        ? { url: own.issueUrl, number: own.issueNumber ?? 0 }
        : null;
    (link ? tracked : open).push({ id, finding, link, filed: f });
  };

  for (const loss of losses) {
    place(`loss:${loss.evidence}`, { source: "analytics", loss }, loss.evidence, loss);
  }
  for (const issue of designIssues) {
    place(`design:${findingKey(issue)}`, { source: "design", issue }, issue.evidence, issue);
  }
  for (const f of filed) {
    if (claimed.has(f.evidence)) continue;
    tracked.push({
      id: `filed:${f.number}`,
      finding: null,
      link: { url: f.url, number: f.number },
      filed: f,
    });
  }
  tracked.sort(trackedOrder);
  return { open, tracked };
}

/** The list as rendered: open first, then tracked. */
export function buildActionables(
  losses: readonly PolishdLossItem[],
  designIssues: readonly PolishdDesignIssue[],
  filed: readonly PolishdFiledIssue[],
): Actionable[] {
  const { open, tracked } = groupActionables(losses, designIssues, filed);
  return [...open, ...tracked];
}
