/**
 * Polishd — the Overview's paragraph (server only).
 *
 * The analytics summary tells how visitors use the site; the design review
 * tells how its rendered design holds together. Each is a model's reading of
 * its own data, with its own findings. The Overview wants one story, so this
 * asks the same model — the owner's configured provider, model and key — to
 * fold the two into a single paragraph: the overall picture, the one or two
 * things most worth fixing, what to protect.
 *
 * It is written *from the reviews*, never from the raw data: the reviews have
 * already held their findings to the evidence (summary.ts, design.ts), and
 * dismissed findings are already gone from them, so nothing can reach this
 * paragraph that didn't survive that. The prompt forbids inventing anything
 * the reviews don't say.
 *
 * Cached in the store under its inputs' hash, like the reviews themselves: a
 * regenerate with unchanged reviews returns the cached text without a call,
 * and a change to either review marks it stale.
 */
import { getMeta, setMeta } from "../server/store";
import { loadDesignReview } from "./design";
import { fingerprintDigest } from "./digest";
import { callModel } from "./providers";
import { resolveSettings } from "./settings";
import { loadSummary } from "./summary";
import type {
  GenerateOverviewResult,
  PolishdDesignReview,
  PolishdOverview,
  PolishdSummary,
} from "./types";

const OVERVIEW_KEY = "ai_overview";

const SYSTEM_PROMPT = `You write the one-paragraph summary at the top of a website owner's dashboard. You are given two reviews of the same site that a model already wrote: how real visitors use it (from captured clicks, rage and dead clicks and scroll depth) and how the pages' rendered design holds together (from measured type, color, radii and spacing). Fold them into ONE paragraph — the single thing the owner should know this week.

Rules:
- One paragraph of 3 to 5 sentences, plain prose. No heading, no list, no markdown, no label in front of it.
- Lead with the overall picture, then the one or two things most worth fixing, naming the page or element so they can be found, and end on what to protect.
- Say only what the reviews say. Never invent a number, page, color or cause, and quote any value exactly as written — a hex color, a px size, a path.
- Address the owner as "you". Be concrete and unhedged. Don't mention "the reviews", "the summary", "the review", "the model" or "the data" — just say what is true of the site.`;

/** The last paragraph written, or null. Read-only — never calls a model. */
export async function loadOverview(): Promise<PolishdOverview | null> {
  const raw = await getMeta(OVERVIEW_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PolishdOverview;
  } catch {
    return null;
  }
}

/**
 * The exact user message for a call and its cache fingerprint. The message is
 * the two reviews as they stand — text, what's working, the problems with
 * their citations — so the fingerprint moves whenever either review is
 * regenerated or a finding is dismissed, and the site description with it.
 */
function composeOverview(
  summary: PolishdSummary | null,
  review: PolishdDesignReview | null,
  settings: { context?: string; audience?: string },
): { user: string; fingerprint: string; sources: PolishdOverview["sources"] } {
  const lines: string[] = [];
  const context = settings.context?.trim();
  const audience = settings.audience?.trim();
  if (context) lines.push(`SITE: ${context}`);
  if (audience) lines.push(`AUDIENCE: ${audience}`);
  const sources: PolishdOverview["sources"] = [];
  if (summary) {
    sources.push("summary");
    lines.push("", "HOW VISITORS USE THE SITE:", summary.text.trim());
    if (summary.wins?.length) lines.push("Working:", ...summary.wins.map((w) => `- ${w}`));
    if (summary.losses?.length) {
      lines.push("Problems:", ...summary.losses.map((l) => `- ${l.issue} (${l.evidence})`));
    }
  }
  if (review) {
    sources.push("review");
    lines.push("", "HOW THE DESIGN HOLDS TOGETHER:", review.text.trim());
    if (review.strengths?.length) lines.push("Working:", ...review.strengths.map((s) => `- ${s}`));
    if (review.issues?.length) {
      lines.push("Problems:", ...review.issues.map((i) => `- ${i.issue} (${i.evidence})`));
    }
  }
  const user = lines.join("\n").trim();
  return { user, fingerprint: fingerprintDigest(user), sources };
}

/**
 * Whatever the model wrapped it in — a fence, a heading, a "Summary:" label,
 * paragraph breaks, bullets — one paragraph of prose.
 */
export function oneParagraph(text: string): string {
  let t = text.trim();
  const fence = t.match(/^```[a-z]*\s*([\s\S]*?)\s*```$/i);
  if (fence) t = fence[1].trim();
  t = t.replace(/^#+\s*[^\n]*\n+/, "");
  t = t.replace(/^\*{0,2}(?:summary|overview)\*{0,2}\s*:\*{0,2}\s*/i, "");
  return t
    .split(/\n+/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Write (or reuse) the paragraph.
 *
 * @param force  When false (default), a paragraph whose fingerprint matches
 *               the reviews as they stand is returned as-is — no model call.
 *               When true, always re-asks the model.
 */
export async function generateOverview(opts: { force?: boolean } = {}): Promise<GenerateOverviewResult> {
  const { settings } = await resolveSettings();
  if (!settings.apiKey) {
    return { ok: false, error: "no-key", message: "No API key configured." };
  }

  const [summary, review] = await Promise.all([loadSummary(), loadDesignReview()]);
  if (!summary && !review) {
    return {
      ok: false,
      error: "no-data",
      message: "Nothing to summarize yet — the analytics summary and the design review come first.",
    };
  }

  const { user, fingerprint, sources } = composeOverview(summary, review, settings);
  if (!opts.force) {
    const cached = await loadOverview();
    if (cached && cached.fingerprint === fingerprint) {
      return { ok: true, overview: cached, regenerated: false };
    }
  }

  const system = settings.instructions
    ? `${SYSTEM_PROMPT}\n\nAdditional instructions from the site owner: ${settings.instructions}`
    : SYSTEM_PROMPT;

  let reply;
  try {
    reply = await callModel(settings, system, user);
  } catch (err) {
    return {
      ok: false,
      error: "provider-error",
      message: err instanceof Error ? err.message : "The model request failed.",
    };
  }
  const text = reply.text ? oneParagraph(reply.text) : "";
  if (!text) {
    return { ok: false, error: "provider-error", message: "The model returned an empty response." };
  }

  const overview: PolishdOverview = {
    text,
    sources,
    provider: settings.provider,
    model: settings.model,
    generatedAt: Date.now(),
    fingerprint,
    usage: reply.usage,
  };
  await setMeta(OVERVIEW_KEY, JSON.stringify(overview));
  return { ok: true, overview, regenerated: true };
}

/**
 * For the Overview's first render: the cached paragraph plus whether either
 * review has changed since it was written. Only reads the store; never calls
 * a model. The reviews are passed in because the caller has already loaded
 * them (with dismissals applied) for the page.
 */
export async function loadOverviewState(
  summary: PolishdSummary | null,
  review: PolishdDesignReview | null,
): Promise<{ overview: PolishdOverview | null; stale: boolean }> {
  const overview = await loadOverview();
  if (!overview || (!summary && !review)) return { overview, stale: false };
  const { settings } = await resolveSettings();
  const { fingerprint } = composeOverview(summary, review, settings);
  return { overview, stale: overview.fingerprint !== fingerprint };
}
