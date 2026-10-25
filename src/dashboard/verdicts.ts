/**
 * Polishd — reading a coding agent's verdicts back.
 *
 * The fix prompt asks the agent to finish with a JSON block, one entry per
 * finding: `fixed`, `not_real` or `deliberate`, with a reason and the files
 * involved. `fixed` needs nothing from Polishd (the next review will see
 * whether it held). The other two are exactly what a dismissal is for. Without
 * this path the agent's "left it, it's deliberate" stayed in its chat, and the
 * next review reported the same finding again.
 *
 * Agents don't always echo a format exactly, so the parse is forgiving about
 * where the block sits (the last fenced block, or a bare array, or an object
 * holding one) and about how a verdict is spelled ("not real", "Not-Real"),
 * and strict about what it means: an entry with an unknown id or verdict is
 * reported, never guessed at.
 *
 * The paste is untrusted text — the owner copies an agent's output back — and
 * a dismissal's reason is replayed into every later model prompt. So only
 * `id`, `verdict`, `reason` and `files` are read (anything else is dropped),
 * a reason is flattened to one line and clipped, a block is capped in length,
 * and a verdict only counts for a finding that the prompt listed and that's
 * still in the current summary or review. The server checks the last part
 * again (actions.ts) and takes the finding's wording from its own copy.
 *
 * Pure, with type-only imports, so the tests exercise it directly.
 */
import type { PolishdVerdictDismissal } from "../ai/types";
import type { FixPromptFinding } from "./fix-prompt";

export type VerdictKind = "fixed" | "not_real" | "deliberate";

export interface AgentVerdict {
  /** "A1", "D2"… */
  id: string;
  verdict: VerdictKind;
  reason: string;
  files: string[];
}

/** A verdict block is one entry per finding; this is far past any real one. */
export const MAX_VERDICTS = 20;
/** An agent's reason, as stored: room for a sentence, not a payload. */
export const MAX_VERDICT_REASON = 200;
/** A pasted reply longer than this isn't read. */
const MAX_PASTE_CHARS = 100_000;

/**
 * An agent's reason, made safe to replay: control characters and line breaks
 * gone, whitespace collapsed, clipped to `MAX_VERDICT_REASON`.
 */
export function cleanVerdictReason(reason: unknown): string {
  if (typeof reason !== "string") return "";
  const flat = reason
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > MAX_VERDICT_REASON ? `${flat.slice(0, MAX_VERDICT_REASON - 1)}…` : flat;
}

export interface ParsedVerdicts {
  verdicts: AgentVerdict[];
  /** What couldn't be read, in words for the person pasting. */
  problems: string[];
}

/** Every fenced block's body, last first: the verdict block ends the reply. */
function fencedBlocks(text: string): string[] {
  return [...text.matchAll(/```[\w-]*[^\S\n]*\n([\s\S]*?)```/g)].map((m) => m[1]).reverse();
}

/** The array a candidate holds, if it holds one. */
function arrayIn(candidate: string): unknown[] | null {
  const start = candidate.indexOf("[");
  const end = candidate.lastIndexOf("]");
  if (start >= 0 && end > start) {
    try {
      const parsed: unknown = JSON.parse(candidate.slice(start, end + 1));
      if (Array.isArray(parsed)) return parsed;
    } catch {
      /* try the object form */
    }
  }
  const objStart = candidate.indexOf("{");
  const objEnd = candidate.lastIndexOf("}");
  if (objStart >= 0 && objEnd > objStart) {
    try {
      const parsed = JSON.parse(candidate.slice(objStart, objEnd + 1)) as Record<string, unknown>;
      if (Array.isArray(parsed?.verdicts)) return parsed.verdicts;
    } catch {
      /* not JSON */
    }
  }
  return null;
}

function verdictKind(v: unknown): VerdictKind | null {
  if (typeof v !== "string") return null;
  const k = v.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (k === "fixed" || k === "deliberate") return k;
  if (k === "not_real" || k === "notreal") return "not_real";
  return null;
}

/** Read the verdict block out of whatever the agent replied. */
export function parseVerdicts(text: string): ParsedVerdicts {
  const problems: string[] = [];
  if (text.length > MAX_PASTE_CHARS) {
    return { verdicts: [], problems: ["That's too long to be a verdict block — paste just the JSON list."] };
  }
  // The last block that reads as verdicts; failing that, the last array at all,
  // so a malformed block is reported rather than missed.
  const arrays = [...fencedBlocks(text), text].map(arrayIn).filter((a) => a !== null);
  const looksLikeVerdicts = (a: unknown[]) =>
    a.some((e) => e !== null && typeof e === "object" && "verdict" in e);
  const entries = arrays.find(looksLikeVerdicts) ?? arrays[0] ?? null;
  if (!entries) {
    return {
      verdicts: [],
      problems: text.trim() ? ["No verdict block found — paste the JSON list the agent ended with."] : [],
    };
  }

  if (entries.length > MAX_VERDICTS) {
    problems.push(`Only the first ${MAX_VERDICTS} entries are read.`);
  }
  const byId = new Map<string, AgentVerdict>();
  entries.slice(0, MAX_VERDICTS).forEach((raw, i) => {
    const entry = (raw ?? {}) as Record<string, unknown>;
    const label = `Entry ${i + 1}`;
    const id = typeof entry.id === "string" ? entry.id.trim().toUpperCase() : "";
    if (!/^[AD]\d{1,2}$/.test(id)) {
      problems.push(`${label}: "id" should be a finding id like A1 or D2.`);
      return;
    }
    const verdict = verdictKind(entry.verdict);
    if (!verdict) {
      problems.push(`${id}: "verdict" should be fixed, not_real or deliberate.`);
      return;
    }
    if (byId.has(id)) problems.push(`${id} appears twice; the last one is used.`);
    // Only these four fields are read; anything else the agent added is dropped.
    byId.set(id, {
      id,
      verdict,
      reason: cleanVerdictReason(entry.reason),
      files: Array.isArray(entry.files)
        ? entry.files
            .filter((f): f is string => typeof f === "string" && /^[\w@~.()[\]/-]{1,200}$/.test(f.trim()))
            .map((f) => f.trim())
            .slice(0, 10)
        : [],
    });
  });
  return { verdicts: [...byId.values()], problems };
}

/** What recording one verdict would do. */
export type VerdictPlan =
  /** `currentId` is the finding's id now, which the server looks it up by. */
  | { verdict: AgentVerdict; finding: FixPromptFinding; action: "dismiss"; reason: string; currentId: string }
  | { verdict: AgentVerdict; finding: FixPromptFinding; action: "none" }
  /** The finding was listed, but is no longer in the summary or review (ignored, or regenerated away). */
  | { verdict: AgentVerdict; finding: FixPromptFinding; action: "gone" }
  /** No finding had this id in the prompt. */
  | { verdict: AgentVerdict; action: "unknown" };

/**
 * The reason a dismissal is stored with. It's replayed to the model on every
 * later review, so it says who decided and why — and nothing else: the files
 * stay out, since they're for the person reading the preview, not the model.
 */
export function dismissalReason(verdict: "not_real" | "deliberate", reason: string): string {
  const what = verdict === "not_real" ? "Not real" : "Deliberate";
  const why = cleanVerdictReason(reason);
  return `${what}, per the coding agent${why ? `: ${why}` : ""}`;
}

/** One finding in two listings: same review, same citation, same wording. */
const sameFinding = (a: FixPromptFinding, b: FixPromptFinding) =>
  a.source === b.source && a.evidence.trim() === b.evidence.trim() && a.issue.trim() === b.issue.trim();

/**
 * Match verdicts to findings. `seen` is the numbering the agent saw — the
 * prompt as it was copied, since an ignore or a regenerate in between
 * renumbers it — and `current` is what the summary and review hold now. A
 * verdict counts only for a finding in both.
 */
export function planVerdicts(
  verdicts: AgentVerdict[],
  seen: FixPromptFinding[],
  current: FixPromptFinding[] = seen,
): VerdictPlan[] {
  const byId = new Map(seen.map((f) => [f.id, f]));
  return verdicts.map((verdict): VerdictPlan => {
    const finding = byId.get(verdict.id);
    if (!finding) return { verdict, action: "unknown" };
    const now = current.find((c) => sameFinding(c, finding));
    if (!now) return { verdict, finding, action: "gone" };
    if (verdict.verdict === "fixed") return { verdict, finding, action: "none" };
    return {
      verdict,
      finding,
      action: "dismiss",
      reason: dismissalReason(verdict.verdict, verdict.reason),
      currentId: now.id,
    };
  });
}

/** A finding as the server holds it: its wording and its citation. */
interface StoredFinding {
  issue: string;
  evidence: string;
}

/** One dismissal the server will write, with the citation the client sent. */
export interface SelectedDismissal {
  source: "analytics" | "design";
  /** The id as sent, for the client to match the result back. */
  id: string;
  /** The stored finding: its wording is what gets replayed, not the request's. */
  finding: StoredFinding;
  reason: string;
}

const citation = (s: string) => s.trim().toLowerCase();

/**
 * The server's check on a verdict request (recordVerdictsAction), kept pure so
 * it's tested directly. The request came from a paste, so nothing in it is
 * taken on trust: it must be an array of at most `MAX_VERDICTS`; each entry
 * needs a known source, a `not_real` or `deliberate` verdict, and an id that
 * names a finding in the current summary or review — numbered as the fix
 * prompt numbers them — whose citation matches the one sent. The id is what
 * picks the finding (two design issues can cite identical evidence); the
 * citation guards against the numbering having moved underneath. The wording
 * comes from that stored finding; the only request text kept is the reason,
 * cleaned and labelled as the agent's. Unknown fields are never read. Null
 * means the request isn't a verdict block at all.
 */
export function selectVerdictDismissals(
  request: unknown,
  current: { losses: StoredFinding[]; issues: StoredFinding[] },
): { selected: SelectedDismissal[]; skipped: number } | null {
  if (!Array.isArray(request) || request.length > MAX_VERDICTS) return null;
  // The fix prompt's numbering: A1… for losses, D1… for design issues.
  const byId = new Map<string, { source: "analytics" | "design"; finding: StoredFinding }>([
    ...current.losses.map((f, i) => [`A${i + 1}`, { source: "analytics" as const, finding: f }] as const),
    ...current.issues.map((f, i) => [`D${i + 1}`, { source: "design" as const, finding: f }] as const),
  ]);
  const selected: SelectedDismissal[] = [];
  let skipped = 0;
  for (const raw of request as Partial<PolishdVerdictDismissal>[]) {
    const id = typeof raw?.id === "string" ? raw.id.trim().toUpperCase() : "";
    const verdict = raw?.verdict;
    const named = byId.get(id);
    if (
      !named ||
      named.source !== raw?.source ||
      typeof raw.evidence !== "string" ||
      citation(raw.evidence) !== citation(named.finding.evidence) ||
      (verdict !== "not_real" && verdict !== "deliberate")
    ) {
      skipped++;
      continue;
    }
    const { finding, source } = named;
    selected.push({
      source,
      id,
      finding: { issue: finding.issue, evidence: finding.evidence },
      reason: dismissalReason(verdict, typeof raw.reason === "string" ? raw.reason : ""),
    });
  }
  return { selected, skipped };
}
