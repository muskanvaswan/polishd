/**
 * Polishd — AI design review orchestration (server only).
 *
 * The Design tab's second layer. The first layer is deterministic
 * (server/design.ts): measured typography, palette, radii, spacing, and
 * rule-based flags. This module renders those metrics as a compact digest and
 * asks the owner's configured model — the same provider, model, and key the
 * analytics summary uses — for an aesthetic read: how coherent the design is,
 * what works, and what specifically breaks the system.
 *
 * Token thrift mirrors summary.ts: the model sees aggregated tokens (a few
 * hundred tokens for the whole site), never raw scans; the digest is
 * fingerprinted and the review cached, so reopening the tab is free and a
 * regenerate with unchanged metrics returns the cached text without a call.
 */
import { getMeta, setMeta } from "../server/store";
import { getDesignData, type PolishdDesignData } from "../server/design";
import { fingerprintDigest } from "./digest";
import { callModel } from "./providers";
import { resolveSettings } from "./settings";
import type {
  GenerateDesignReviewResult,
  PolishdDesignIssue,
  PolishdDesignReview,
} from "./types";

const DESIGN_REVIEW_KEY = "ai_design_review";

/** The last generated review, or null. Read-only — never calls a model. */
export async function loadDesignReview(): Promise<PolishdDesignReview | null> {
  const raw = await getMeta(DESIGN_REVIEW_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PolishdDesignReview;
  } catch {
    return null;
  }
}

const SYSTEM_PROMPT =
  "You are a senior brand and product designer reviewing a shipped website. " +
  "You receive design tokens reverse-engineered from the rendered pages — the " +
  "typography, color palette, corner radii and spacing actually in use, plus " +
  "deterministic findings from rule-based checks. You never see screenshots; " +
  "judge coherence from the system the numbers describe.\n\n" +
  "Respond with ONLY a JSON object (no markdown fences, no preamble):\n" +
  '{ "assessment": string, "strengths": string[], "issues": [{ "issue": string, "evidence": string, "suggestion": string }] }\n\n' +
  "assessment: one tight paragraph (3-5 sentences) on how coherent and " +
  "tasteful the design system reads — does it feel like one deliberate brand, " +
  "or an accumulation of one-off decisions? Name the strongest and weakest " +
  "aspects. If the data covers too few pages to be confident, say so.\n" +
  "strengths: 2-4 things the design gets right (a disciplined palette, a " +
  "clear type hierarchy, consistent radii…).\n" +
  "issues: 0-5 specific aesthetic problems, worst first. Each issue must be " +
  "concrete, evidence must be an exact token copied verbatim from the metrics " +
  "(a hex color, a px value, a page path), and suggestion must be an " +
  "actionable fix (e.g. 'collapse 15px and 17px into the 16px body size'). " +
  "Never invent an issue: if the system is genuinely coherent, return fewer.";

/**
 * Render the aggregated design data as a terse, model-readable brief.
 * Sections are omitted when empty so the prompt only carries real signal.
 */
export function buildDesignDigest(data: PolishdDesignData, context?: string): string {
  const lines: string[] = [];
  if (context && context.trim()) lines.push(`SITE: ${context.trim()}`);

  lines.push(
    `SCANNED: ${data.pages.length} pages (${data.pages
      .slice(0, 10)
      .map((p) => p.path)
      .join(", ")}${data.pages.length > 10 ? ", …" : ""}).`,
  );

  if (data.families.length) {
    lines.push("FONT FAMILIES: " + data.families.map((f) => `${f.family} (${f.count} uses)`).join(", "));
  }

  if (data.fonts.length) {
    lines.push("TYPE STYLES (family size/weight — uses, tags):");
    for (const f of data.fonts.slice(0, 20)) {
      lines.push(
        `  - ${f.family} ${f.sizePx}px/${f.weight}: ${f.count} uses, ${f.pages.length} pages` +
          `${f.tags.length ? ` (${f.tags.join(",")})` : ""}${f.outlier ? " [one-off]" : ""}`,
      );
    }
  }

  if (data.colors.length) {
    lines.push("PALETTE (share of all color usage):");
    for (const c of data.colors.slice(0, 20)) {
      const roles = Object.entries(c.roles)
        .filter(([, n]) => n > 0)
        .map(([r]) => r)
        .join("/");
      lines.push(`  - ${c.hex}: ${c.pct}% (${roles})${c.outlier ? " [one-off]" : ""}`);
    }
  }

  const failing = data.contrast.filter((p) => !p.passes);
  if (failing.length) {
    lines.push("CONTRAST FAILURES (WCAG AA):");
    for (const p of failing.slice(0, 6)) {
      lines.push(`  - ${p.fg} on ${p.bg}: ${p.ratio}:1 at ${p.minSizePx}px (needs ${p.required}:1)`);
    }
  }

  if (data.radii.length) {
    lines.push(
      "CORNER RADII: " + data.radii.map((r) => `${r.value} ×${r.count}${r.outlier ? " [one-off]" : ""}`).join(", "),
    );
  }

  if (data.spacing.length) {
    lines.push(
      "PADDING VALUES (px ×uses): " +
        data.spacing
          .slice(0, 18)
          .map((s) => `${s.px} ×${s.count}${s.offGrid ? "*" : ""}`)
          .join(", ") +
        "  (* = off the 4px grid)",
    );
  }

  if (data.flags.length) {
    lines.push("RULE-BASED FINDINGS:");
    for (const f of data.flags) lines.push(`  - [${f.section}] ${f.message}`);
  }

  return lines.join("\n");
}

interface RawIssue {
  issue?: unknown;
  evidence?: unknown;
  suggestion?: unknown;
}

/** Parse the model's JSON, tolerating fences/prose; fall back to plain text. */
function parseStructured(text: string): {
  assessment: string;
  strengths: string[];
  issues: RawIssue[];
} {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const obj = JSON.parse(t.slice(start, end + 1)) as Record<string, unknown>;
      const assessment = typeof obj.assessment === "string" ? obj.assessment.trim() : "";
      if (assessment) {
        const strengths = Array.isArray(obj.strengths)
          ? obj.strengths.filter((s): s is string => typeof s === "string" && s.trim().length > 0).slice(0, 4)
          : [];
        const issues = Array.isArray(obj.issues) ? (obj.issues as RawIssue[]).slice(0, 8) : [];
        return { assessment, strengths, issues };
      }
    } catch {
      /* fall through */
    }
  }
  return { assessment: text.trim(), strengths: [], issues: [] };
}

/**
 * Hold issues to their evidence bar: the citation must literally appear in
 * the digest we sent, so the model can't critique a color that isn't there.
 */
function verifyIssues(raw: RawIssue[], digest: string): PolishdDesignIssue[] {
  const hay = digest.toLowerCase();
  const out: PolishdDesignIssue[] = [];
  for (const r of raw) {
    if (typeof r.issue !== "string" || !r.issue.trim()) continue;
    const evidence = typeof r.evidence === "string" ? r.evidence.trim() : "";
    if (!evidence) continue;
    const tokens = evidence
      .toLowerCase()
      .split(/[^\w#/.-]+/)
      .filter((t) => t.length >= 3);
    if (!tokens.length || !tokens.some((t) => hay.includes(t))) continue;
    out.push({
      issue: r.issue.trim(),
      evidence,
      suggestion:
        typeof r.suggestion === "string" && r.suggestion.trim() ? r.suggestion.trim() : undefined,
    });
    if (out.length >= 5) break;
  }
  return out;
}

/**
 * Generate (or reuse) the design review.
 *
 * @param force  When false (default), a review whose fingerprint matches the
 *               current metrics is returned as-is — no model call. When true,
 *               always re-asks the model.
 */
export async function generateDesignReview(
  opts: { force?: boolean } = {},
): Promise<GenerateDesignReviewResult> {
  const { settings } = await resolveSettings();
  if (!settings.apiKey) {
    return { ok: false, error: "no-key", message: "No API key configured." };
  }

  const data = await getDesignData();
  if (!data.ready || data.pages.length === 0) {
    return {
      ok: false,
      error: "no-data",
      message: "No pages scanned yet — browse the site, then refresh.",
    };
  }

  const digest = buildDesignDigest(data, settings.context);
  const fingerprint = fingerprintDigest(digest);

  if (!opts.force) {
    const cached = await loadDesignReview();
    if (cached && cached.fingerprint === fingerprint) {
      return { ok: true, review: cached, regenerated: false };
    }
  }

  const system = settings.instructions
    ? `${SYSTEM_PROMPT}\n\nAdditional instructions from the site owner: ${settings.instructions}`
    : SYSTEM_PROMPT;

  let reply;
  try {
    reply = await callModel(settings, system, digest);
  } catch (err) {
    return {
      ok: false,
      error: "provider-error",
      message: err instanceof Error ? err.message : "The model request failed.",
    };
  }
  if (!reply.text) {
    return { ok: false, error: "provider-error", message: "The model returned an empty response." };
  }
  if (reply.truncated) {
    return {
      ok: false,
      error: "provider-error",
      message:
        "The model's response was cut off at the output limit, twice. Try a model that reasons less, or regenerate.",
    };
  }

  const parsed = parseStructured(reply.text);
  const review: PolishdDesignReview = {
    text: parsed.assessment,
    strengths: parsed.strengths,
    issues: verifyIssues(parsed.issues, digest),
    provider: settings.provider,
    model: settings.model,
    generatedAt: Date.now(),
    fingerprint,
    usage: reply.usage,
  };
  await setMeta(DESIGN_REVIEW_KEY, JSON.stringify(review));
  return { ok: true, review, regenerated: true };
}

/**
 * For the Design tab's first render: the cached review plus whether the live
 * metrics have drifted from it. Only reads the store; never calls a model.
 */
export async function loadDesignReviewState(preloaded?: PolishdDesignData): Promise<{
  review: PolishdDesignReview | null;
  stale: boolean;
}> {
  const [review, data] = await Promise.all([
    loadDesignReview(),
    preloaded ? Promise.resolve(preloaded) : getDesignData(),
  ]);
  if (!data.ready || data.pages.length === 0) return { review, stale: false };
  const { settings } = await resolveSettings();
  const fingerprint = fingerprintDigest(buildDesignDigest(data, settings.context));
  return { review, stale: review !== null && review.fingerprint !== fingerprint };
}
