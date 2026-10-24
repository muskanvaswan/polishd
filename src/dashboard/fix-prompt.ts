/**
 * Polishd — the fix prompt: what the dashboard found, written as one message
 * for a coding agent working in the site's repository.
 *
 * The Overview tab puts the analytics summary and the design review side by
 * side; this turns their findings into instructions the agent can act on —
 * each problem with the evidence it was found from, the file it was matched
 * to, the fix the model suggested — framed so the agent checks a finding
 * against the code before changing anything. The evidence is real data from
 * the running site, but the reading of it is a model's, and the agent is the
 * first party in the loop that can see the source.
 *
 * Pure, with type-only imports, for two reasons: the Overview builds the
 * prompt in the browser from whatever its cards currently show — a
 * regenerated review, an ignored loss or a freshly filed bug is in the very
 * next copy, with no round trip — and the wording is pinned by tests.
 */
import type { PolishdDesignReview, PolishdSummary } from "../ai/types";

/** Which findings a prompt covers. */
export type FixPromptScope = "all" | "analytics" | "design";

/** The audience numbers a prompt opens with — context, not tasks. */
export interface FixPromptTraffic {
  sessions: number;
  pageViews: number;
  rageClicks: number;
  deadClicks: number;
  jsErrors: number;
  /** Share of sessions per device category ("mobile", "desktop"…), 0–100. */
  devices: { category: string; pct: number }[];
}

export interface FixPromptInput {
  /** The owner's description of the site, from Settings. */
  context?: string;
  /** Who the site is for, from Settings. */
  audience?: string;
  /** Null when there's no store to count from. */
  traffic: FixPromptTraffic | null;
  /** Losses the owner ignored must already be gone from this. */
  summary: PolishdSummary | null;
  review: PolishdDesignReview | null;
}

/** How many problems each half has to hand over. A half with none gets no prompt. */
export function fixableCounts(input: FixPromptInput): { analytics: number; design: number } {
  return {
    analytics: input.summary?.losses?.length ?? 0,
    design: input.review?.issues?.length ?? 0,
  };
}

const n = (v: number) => v.toLocaleString("en-US");

/** A date that reads the same in every locale and timezone. */
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Inline code that survives its own contents. Evidence is copied verbatim from
 * the page — a selector can carry a backtick — so the fence is widened past
 * the longest run inside it, as CommonMark allows.
 */
function code(s: string): string {
  const longest = Math.max(0, ...(s.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longest + 1);
  const pad = longest > 0 || s.startsWith("`") || s.endsWith("`") ? " " : "";
  return `${fence}${pad}${s}${pad}${fence}`;
}

function trackedIn(url?: string, number?: number): string | null {
  if (!url) return null;
  return `  - Tracked in: ${url}${number ? ` (#${number})` : ""}`;
}

function siteSection(input: FixPromptInput): string[] {
  const context = input.context?.trim();
  const audience = input.audience?.trim();
  if (!context && !audience) return [];
  const lines = ["## The site", ""];
  if (context) lines.push(context);
  if (context && audience) lines.push("");
  if (audience) lines.push(`Audience: ${audience}`);
  lines.push("");
  return lines;
}

function trafficSection(traffic: FixPromptTraffic | null, analytics: boolean): string[] {
  if (!traffic || traffic.sessions === 0) return [];
  const perSession =
    traffic.pageViews > 0 ? ` (${(traffic.pageViews / traffic.sessions).toFixed(1)} per session)` : "";
  const lines = [
    "## Traffic so far",
    "",
    `- ${n(traffic.sessions)} ${traffic.sessions === 1 ? "session" : "sessions"} · ${n(traffic.pageViews)} page ${traffic.pageViews === 1 ? "view" : "views"}${perSession}`,
  ];
  const devices = [...traffic.devices].filter((d) => d.pct > 0).sort((a, b) => b.pct - a.pct);
  if (devices.length > 0) {
    lines.push(`- Devices: ${devices.map((d) => `${Math.round(d.pct)}% ${d.category}`).join(" · ")}`);
  }
  // Frustration counts frame the analytics findings; a design-only prompt
  // has no use for them.
  if (analytics) {
    lines.push(
      `- ${n(traffic.rageClicks)} rage clicks · ${n(traffic.deadClicks)} dead clicks · ${n(traffic.jsErrors)} JS errors`,
    );
  }
  lines.push("");
  return lines;
}

function keepList(items: string[] | undefined): string[] {
  if (!items?.length) return [];
  return ["Working — don't regress these:", ...items.map((s) => `- ${s}`), ""];
}

function analyticsSection(summary: PolishdSummary): string[] {
  const losses = summary.losses ?? [];
  const lines = [
    "## Analytics: how visitors use the site",
    "",
    `_Reviewed ${day(summary.generatedAt)} by ${summary.provider}/${summary.model}, from captured clicks, rage and dead clicks, scroll depth and errors._`,
    "",
    summary.text.trim(),
    "",
    ...keepList(summary.wins),
    "### Problems to fix",
    "",
    "Evidence is a selector, component name or page path from the captured analytics. Source is the file Polishd matched it to, where it found one.",
    "",
  ];
  losses.forEach((loss, i) => {
    lines.push(`- **A${i + 1}.** ${loss.issue.trim()}`);
    lines.push(`  - Evidence: ${code(loss.evidence)}`);
    lines.push(
      loss.location
        ? `  - Source: ${code(loss.location)}`
        : "  - Source: not matched to a file — search the codebase for the evidence",
    );
    const tracked = trackedIn(loss.issueUrl, loss.issueNumber);
    if (tracked) lines.push(tracked);
  });
  lines.push("");
  return lines;
}

function designSection(review: PolishdDesignReview): string[] {
  const issues = review.issues ?? [];
  const lines = [
    "## Design: how the rendered design holds together",
    "",
    `_Reviewed ${day(review.generatedAt)} by ${review.provider}/${review.model}, from the typography, colors, radii and spacing measured on the rendered pages._`,
    "",
    review.text.trim(),
    "",
    ...keepList(review.strengths),
    "### Problems to fix",
    "",
    "Evidence is a value measured on the rendered pages: a hex color, a px size or a page path.",
    "",
  ];
  issues.forEach((iss, i) => {
    lines.push(`- **D${i + 1}.** ${iss.issue.trim()}`);
    lines.push(`  - Evidence: ${iss.evidence.trim()}`);
    if (iss.suggestion?.trim()) lines.push(`  - Suggested fix: ${iss.suggestion.trim()}`);
    const tracked = trackedIn(iss.issueUrl, iss.issueNumber);
    if (tracked) lines.push(tracked);
  });
  lines.push("");
  return lines;
}

function howToWork(analytics: boolean, design: boolean): string[] {
  const labels = [analytics && "A1", design && "D1"].filter(Boolean).join(", ");
  const steps = [
    "Take the problems one at a time. Before changing anything, find the code responsible — the evidence was captured from the running site, so it points at markup this codebase really renders.",
    "If the code shows a problem isn't real, or is deliberate, leave it and say why. Don't invent a change to match the report.",
  ];
  if (analytics) {
    steps.push(
      "For analytics problems, fix the cause rather than the symptom: a dead click on something that looks clickable needs either a real action or a less clickable look; a rage click usually means feedback is slow or missing.",
    );
  }
  if (design) {
    steps.push(
      "For design problems, move one-off values onto the scale the site already uses — its theme, CSS variables or shared components — rather than hard-coding another value. Check color and contrast changes in dark mode too, if the site has one.",
    );
  }
  steps.push(
    "Keep each change scoped to its problem; don't refactor unrelated code.",
    `Finish with one line per problem (${labels}, …): what you changed and where, or why you left it.`,
  );
  return ["## How to work through this", "", ...steps.map((s, i) => `${i + 1}. ${s}`)];
}

/**
 * The prompt for `scope`, or null when that scope has nothing to fix. "all"
 * covers whichever halves have problems, so it's null only when neither does.
 */
export function buildFixPrompt(input: FixPromptInput, scope: FixPromptScope): string | null {
  const counts = fixableCounts(input);
  const analytics = scope !== "design" && counts.analytics > 0 && input.summary !== null;
  const design = scope !== "analytics" && counts.design > 0 && input.review !== null;
  if (!analytics && !design) return null;

  const title =
    analytics && design
      ? "# Fix the analytics and design problems Polishd found"
      : analytics
        ? "# Fix the analytics problems Polishd found"
        : "# Fix the design problems Polishd found";
  const what =
    analytics && design
      ? "It has watched how real visitors use this site and measured the design its pages actually render, and a model has reviewed both."
      : analytics
        ? "It has watched how real visitors use this site, and a model has reviewed what they ran into."
        : "It has measured the design this site's pages actually render, and a model has reviewed how well it holds together.";

  const lines = [
    title,
    "",
    `Polishd is the analytics and design-review tool installed in this Next.js app. ${what} The problems it found are below, each with the evidence it came from.`,
    "",
    ...siteSection(input),
    ...trafficSection(input.traffic, analytics),
    ...(analytics ? analyticsSection(input.summary!) : []),
    ...(design ? designSection(input.review!) : []),
    ...howToWork(analytics, design),
  ];
  return `${lines.join("\n").trim()}\n`;
}
