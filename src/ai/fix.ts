/**
 * Polishd — filed issue → suggested fix (server only).
 *
 * The Issues tab shows what was reported; this module answers the next
 * question: how would you actually fix it? Only meaningful when the GitHub
 * codebase is connected — the whole point is that the suggestion is grounded
 * in the repository's real source, not in the issue text alone:
 *
 *   1. Recover the analytics evidence behind the issue from the filed log —
 *      an issue polishd didn't file is refused, there's no evidence to ground.
 *   2. Pull source: files the issue body already cites (the ones the original
 *      verification read), then code-search hits for the evidence.
 *   3. Ask the model to first CLASSIFY the bug — an interaction issue
 *      (something users do fails) or a design issue (something users see is
 *      wrong) — and then design the fix on the published practice for that
 *      class: Nielsen Norman's usability heuristics and the WAI-ARIA
 *      Authoring Practices for interaction, WCAG 2.2 and spacing/type-scale
 *      rhythm for design. The reply names the guidelines it leaned on, so the
 *      owner can judge the advice by its sources.
 *   4. The answer is an implementation path — ordered, file-by-file edits —
 *      not just prose, and it's cached per issue number: the issue and the
 *      source rarely change under it, and a regenerate is one click away.
 */
import { getMeta, setMeta } from "../server/store";
import {
  isGithubConnected,
  readGithubFile,
  readGithubIssue,
  searchGithubCode,
} from "./github";
import { evidenceSearchTerms, findFiledIssue } from "./issues";
import { loadProjectProfile } from "./profile";
import { callModel } from "./providers";
import { resolveSettings } from "./settings";
import type {
  PolishdFixStep,
  PolishdFixSuggestion,
  SuggestFixResult,
} from "./types";

const FIX_LOG_KEY = "issue_fix_suggestions";

const MAX_FILES = 4;
const MAX_CHARS_PER_FILE = 8_000;
const MAX_BODY_CHARS = 6_000;
/** The reply carries prose + steps, not one paragraph — give it headroom. */
const MAX_OUTPUT_TOKENS = 4_096;

// ── Cache ────────────────────────────────────────────────────────────────────

type FixLog = Record<string, PolishdFixSuggestion>;

async function loadFixLog(): Promise<FixLog> {
  const raw = await getMeta(FIX_LOG_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as FixLog;
  } catch {
    return {};
  }
}

/**
 * Every cached suggestion, keyed by issue number — what the Issues tab loads
 * up front so an already-answered issue opens with its fix in place.
 */
export async function listFixSuggestions(): Promise<Record<number, PolishdFixSuggestion>> {
  const log = await loadFixLog();
  const out: Record<number, PolishdFixSuggestion> = {};
  for (const s of Object.values(log)) out[s.issueNumber] = s;
  return out;
}

// ── The prompt ───────────────────────────────────────────────────────────────

const FIX_PROMPT =
  "You are a senior product engineer proposing a concrete fix for a bug that " +
  "a product-analytics tool filed from real user-behavior data. You receive " +
  "the GitHub issue (title and body), the analytics identifier cited as " +
  "evidence, and source files from the site's repository.\n\n" +
  "First classify the bug, then design the fix on the widely adopted practice " +
  "for that class:\n" +
  "- interaction: something users DO fails or frustrates — rage/dead clicks, " +
  "broken or missing handlers, unresponsive or inaccessible controls, " +
  "confusing flows, runtime errors. Ground the fix in Nielsen Norman's " +
  "usability heuristics (visibility of system status, error prevention and " +
  "recovery), the WAI-ARIA Authoring Practices for correct interactive " +
  "semantics and keyboard support, and touch-target guidance (WCAG 2.5.8 / " +
  "the 44px platform minimums).\n" +
  "- design: something users SEE is wrong — contrast, visual hierarchy, " +
  "spacing, typography, layout shift. Ground the fix in WCAG 2.2 (1.4.3 text " +
  "contrast, 1.4.11 non-text contrast), a consistent spacing rhythm and type " +
  "scale, and the web-vitals guidance on layout stability (CLS).\n\n" +
  "Respond with ONLY a JSON object (no markdown fences, no preamble):\n" +
  '{ "bugType": "interaction" | "design", "classification": string, ' +
  '"approach": string, "steps": [{ "path": string, "change": string }], ' +
  '"practices": string[] }\n\n' +
  "bugType: which class this bug falls into.\n" +
  "classification: one sentence on why it's that class.\n" +
  "approach: the fix in 2-5 sentences, written for the developer who will " +
  "implement it, citing the code it changes. Inline markdown (backticked " +
  "identifiers) is welcome; no headings.\n" +
  "steps: the implementation path, in order. Each path MUST be a repository " +
  "file path taken from the source files provided; each change describes the " +
  "exact edit in 1-3 sentences. 1-5 steps.\n" +
  "practices: 1-3 short names of the published guidelines the fix leans on, " +
  'e.g. "WCAG 2.2 §1.4.3 contrast", "ARIA APG disclosure pattern", ' +
  '"NN/g error prevention". Only ones that genuinely informed the fix.';

// ── Source gathering ─────────────────────────────────────────────────────────

/** Repo paths the issue body itself cites — `[`src/x.tsx`](…)` and the like. */
function citedPaths(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(/`([\w@./-]+\.[a-z]{2,4})`/gi)) {
    if (m[1].includes("/") && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/** The issue's own citations first, then code-search hits for the evidence. */
async function collectSource(
  evidence: string,
  body: string,
): Promise<{ path: string; content: string }[]> {
  const paths = citedPaths(body);
  for (const p of await searchGithubCode(evidenceSearchTerms(evidence), MAX_FILES)) {
    if (!paths.includes(p)) paths.push(p);
  }
  const out: { path: string; content: string }[] = [];
  for (const path of paths.slice(0, MAX_FILES)) {
    const content = await readGithubFile(path);
    if (content) out.push({ path, content: content.slice(0, MAX_CHARS_PER_FILE) });
  }
  return out;
}

// ── Parsing ──────────────────────────────────────────────────────────────────

/** Tolerant JSON extraction, same approach as the investigation parser. */
function parseSuggestion(text: string): Omit<
  PolishdFixSuggestion,
  "issueNumber" | "files" | "provider" | "model" | "generatedAt"
> | null {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(t.slice(start, end + 1)) as Record<string, unknown>;
    const approach = typeof obj.approach === "string" ? obj.approach.trim() : "";
    if (!approach) return null;
    const steps: PolishdFixStep[] = Array.isArray(obj.steps)
      ? obj.steps
          .flatMap((s) => {
            if (typeof s !== "object" || s === null) return [];
            const { path, change } = s as Record<string, unknown>;
            return typeof path === "string" && typeof change === "string" && path.trim()
              ? [{ path: path.trim(), change: change.trim() }]
              : [];
          })
          .slice(0, 5)
      : [];
    return {
      bugType: obj.bugType === "design" ? "design" : "interaction",
      classification:
        typeof obj.classification === "string" ? obj.classification.trim() : "",
      approach,
      steps,
      practices: Array.isArray(obj.practices)
        ? obj.practices
            .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
            .slice(0, 3)
        : [],
    };
  } catch {
    return null;
  }
}

// ── The pipeline ─────────────────────────────────────────────────────────────

/**
 * Propose (or re-propose, with `force`) a fix for one filed issue. Refuses
 * cleanly when nothing is connected, no model key is set, or the number isn't
 * an issue polishd filed; a model hiccup comes back as `provider-error`, and
 * nothing is cached on failure.
 */
export async function suggestIssueFix(
  issueNumber: number,
  force = false,
): Promise<SuggestFixResult> {
  if (!(await isGithubConnected())) {
    return {
      ok: false,
      error: "not-connected",
      message: "Connect a GitHub repository in the settings first.",
    };
  }
  const { settings } = await resolveSettings();
  if (!settings.apiKey) {
    return {
      ok: false,
      error: "no-key",
      message: "Configure a model API key in the settings first.",
    };
  }

  const key = String(issueNumber);
  if (!force) {
    const cached = (await loadFixLog())[key];
    if (cached) return { ok: true, suggestion: cached, regenerated: false };
  }

  const filed = await findFiledIssue(issueNumber);
  if (!filed) {
    return {
      ok: false,
      error: "not-found",
      message: `Issue #${issueNumber} isn't one polishd filed.`,
    };
  }

  // Live issue text when GitHub will still give it; the stored claim otherwise.
  const detail = await readGithubIssue(issueNumber);
  const title = detail?.title ?? filed.claim ?? `Issue #${issueNumber}`;
  const body = (detail?.body ?? "").slice(0, MAX_BODY_CHARS);

  const files = await collectSource(filed.evidence, body);
  const profile = await loadProjectProfile();

  const sections = [
    `THE ISSUE (#${issueNumber}): ${title}`,
    "",
    "ISSUE BODY:",
    body || filed.claim || "(no body available)",
    "",
    `EVIDENCE (identifier from the analytics data): ${filed.evidence}`,
  ];
  if (profile) {
    sections.push("", `PROJECT PROFILE (what this site and its components are):\n${profile.text}`);
  }
  if (files.length > 0) {
    sections.push(
      "",
      "SOURCE FILES (from the GitHub repository):",
      ...files.map((f) => `--- ${f.path} ---\n${f.content}`),
    );
  } else {
    sections.push(
      "",
      "SOURCE FILES: none could be located for this evidence — keep steps to " +
        "the paths the issue body cites, or describe where the change belongs.",
    );
  }

  try {
    const reply = await callModel(settings, FIX_PROMPT, sections.join("\n"), {
      maxTokens: MAX_OUTPUT_TOKENS,
    });
    const parsed = reply.text ? parseSuggestion(reply.text) : null;
    if (!parsed) {
      return {
        ok: false,
        error: "provider-error",
        message: "The model's suggestion could not be parsed. Try again.",
      };
    }
    const suggestion: PolishdFixSuggestion = {
      ...parsed,
      issueNumber,
      files: files.map((f) => f.path),
      provider: settings.provider,
      model: settings.model,
      generatedAt: Date.now(),
    };
    const log = await loadFixLog();
    log[key] = suggestion;
    await setMeta(FIX_LOG_KEY, JSON.stringify(log));
    return { ok: true, suggestion, regenerated: true };
  } catch (err) {
    return {
      ok: false,
      error: "provider-error",
      message: err instanceof Error ? err.message : "The model call failed.",
    };
  }
}
