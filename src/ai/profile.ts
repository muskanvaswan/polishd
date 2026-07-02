/**
 * Buffd — project profile (server only).
 *
 * The one-time setup step: scan the host app's source, ask the model to write
 * a compact "what this project is" brief — purpose, page map, every interactive
 * component and its identifier, plus the owner's stated audience and ideology —
 * and cache it in the store.
 *
 * From then on, every summary reuses this profile as authoritative context.
 * The codebase is only read again when (a) the owner explicitly re-scans, or
 * (b) analytics mention a component the profile doesn't cover, in which case
 * the summary does a tiny targeted read of just the files naming it.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import type { BuffdDashboardData } from "../server/queries";
import { getMeta, setMeta } from "../server/store";
import { callModel } from "./providers";
import { collectSource, type SourceScan } from "./scan";
import { resolveSettings } from "./settings";
import type { BuffdProjectProfile, GenerateProfileResult } from "./types";

const PROFILE_KEY = "project_profile";

/** The cached profile, or null. Read-only — never calls a model. */
export async function loadProjectProfile(): Promise<BuffdProjectProfile | null> {
  const raw = await getMeta(PROFILE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as BuffdProjectProfile;
  } catch {
    return null;
  }
}

/** Component identifiers the analytics currently know about. */
export function componentIdentifiers(data: BuffdDashboardData): string[] {
  const ids = new Set<string>();
  for (const m of data.monitored) ids.add(m.name);
  for (const t of data.topUsed) if (t.isComponent) ids.add(t.label);
  return [...ids].sort();
}

/**
 * Identifiers the analytics talk about that the profile does NOT cover — the
 * trigger for a targeted source read at summary time (and a "re-scan" hint in
 * the UI). An identifier counts as covered if the scan saw it in source or the
 * profile prose mentions it.
 */
export function coverageGaps(
  data: BuffdDashboardData,
  profile: BuffdProjectProfile | null,
): string[] {
  if (!profile) return [];
  const covered = new Set(profile.coveredIdentifiers);
  const prose = profile.text.toLowerCase();
  return componentIdentifiers(data).filter(
    (id) => !covered.has(id) && !prose.includes(id.toLowerCase()),
  );
}

const PROFILE_SYSTEM_PROMPT =
  "You are onboarding as the resident product analyst for a website. You are " +
  "given excerpts of its source code and, when available, the owner's notes on " +
  "audience and product values. Write a compact project profile that will be " +
  "your ONLY code context in future analyses, so make it self-sufficient: " +
  "(1) what the site is and its purpose; (2) a map of its pages/routes and what " +
  "each is for; (3) every interactive component and tracked element — name each " +
  "identifier exactly as it appears (BuffdMonitor names, data-component values, " +
  "notable buttons/links) and say what it does and where it lives; (4) who the " +
  "site is for and what success looks like, if stated. Plain prose with short " +
  "paragraphs; no markdown headings, no code blocks. Be dense — under 450 words.";

// ~450 words of profile plus headroom for reasoning models' thinking tokens,
// which count against the output cap.
const PROFILE_MAX_TOKENS = 3000;

/**
 * Scan the codebase and (re)generate the project profile. Always calls the
 * model — this is an explicit owner action, not something that runs on load.
 */
export async function generateProjectProfile(
  data?: BuffdDashboardData,
): Promise<GenerateProfileResult> {
  const { settings } = await resolveSettings();
  if (!settings.apiKey) {
    return { ok: false, error: "no-key", message: "No API key configured." };
  }

  const knownIds = data ? componentIdentifiers(data) : [];
  const scan: SourceScan = collectSource(settings.sourceDirs, knownIds);
  if (!scan.available) {
    return {
      ok: false,
      error: "no-source",
      message:
        "No source tree found on disk — run the scan where the app's source is available (local dev or CI).",
    };
  }

  const parts: string[] = [];
  if (settings.context) parts.push(`OWNER'S DESCRIPTION: ${settings.context}`);
  if (settings.audience) parts.push(`TARGET AUDIENCE: ${settings.audience}`);
  if (settings.ideology) parts.push(`PRODUCT VALUES / IDEOLOGY: ${settings.ideology}`);
  if (knownIds.length)
    parts.push(`COMPONENT IDENTIFIERS SEEN IN ANALYTICS: ${knownIds.join(", ")}`);
  parts.push(
    "SOURCE FILES" + (scan.truncated ? " (large app — excerpts were clipped to budget)" : "") + ":",
  );
  for (const f of scan.files) {
    parts.push(`--- ${f.path} ---\n${f.content}`);
  }

  let reply;
  try {
    reply = await callModel(settings, PROFILE_SYSTEM_PROMPT, parts.join("\n\n"), {
      maxTokens: PROFILE_MAX_TOKENS,
    });
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
    // Even the retry hit the cap — a partial profile would silently degrade
    // every future summary, so refuse to store it.
    return {
      ok: false,
      error: "provider-error",
      message:
        "The model's response was cut off at the output limit, twice. Try again or use a model that reasons less.",
    };
  }

  const profile: BuffdProjectProfile = {
    text: reply.text,
    provider: settings.provider,
    model: settings.model,
    generatedAt: Date.now(),
    fingerprint: scan.fingerprint,
    // Covered = names the scan found in source + names analytics knew at scan
    // time (dynamic names — e.g. per-article slugs — never appear literally in
    // source, so the analytics side is what keeps them from gapping forever).
    coveredIdentifiers: [...new Set([...scan.identifiers, ...knownIds])].sort(),
    sourceFiles: scan.files.length,
    truncated: scan.truncated,
  };
  await setMeta(PROFILE_KEY, JSON.stringify(profile));
  return { ok: true, profile };
}

/** What the dashboard needs on first paint. Reads only — no model, no scan. */
export async function loadProfileState(data: BuffdDashboardData): Promise<{
  profile: BuffdProjectProfile | null;
  gaps: string[];
  /** Whether a scan could run here (source tree present on disk). */
  sourceAvailable: boolean;
}> {
  const [profile, { settings }] = await Promise.all([
    loadProjectProfile(),
    resolveSettings(),
  ]);
  // Cheap availability probe — enough for the UI to enable/disable the button
  // without walking the whole tree.
  const configured = settings.sourceDirs?.split(",").map((s) => s.trim()).filter(Boolean);
  const roots = configured?.length
    ? configured
    : ["src", "app", "components", "pages", "lib"];
  const sourceAvailable = roots.some((r) => existsSync(join(process.cwd(), r)));
  return { profile, gaps: coverageGaps(data, profile), sourceAvailable };
}
