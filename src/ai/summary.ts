/**
 * Polishd — AI summary orchestration (server only).
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
 *   3. We fingerprint the inputs (digest + profile + dismissals) and cache the
 *      summary. A regenerate with no new data returns the cached text for free
 *      (`regenerated: false`).
 *   4. The system prompt is tight and the output is capped to a paragraph.
 */
import { getMeta, setMeta } from "../server/store";
import { loadPolishdDashboardData, type PolishdDashboardData } from "../server/queries";
import { buildDigest, fingerprintDigest } from "./digest";
import {
  ignoreKey,
  ignoredFingerprint,
  ignoredKeys,
  ignoredSection,
  loadIgnoredLosses,
  withoutIgnored,
} from "./ignored";
import { attachGithubIssues } from "./issues";
import { callModel } from "./providers";
import { coverageGaps, loadProjectProfile } from "./profile";
import { collectTargeted, diskSnapshot, githubSnapshot, type SourceSnapshot } from "./scan";
import { lossSignal } from "./signal";
import { knownNames, matchSource, sourceNeedles, type Needle } from "./source-match";
import { resolveSettings } from "./settings";
import type {
  PolishdIgnoredLoss,
  PolishdLossItem,
  PolishdProjectProfile,
  PolishdSummary,
  GenerateSummaryResult,
} from "./types";

// Settings live in ./settings; re-exported here so existing imports keep working.
export {
  getAISettingsPublic,
  saveAISettings,
  type SaveAISettingsInput,
} from "./settings";

const SUMMARY_KEY = "ai_summary";

/**
 * The last generated summary, or null. Read-only — never calls a model.
 *
 * Losses the owner has dismissed since it was generated are filtered out here,
 * so an ignore takes effect on the cached summary immediately rather than at
 * the next regenerate. The stored copy keeps them, which is what makes an undo
 * bring the loss back.
 */
export async function loadSummary(): Promise<PolishdSummary | null> {
  const raw = await getMeta(SUMMARY_KEY);
  if (!raw) return null;
  let summary: PolishdSummary;
  try {
    summary = JSON.parse(raw) as PolishdSummary;
  } catch {
    return null;
  }
  return withoutIgnored(summary, ignoredKeys(await loadIgnoredLosses()));
}

const SYSTEM_PROMPT =
  "You are a product analyst embedded in a website's analytics dashboard. " +
  "You receive a compact digest of real user-behavior signals (clicks, rage " +
  "clicks, dead clicks, scroll depth, errors, per-page and per-element stats), " +
  "usually preceded by a project profile describing the site's purpose, pages, " +
  "and components — treat the profile as authoritative context for what every " +
  "identifier means.\n\n" +
  "How each signal is detected, and what it cannot see — read every number " +
  "through this:\n" +
  "- Dead click: a click on an element that carries no interactive marker in " +
  "the DOM (no link, button or form-control tag, interactive ARIA role, or " +
  "onclick attribute on it or a few ancestors up), excluding clicks on text " +
  "being read or selected. It is a structural guess, not an observed failure. " +
  "Handlers a framework attaches (React's onClick and the like) leave no such " +
  "marker, so a drawer or modal backdrop that closes on click, an overlay, or " +
  "a clickable card all count as dead even when the click worked. A dead click " +
  "on a wrapper, bar or row next to a small control is a near miss — the user " +
  "aimed for the control and hit beside it — which points at a small hit " +
  "target, not a broken control. Where the digest says dead clicks landed " +
  "next to a control, they were near misses on that control.\n" +
  "- Rage click: three or more fast clicks on the same element, excluding " +
  "select-to-copy bursts on text. Usually frustration, but steppers, " +
  "carousels, \"load more\" and counters are clicked repeatedly on purpose.\n" +
  "- Element labels are the clicked element's visible text — for a wrapper " +
  "that includes its children's text, so a label naming a button on a dead " +
  "click usually means the click landed on the wrapper around or beside the " +
  "button. <tag.class> shows what was actually clicked.\n" +
  "- Scroll depth is only measured where there is meaningful room to scroll; " +
  "a page or component with no scroll figure fit on one screen — treat that " +
  "as no signal, never as disengagement, and don't celebrate 100% scroll on " +
  "its own without deep scroll distance behind it.\n" +
  "- Errors are uncaught throws and unhandled rejections. Where the digest " +
  "names what happened just before one, or its top stack frame, that is a " +
  "correlation to follow up, not proof of cause.\n" +
  "- Sessions behind a count matter: twenty dead clicks from one session is " +
  "one person, not a pattern.\n\n" +
  "Respond with ONLY a JSON object (no markdown fences, no preamble):\n" +
  '{ "story": string, "wins": string[], "losses": [{ "issue": string, "evidence": string }] }\n\n' +
  "story: a single tight paragraph (3-5 sentences) telling the site owner how " +
  "people are actually using their site — what's working best and what's " +
  "frustrating or broken. Name specific pages and elements, in the site's own " +
  "terms from the profile. Lead with the strongest finding. If the data is too " +
  "sparse to be confident, say so plainly.\n" +
  "wins: 2-4 things that are working. These may be general observations.\n" +
  "losses: 0-4 problems the data points to — a frustrating element, an " +
  "underperforming page, a recurring error. Write each issue as a hypothesis " +
  "tied to the numbers: what was observed (counts, sessions, pages), what it " +
  "most likely means, and the likeliest alternative — e.g. \"14 dead clicks in " +
  "6 sessions on the bar around the Export button — likely near misses on a " +
  "small target\", not \"the Export button doesn't respond\". When a pattern " +
  "looks like an overlay or backdrop click, or a near miss, say so in the " +
  "issue; if the clicks most likely did what the user wanted (a backdrop that " +
  "closes its drawer), it is not a loss. evidence must be exactly one " +
  "identifier copied verbatim from the digest — a page path, an element's " +
  "label or selector, a component name, or an error message — not a sentence. " +
  "Never invent a loss: if the data shows no real problems, return an empty " +
  "array. If the prompt lists problems the site owner has already reviewed " +
  "and dismissed, do not report them again — not under a different citation " +
  "or a different wording — and take any reason they gave as true when " +
  "reading the rest of the data.";

/** The model's raw loss shape, before server-side verification. */
interface RawLoss {
  issue?: unknown;
  evidence?: unknown;
}

/**
 * Parse the model's JSON reply, tolerating stray fences or prose around it.
 * Falls back to treating the whole text as the story so a model that ignores
 * the format still produces a usable card.
 */
function parseStructured(text: string): { story: string; wins: string[]; losses: RawLoss[] } {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const obj = JSON.parse(t.slice(start, end + 1)) as Record<string, unknown>;
      const story = typeof obj.story === "string" ? obj.story.trim() : "";
      if (story) {
        const wins = Array.isArray(obj.wins)
          ? obj.wins.filter((w): w is string => typeof w === "string" && w.trim().length > 0).slice(0, 4)
          : [];
        const losses = Array.isArray(obj.losses) ? (obj.losses as RawLoss[]).slice(0, 6) : [];
        return { story, wins, losses };
      }
    } catch {
      /* fall through to plain-text handling */
    }
  }
  return { story: text.trim(), wins: [], losses: [] };
}

/**
 * Tokens of a citation, for checking it appears in the prompt we sent. Loose
 * on purpose — `div.fixed` is a fine thing to cite — because all it decides
 * is whether the model made the citation up. Matching it to a source file is
 * a stricter job (source-match.ts).
 */
function groundingTokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^\w/-]+/)
    .filter((t) => t.length >= 4 && !/^(button|input|click|clicks|page|pages|http|https|with|from|that)$/.test(t));
}

/** The longest a loss list gets. */
const MAX_LOSSES = 4;

/**
 * Where a summary's losses get matched to files: the disk when the source is
 * there, otherwise the connected GitHub repo (as the profile scan does) —
 * listing only, when every citation is a page path. Null when neither is
 * available or nothing cited is searchable.
 */
async function matchSnapshot(
  needles: Needle[][],
  sourceDirs: string | undefined,
  profile: PolishdProjectProfile | null,
): Promise<SourceSnapshot | null> {
  const all = needles.flat();
  if (!all.length) return null;
  const disk = diskSnapshot(sourceDirs);
  if (disk) return disk;
  return githubSnapshot(sourceDirs, {
    hints: all.filter((n) => n.kind === "component" || n.kind === "identifier").map((n) => n.value),
    knownRoot: profile?.github?.root,
    readContent: all.some((n) => n.kind !== "route"),
  });
}

/**
 * Hold losses to their evidence bar. A loss survives only if its citation
 * actually appears in the prompt we sent (so it can't be invented). Anything
 * the owner has dismissed is dropped here, before the cap — so a dismissal
 * frees its slot for the next real problem instead of leaving a gap.
 *
 * Survivors are then annotated, never dropped: matched to a source file
 * (`verified` only on a single, specific match; several equal matches come
 * back as `candidates`), and given the `signal` the aggregates hold for their
 * evidence.
 */
async function verifyLosses(
  raw: RawLoss[],
  promptText: string,
  data: PolishdDashboardData,
  profile: PolishdProjectProfile | null,
  sourceDirs: string | undefined,
  ignored: Set<string>,
): Promise<PolishdLossItem[]> {
  const hay = promptText.toLowerCase();
  const kept: { issue: string; evidence: string }[] = [];
  for (const l of raw) {
    if (typeof l.issue !== "string" || !l.issue.trim()) continue;
    const evidence = typeof l.evidence === "string" ? l.evidence.trim() : "";
    if (!evidence) continue; // no citation, no loss
    if (ignored.has(ignoreKey(evidence))) continue; // reviewed and dismissed
    const tokens = groundingTokens(evidence);
    if (!tokens.length || !tokens.some((t) => hay.includes(t))) continue; // not in the data we sent
    kept.push({ issue: l.issue.trim(), evidence });
    if (kept.length >= MAX_LOSSES) break;
  }
  if (!kept.length) return [];

  const known = knownNames(data, profile);
  const needles = kept.map((l) => sourceNeedles(l.evidence, known));
  const snapshot = await matchSnapshot(needles, sourceDirs, profile);
  return kept.map((l, i): PolishdLossItem => {
    let match = snapshot ? matchSource(needles[i], snapshot.files, snapshot.read) : {};
    if (snapshot?.partial && match.location && match.needle?.kind === "label") {
      // Text is the needle most likely repeated elsewhere, and part of the
      // repo went unread: one hit among what was read isn't the only one.
      match = { candidates: [match.location], needle: match.needle };
    }
    const signal = lossSignal(l.evidence, l.issue, data);
    return {
      ...l,
      ...(match.location ? { location: match.location } : {}),
      verified: !!match.location,
      ...(match.candidates ? { candidates: match.candidates } : {}),
      ...(signal ? { signal } : {}),
    };
  });
}

/**
 * The one place the cache fingerprint is defined. It covers the digest, the
 * profile AND the dismissals, so a re-scan or a newly ignored loss marks the
 * cached summary stale exactly like new analytics does.
 */
function fingerprintInputs(
  digest: string,
  profile: PolishdProjectProfile | null,
  ignored: PolishdIgnoredLoss[],
): string {
  const ignoredHash = ignoredFingerprint(ignored);
  return fingerprintDigest(
    [
      digest,
      profile ? `PROFILE:${profile.fingerprint}` : "",
      ignoredHash ? `IGNORED:${ignoredHash}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

/**
 * The exact user message for a summary call, plus its cache fingerprint and
 * the slice of it a citation is allowed to be grounded in.
 *
 * `grounding` is the message minus the dismissals: past problems are quoted
 * back to the model as context, and quoting them must not turn their citations
 * into fresh evidence a new loss can lean on (see verifyLosses).
 */
function composePrompt(
  data: PolishdDashboardData,
  profile: PolishdProjectProfile | null,
  context: string | undefined,
  sourceDirs: string | undefined,
  ignored: PolishdIgnoredLoss[],
): { user: string; grounding: string; fingerprint: string } {
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

  const dismissed = ignoredSection(ignored);
  const grounding = [...sections, digest].join("\n\n");
  return {
    user: dismissed ? [...sections, dismissed, digest].join("\n\n") : grounding,
    grounding,
    fingerprint: fingerprintInputs(digest, profile, ignored),
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

  const data = await loadPolishdDashboardData();
  if (!data.overview.ready || data.overview.totalEvents === 0) {
    return {
      ok: false,
      error: "no-data",
      message: "No analytics captured yet — browse the site, then generate.",
    };
  }

  const [profile, ignored] = await Promise.all([loadProjectProfile(), loadIgnoredLosses()]);
  const { user, grounding, fingerprint } = composePrompt(
    data,
    profile,
    settings.context,
    settings.sourceDirs,
    ignored,
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

  const parsed = parseStructured(reply.text);
  // Link losses to their GitHub issues — filing new ones when the owner
  // enabled auto-filing, attaching already-filed ones either way.
  const losses = await attachGithubIssues(
    await verifyLosses(
      parsed.losses,
      grounding,
      data,
      profile,
      settings.sourceDirs,
      ignoredKeys(ignored),
    ),
  );
  const summary: PolishdSummary = {
    text: parsed.story,
    wins: parsed.wins,
    losses,
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
  preloaded?: PolishdDashboardData,
): Promise<{
  summary: PolishdSummary | null;
  stale: boolean;
  currentFingerprint: string | null;
}> {
  const [summary, data] = await Promise.all([
    loadSummary(),
    preloaded ? Promise.resolve(preloaded) : loadPolishdDashboardData(),
  ]);
  if (!data.overview.ready || data.overview.totalEvents === 0) {
    return { summary, stale: false, currentFingerprint: null };
  }
  const [{ settings }, profile, ignored] = await Promise.all([
    resolveSettings(),
    loadProjectProfile(),
    loadIgnoredLosses(),
  ]);
  // Staleness only needs the fingerprint — skip the targeted source read by
  // computing it from the same inputs composePrompt does, without collecting
  // excerpts.
  const currentFingerprint = fingerprintInputs(
    buildDigest(data, settings.context),
    profile,
    ignored,
  );
  return {
    summary,
    stale: summary !== null && summary.fingerprint !== currentFingerprint,
    currentFingerprint,
  };
}
