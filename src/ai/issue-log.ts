/**
 * Polishd — the log of what polishd filed (server only).
 *
 * Every finding that went through the verify-and-file pipeline leaves an
 * entry here, keyed by its evidence citation: the issue it became, or the
 * verdict that kept it out of the tracker. It's what stops the same problem
 * being re-investigated or filed twice (issues.ts), what the Actionables tab
 * joins back to its findings, and what tells the fix pipelines (fix.ts,
 * fix-dispatch.ts) that an issue number is polishd's — and what it was filed
 * from, which GitHub was never told.
 */
import { getMeta, setMeta } from "../server/store";

const ISSUE_LOG_KEY = "github_issue_log";

/**
 * Per-evidence outcome: a filed issue, or a rejection we won't re-litigate.
 *
 * The filed half carries the context GitHub can't tell us later — the
 * analytics claim it came from, the verdict that let it through, when we filed
 * it — because that's what makes the Issues tab more than a copy of the
 * tracker. Every one of those fields is optional: entries written by earlier
 * versions have only the url and the number, and still read fine.
 */
export type FiledEntry = {
  url: string;
  number: number;
  /** The problem as the summary stated it. */
  issue?: string;
  /** Whether the source verified the report before it was filed. */
  verdict?: "confirmed" | "inconclusive";
  /** When it was filed, ms since epoch. */
  filedAt?: number;
  /** Which review found it. Absent on older filings. */
  source?: "loss" | "design";
  /** The analytics signal behind a loss ("dead_click"…), which says how it was detected. */
  signalKind?: string;
  /**
   * The citation as the review wrote it. The log's key is a lower-cased
   * copy, kept for matching; this is what code is searched for.
   */
  evidence?: string;
};

export type LogEntry = FiledEntry | { rejected: true; reason: string };

export type IssueLog = Record<string, LogEntry>;

export function issueKey(evidence: string): string {
  return evidence.trim().toLowerCase();
}

export async function loadIssueLog(): Promise<IssueLog> {
  const raw = await getMeta(ISSUE_LOG_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as IssueLog;
  } catch {
    return {};
  }
}

export async function recordLog(key: string, entry: LogEntry): Promise<void> {
  const log = await loadIssueLog();
  log[key] = entry;
  await setMeta(ISSUE_LOG_KEY, JSON.stringify(log));
}

/** One filed issue, as the log knows it. */
export interface FiledRecord {
  /**
   * The citation it was filed from — as written where the entry kept it, and
   * otherwise the log's lower-cased key.
   */
  evidence: string;
  /** The problem as the review stated it. */
  claim?: string;
  verdict?: "confirmed" | "inconclusive";
  source?: "loss" | "design";
  signalKind?: string;
}

/**
 * The local record behind one filed issue number — the citation and claim
 * GitHub was never told. The fix pipelines use it to ground their work in
 * the right element, and its absence is how a number that isn't ours gets
 * refused.
 */
export async function findFiledIssue(number: number): Promise<FiledRecord | null> {
  for (const [key, entry] of Object.entries(await loadIssueLog())) {
    if (!("rejected" in entry) && entry.number === number) {
      return {
        evidence: entry.evidence ?? key,
        claim: entry.issue,
        verdict: entry.verdict,
        source: entry.source,
        signalKind: entry.signalKind,
      };
    }
  }
  return null;
}

/** Every issue number polishd filed. */
export async function filedIssueNumbers(): Promise<Set<number>> {
  const out = new Set<number>();
  for (const entry of Object.values(await loadIssueLog())) {
    if (!("rejected" in entry)) out.add(entry.number);
  }
  return out;
}
