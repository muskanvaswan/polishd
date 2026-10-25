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
import type { FrictionIndex } from "../server/friction";
import {
  getFriction,
  loadPolishdDashboardData,
  type PolishdDashboardData,
} from "../server/queries";
import { settleWithin } from "./deadline";
import {
  buildDigest,
  citedInPrompt,
  citedTarget,
  digestParts,
  fingerprintDigest,
  lossSignal,
  type DigestTarget,
} from "./digest";
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
  "- Dead click: a click on something that isn't recognisably a control (no " +
  "link, button or form-control tag, interactive ARIA role or click handler " +
  "on it or a few ancestors up) and isn't text being read or selected. " +
  "Depending on the capture version it was also checked for a response — " +
  "counted only if nothing on the page changed within about a second — or " +
  "not, in which case it is a structural guess: a drawer or modal backdrop " +
  "that closes on click, an overlay, or a clickable card whose handler the " +
  "DOM doesn't show can all be counted even though the click worked. A dead click " +
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
  "button. <tag.class> shows what was actually clicked; a handle, where " +
  "shown, is a selector path to it. Numbers in labels may appear as #.\n" +
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

/** The longest a loss list gets. */
const MAX_LOSSES = 4;

/**
 * How long matching losses to source files may take, every request included.
 * It runs after the paid model call, so it must never be what a host timeout
 * cuts off: past this, losses are kept unmatched.
 */
const MATCH_BUDGET_MS = 8_000;

/**
 * Hold losses to their evidence bar. A loss survives only if its citation
 * actually appears in the prompt we sent (so it can't be invented) — a
 * token of it, or, for a label too short to have one, an exact copy of a
 * label the digest printed. Anything the owner has dismissed is dropped here,
 * before the cap — so a dismissal frees its slot for the next real problem
 * instead of leaving a gap.
 *
 * Survivors carry the `signal` of the digest line they cite. They're not yet
 * matched to source (`verified: false`); `matchLosses` does that.
 */
function groundLosses(
  raw: RawLoss[],
  promptText: string,
  targets: DigestTarget[],
  ignored: Set<string>,
): PolishdLossItem[] {
  const kept: PolishdLossItem[] = [];
  for (const l of raw) {
    if (typeof l.issue !== "string" || !l.issue.trim()) continue;
    const evidence = typeof l.evidence === "string" ? l.evidence.trim() : "";
    if (!evidence) continue; // no citation, no loss
    if (ignored.has(ignoreKey(evidence))) continue; // reviewed and dismissed
    if (!citedInPrompt(evidence, promptText, targets)) continue; // not in the data we sent
    const issue = l.issue.trim();
    const signal = lossSignal(evidence, issue, targets);
    kept.push({ issue, evidence, verified: false, ...(signal ? { signal } : {}) });
    if (kept.length >= MAX_LOSSES) break;
  }
  return kept;
}

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
  signal: AbortSignal,
): Promise<SourceSnapshot | null> {
  const all = needles.flat();
  if (!all.length) return null;
  const disk = diskSnapshot(sourceDirs);
  if (disk) return disk;
  return githubSnapshot(sourceDirs, {
    hints: all.filter((n) => n.kind === "component" || n.kind === "identifier").map((n) => n.value),
    knownRoot: profile?.github?.root,
    readContent: all.some((n) => n.kind !== "route"),
    signal,
  });
}

/**
 * Match each loss to the file that renders what it cites. Annotates, never
 * drops: `verified` only on a single, specific match; several equal matches
 * (or any content match in a repo that couldn't be read whole) come back as
 * `candidates`. The digest line a loss cites lends its capture handle as an
 * extra needle.
 */
async function matchLosses(
  losses: PolishdLossItem[],
  data: PolishdDashboardData,
  friction: FrictionIndex,
  targets: DigestTarget[],
  profile: PolishdProjectProfile | null,
  sourceDirs: string | undefined,
): Promise<PolishdLossItem[]> {
  if (!losses.length) return losses;
  const known = knownNames(data, profile, friction);
  const needles = losses.map((l) =>
    sourceNeedles(l.evidence, known, { handle: citedTarget(l.evidence, targets)?.handle }),
  );
  const snapshot = await matchSnapshot(
    needles,
    sourceDirs,
    profile,
    AbortSignal.timeout(MATCH_BUDGET_MS),
  );
  if (!snapshot) return losses;
  return losses.map((l, i): PolishdLossItem => {
    const match = matchSource(needles[i], snapshot.files, snapshot.read, {
      partial: snapshot.partial,
      truncated: snapshot.truncated,
    });
    return {
      ...l,
      ...(match.location ? { location: match.location } : {}),
      verified: !!match.location,
      ...(match.candidates ? { candidates: match.candidates } : {}),
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
  friction: FrictionIndex,
  profile: PolishdProjectProfile | null,
  context: string | undefined,
  sourceDirs: string | undefined,
  ignored: PolishdIgnoredLoss[],
): { user: string; grounding: string; fingerprint: string; targets: DigestTarget[] } {
  // The prompt gets the friction context; the fingerprint is taken from the
  // base digest, which a dashboard render can compute without loading it.
  // Every friction event moves a count in the base digest too, so it still
  // notices new data.
  const { lines, targets } = digestParts(data, context, friction);
  const digest = lines.join("\n");
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
    fingerprint: fingerprintInputs(buildDigest(data, context), profile, ignored),
    targets,
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

  // The fingerprint needs only the base digest, so an unchanged summary is
  // returned before the friction index is ever queried.
  if (!opts.force) {
    const cached = await loadSummary();
    const current = fingerprintInputs(buildDigest(data, settings.context), profile, ignored);
    if (cached && cached.fingerprint === current) {
      return { ok: true, summary: cached, regenerated: false };
    }
  }

  const friction = await getFriction();
  const { user, grounding, fingerprint, targets } = composePrompt(
    data,
    friction,
    profile,
    settings.context,
    settings.sourceDirs,
    ignored,
  );

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
  const summary: PolishdSummary = {
    text: parsed.story,
    wins: parsed.wins,
    losses: groundLosses(parsed.losses, grounding, targets, ignoredKeys(ignored)),
    provider: settings.provider,
    model: settings.model,
    generatedAt: Date.now(),
    fingerprint,
    usage: reply.usage,
  };
  // The model's answer is what cost money: keep it before anything slower or
  // fallible runs, so a host timeout during matching can't discard it.
  await setMeta(SUMMARY_KEY, JSON.stringify(summary));

  let losses = summary.losses ?? [];
  try {
    losses = await settleWithin(
      matchLosses(losses, data, friction, targets, profile, settings.sourceDirs),
      MATCH_BUDGET_MS + 2_000,
      losses,
    );
  } catch {
    /* matching is an enrichment: keep the losses unmatched */
  }
  // Link losses to their GitHub issues — filing new ones when the owner
  // enabled auto-filing, attaching already-filed ones either way.
  try {
    losses = await attachGithubIssues(losses);
  } catch {
    /* keep them unlinked; the next summary tries again */
  }
  summary.losses = losses;
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
