/**
 * Buffd — AI summary orchestration (server only).
 *
 * Ties the pieces together: resolve the owner's model settings, build a compact
 * digest of the analytics, fold in the cached project profile, and — only when
 * needed — ask the model for a one-paragraph story of how the site is used.
 *
 * Token thrift, in order of impact:
 *   1. We send a pre-aggregated digest, never raw events.
 *   2. Code understanding comes from the cached project profile (see
 *      profile.ts), generated once — the summary call never re-reads source.
 *      Only when analytics mention a component the profile doesn't cover do we
 *      do a tiny targeted read of the files naming it.
 *   3. We fingerprint the inputs (digest + profile) and cache the summary. A
 *      regenerate with no new data returns the cached text for free
 *      (`regenerated: false`).
 *   4. The system prompt is tight and the output is capped to a paragraph.
 */
import { getMeta, setMeta } from "../server/store";
import { loadBuffdDashboardData, type BuffdDashboardData } from "../server/queries";
import { buildDigest, fingerprintDigest } from "./digest";
import { callModel } from "./providers";
import { coverageGaps, loadProjectProfile } from "./profile";
import { collectTargeted } from "./scan";
import { resolveSettings } from "./settings";
import type { BuffdProjectProfile, BuffdSummary, GenerateSummaryResult } from "./types";

// Settings live in ./settings; re-exported here so existing imports keep working.
export {
  getAISettingsPublic,
  saveAISettings,
  type SaveAISettingsInput,
} from "./settings";

const SUMMARY_KEY = "ai_summary";

/** The last generated summary, or null. Read-only — never calls a model. */
export async function loadSummary(): Promise<BuffdSummary | null> {
  const raw = await getMeta(SUMMARY_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as BuffdSummary;
  } catch {
    return null;
  }
}

const SYSTEM_PROMPT =
  "You are a product analyst embedded in a website's analytics dashboard. " +
  "You receive a compact digest of real user-behavior signals (clicks, rage " +
  "clicks, dead clicks, scroll depth, errors, per-page and per-element stats), " +
  "usually preceded by a project profile describing the site's purpose, pages, " +
  "and components — treat the profile as authoritative context for what every " +
  "identifier means. Write a single tight paragraph (3-5 sentences) telling " +
  "the site owner the story of how people are actually using their site: " +
  "what's working best and what's frustrating or broken. Be concrete — name " +
  "the specific pages and elements from the data, in the site's own terms from " +
  "the profile. Lead with the strongest finding. No headings, no bullet lists, " +
  "no preamble like 'Based on the data'. If the data is too sparse to be " +
  "confident, say so plainly in one sentence.";

/**
 * The exact user message for a summary call, plus its cache fingerprint.
 * Fingerprint covers the digest AND the profile, so a re-scan (new profile)
 * marks the cached summary stale too.
 */
function composePrompt(
  data: BuffdDashboardData,
  profile: BuffdProjectProfile | null,
  context: string | undefined,
  sourceDirs: string | undefined,
): { user: string; fingerprint: string } {
  const digest = buildDigest(data, context);
  const sections: string[] = [];

  if (profile) {
    sections.push(`PROJECT PROFILE (authoritative — what this site and its components are):\n${profile.text}`);
    // The "only touch source again when something isn't covered" path: a tiny
    // targeted read for identifiers the profile doesn't know about.
    const gaps = coverageGaps(data, profile);
    if (gaps.length) {
      const excerpts = collectTargeted(gaps, sourceDirs);
      if (excerpts.length) {
        sections.push(
          "NEW COMPONENTS NOT IN THE PROFILE (source excerpts):\n" +
            excerpts.map((f) => `--- ${f.path} ---\n${f.content}`).join("\n\n"),
        );
      } else {
        sections.push(`COMPONENTS NOT COVERED BY THE PROFILE (no source found): ${gaps.join(", ")}`);
      }
    }
  }

  sections.push(digest);
  const user = sections.join("\n\n");
  return {
    user,
    fingerprint: fingerprintDigest(
      profile ? `${digest}\nPROFILE:${profile.fingerprint}` : digest,
    ),
  };
}

/**
 * Generate (or reuse) the narrative summary.
 *
 * @param force  When false (default), a summary whose fingerprint matches the
 *               current data is returned as-is — no model call, no tokens spent.
 *               When true, always re-asks the model.
 */
export async function generateSummary(
  opts: { force?: boolean } = {},
): Promise<GenerateSummaryResult> {
  const { settings } = await resolveSettings();
  if (!settings.apiKey) {
    return { ok: false, error: "no-key", message: "No API key configured." };
  }

  const data = await loadBuffdDashboardData();
  if (!data.overview.ready || data.overview.totalEvents === 0) {
    return {
      ok: false,
      error: "no-data",
      message: "No analytics captured yet — browse the site, then generate.",
    };
  }

  const profile = await loadProjectProfile();
  const { user, fingerprint } = composePrompt(
    data,
    profile,
    settings.context,
    settings.sourceDirs,
  );

  if (!opts.force) {
    const cached = await loadSummary();
    if (cached && cached.fingerprint === fingerprint) {
      return { ok: true, summary: cached, regenerated: false };
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

  if (!reply.text) {
    return {
      ok: false,
      error: "provider-error",
      message: "The model returned an empty response.",
    };
  }
  if (reply.truncated) {
    // Even the retry hit the cap — don't cache a mid-sentence stump.
    return {
      ok: false,
      error: "provider-error",
      message:
        "The model's response was cut off at the output limit, twice. Try a model that reasons less, or regenerate.",
    };
  }

  const summary: BuffdSummary = {
    text: reply.text,
    provider: settings.provider,
    model: settings.model,
    generatedAt: Date.now(),
    fingerprint,
    usage: reply.usage,
  };
  await setMeta(SUMMARY_KEY, JSON.stringify(summary));
  return { ok: true, summary, regenerated: true };
}

/**
 * For the dashboard's first render: the cached summary plus whether the live
 * data has drifted from it (so the UI can show a "new data — regenerate" hint).
 * Computing this only reads the store; it never calls a model.
 */
export async function loadSummaryState(
  preloaded?: BuffdDashboardData,
): Promise<{
  summary: BuffdSummary | null;
  stale: boolean;
  currentFingerprint: string | null;
}> {
  const [summary, data] = await Promise.all([
    loadSummary(),
    preloaded ? Promise.resolve(preloaded) : loadBuffdDashboardData(),
  ]);
  if (!data.overview.ready || data.overview.totalEvents === 0) {
    return { summary, stale: false, currentFingerprint: null };
  }
  const [{ settings }, profile] = await Promise.all([
    resolveSettings(),
    loadProjectProfile(),
  ]);
  // Staleness only needs the fingerprint — skip the targeted source read by
  // computing it the same way composePrompt does, without collecting excerpts.
  const digest = buildDigest(data, settings.context);
  const currentFingerprint = fingerprintDigest(
    profile ? `${digest}\nPROFILE:${profile.fingerprint}` : digest,
  );
  return {
    summary,
    stale: summary !== null && summary.fingerprint !== currentFingerprint,
    currentFingerprint,
  };
}
