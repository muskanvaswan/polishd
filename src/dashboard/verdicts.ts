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
 * Pure, with type-only imports, so the tests exercise it directly.
 */
import type { FixPromptFinding } from "./fix-prompt";

export type VerdictKind = "fixed" | "not_real" | "deliberate";

export interface AgentVerdict {
  /** "A1", "D2"… */
  id: string;
  verdict: VerdictKind;
  reason: string;
  files: string[];
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

  const byId = new Map<string, AgentVerdict>();
  entries.forEach((raw, i) => {
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
    byId.set(id, {
      id,
      verdict,
      reason: typeof entry.reason === "string" ? entry.reason.replace(/\s+/g, " ").trim() : "",
      files: Array.isArray(entry.files)
        ? entry.files.filter((f): f is string => typeof f === "string" && f.trim().length > 0)
        : [],
    });
  });
  return { verdicts: [...byId.values()], problems };
}

/** What recording one verdict would do. */
export type VerdictPlan =
  | { verdict: AgentVerdict; finding: FixPromptFinding; action: "dismiss"; reason: string }
  | { verdict: AgentVerdict; finding: FixPromptFinding; action: "none" }
  | { verdict: AgentVerdict; action: "unknown" };

/**
 * The reason a dismissal is stored with. It's replayed to the model on every
 * later review, so it says who decided and why.
 */
export function dismissalReason(v: AgentVerdict): string {
  const what = v.verdict === "not_real" ? "Not real" : "Deliberate";
  const why = v.reason ? `: ${v.reason}` : "";
  const files = v.files.length ? ` (${v.files.slice(0, 3).join(", ")})` : "";
  return `${what}, per the coding agent${why}${files}`;
}

/**
 * Match verdicts to the findings the prompt listed. `findings` must be the
 * numbering the agent saw: the prompt as it was copied, not as it would read
 * now, since an ignore or a regenerate in between renumbers it.
 */
export function planVerdicts(verdicts: AgentVerdict[], findings: FixPromptFinding[]): VerdictPlan[] {
  const byId = new Map(findings.map((f) => [f.id, f]));
  return verdicts.map((verdict): VerdictPlan => {
    const finding = byId.get(verdict.id);
    if (!finding) return { verdict, action: "unknown" };
    if (verdict.verdict === "fixed") return { verdict, finding, action: "none" };
    return { verdict, finding, action: "dismiss", reason: dismissalReason(verdict) };
  });
}
