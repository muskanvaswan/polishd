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
 * So each finding also carries what the agent needs to judge it: how many
 * events and sessions are behind it (the loss's `signal`, filled server-side),
 * how that kind of finding is detected and what the detector can't see, and
 * handles to search the source for, read off the citation itself. The prompt says when the two reviews are far apart in time
 * or out of date. And it asks the agent to end with a verdict block that the
 * Overview reads back, so a finding the agent showed isn't real, or is
 * deliberate, isn't reported again.
 *
 * Pure, importing only other pure modules, for two reasons: the Overview
 * builds the prompt in the browser from whatever its cards currently show — a
 * regenerated review, an ignored loss or a freshly filed bug is in the very
 * next copy, with no round trip — and the wording is pinned by tests.
 */
import type {
  PolishdDesignIssue,
  PolishdDesignReview,
  PolishdLossItem,
  PolishdSummary,
} from "../ai/types";
import { previewCaption, usageFacts } from "../shared/design-evidence";

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
  /** Issues the owner ignored must already be gone from this. */
  review: PolishdDesignReview | null;
  /**
   * True when something the summary is built from has changed since it was
   * generated: the analytics, a dismissal, the codebase profile or settings.
   * Which of them isn't known, so the prompt says so without claiming new data.
   */
  summaryStale?: boolean;
  /** The same for the design review: its metrics, a dismissal or the site description. */
  reviewStale?: boolean;
  /**
   * Whether the design measurements themselves changed since the review —
   * the one case the prompt calls new data. Null or absent when unknown.
   */
  reviewMetricsChanged?: boolean | null;
  /** When the prompt is built, ms since epoch. Defaults to now. */
  now?: number;
}

/** One finding as the prompt numbers it — what a verdict's `id` refers to. */
export interface FixPromptFinding {
  /** "A1", "D2"… */
  id: string;
  source: "analytics" | "design";
  issue: string;
  evidence: string;
}

// A finding's identity in the dashboard — its citation and its wording — is
// defined with the actionables, which are what it identifies.
export { findingKey } from "./actionable-model";

/** How many problems each half has to hand over. A half with none gets no prompt. */
export function fixableCounts(input: FixPromptInput): { analytics: number; design: number } {
  return {
    analytics: input.summary?.losses?.length ?? 0,
    design: input.review?.issues?.length ?? 0,
  };
}

/** Which halves a scope's prompt carries. */
function halves(input: FixPromptInput, scope: FixPromptScope): { analytics: boolean; design: boolean } {
  const counts = fixableCounts(input);
  return {
    analytics: scope !== "design" && counts.analytics > 0 && input.summary !== null,
    design: scope !== "analytics" && counts.design > 0 && input.review !== null,
  };
}

/**
 * The findings a scope's prompt lists, with the ids it gives them. Numbering
 * is per half, so A1 is the first loss whether or not the design half is in
 * the same prompt.
 */
export function fixPromptFindings(input: FixPromptInput, scope: FixPromptScope): FixPromptFinding[] {
  const { analytics, design } = halves(input, scope);
  const out: FixPromptFinding[] = [];
  if (analytics) {
    input.summary!.losses!.forEach((l, i) =>
      out.push({ id: `A${i + 1}`, source: "analytics", issue: l.issue.trim(), evidence: l.evidence }),
    );
  }
  if (design) {
    input.review!.issues!.forEach((d, i) =>
      out.push({ id: `D${i + 1}`, source: "design", issue: d.issue.trim(), evidence: d.evidence }),
    );
  }
  return out;
}

const n = (v: number) => v.toLocaleString("en-US");
const plural = (v: number, one: string, many = `${one}s`) => `${n(v)} ${v === 1 ? one : many}`;

const DAY_MS = 86_400_000;
/** Reviews this far apart get a warning that the site may have changed between them. */
const GAP_DAYS = 14;
/** A review this old gets a warning of its own. */
const OLD_DAYS = 30;

/** A date that reads the same in every locale and timezone. */
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const daysBetween = (a: number, b: number) => Math.round(Math.abs(a - b) / DAY_MS);

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

// ── How current this is ──────────────────────────────────────────────────────

/**
 * Warnings about the reviews' age: far apart from each other (one may describe
 * a site the other no longer sees), old in themselves, or generated before the
 * data last changed. Empty when there's nothing to warn about.
 *
 * Only a real change in time or data earns the "check it against the code as
 * it is now" line. A review that's merely stale — its inputs include
 * dismissals and settings, which say nothing about the code — gets a neutral
 * note, or none when the data is known not to have moved.
 */
function freshnessSection(input: FixPromptInput, analytics: boolean, design: boolean): string[] {
  const now = input.now ?? Date.now();
  const notes: string[] = [];
  let dataMoved = false;
  const summaryAt = analytics ? input.summary!.generatedAt : null;
  const reviewAt = design ? input.review!.generatedAt : null;

  // The older review of a reported gap gets no separate age note: the gap
  // line already says when it's from.
  let olderOfGap: "analytics" | "design" | null = null;
  if (summaryAt !== null && reviewAt !== null && daysBetween(summaryAt, reviewAt) >= GAP_DAYS) {
    const gap = daysBetween(summaryAt, reviewAt);
    olderOfGap = reviewAt < summaryAt ? "design" : "analytics";
    dataMoved = true;
    notes.push(
      olderOfGap === "design"
        ? `The design review is from ${day(reviewAt)}, ${gap} days before the analytics summary (${day(summaryAt)}). The site may have changed in between, so the two can describe different versions of it.`
        : `The analytics summary is from ${day(summaryAt)}, ${gap} days before the design review (${day(reviewAt)}). The site may have changed in between, so the two can describe different versions of it.`,
    );
  }
  for (const [half, at, name] of [
    ["analytics", summaryAt, "analytics summary"],
    ["design", reviewAt, "design review"],
  ] as const) {
    if (at === null || half === olderOfGap) continue;
    const age = daysBetween(now, at);
    if (age >= OLD_DAYS) {
      dataMoved = true;
      notes.push(`The ${name} is ${age} days old (${day(at)}).`);
    }
  }
  if (analytics && input.summaryStale) {
    notes.push(
      "Something the analytics summary is built from has changed since it was generated (new analytics, a dismissal, the codebase profile or settings), so it may not reflect everything Polishd has now.",
    );
  }
  if (design && input.reviewMetricsChanged === true) {
    dataMoved = true;
    notes.push(
      "The design measurements have changed since the review was generated, so it may cite values the site no longer renders.",
    );
  } else if (design && input.reviewStale && input.reviewMetricsChanged == null) {
    notes.push(
      "Something the design review is built from has changed since it was generated (the measurements, a dismissal or the site description), so it may not reflect everything Polishd has now.",
    );
  }
  if (notes.length === 0) return [];
  return [
    "## How current this is",
    "",
    ...notes.map((s) => `- ${s}`),
    "",
    ...(dataMoved
      ? [
          "Check each finding against the code as it is now. One that no longer holds is `not_real` in your verdicts.",
          "",
        ]
      : []),
  ];
}

// ── How findings were detected ───────────────────────────────────────────────

type FindingKind = "dead-click" | "rage-click" | "error" | "page" | "engagement" | "design";

/**
 * One line per kind of finding: how Polishd detected it, and what that
 * detector can't see. The blind spot is the first thing an agent should rule
 * out, so it's stated, not left for the agent to discover. Each line mirrors
 * the detector in the capture layer (client/init.ts, client/dom.ts); change
 * one and the other has to follow.
 */
const DETECTION: Record<FindingKind, { name: string; line: string }> = {
  "dead-click": {
    name: "dead click",
    line:
      "**Dead click** — a click on an element with no interactive tag (`a`, `button`, `input`, `select`, `textarea`, `label`, `summary`), no interactive ARIA role and no inline `onclick` attribute, on itself or within four ancestors. Clicks that place a cursor in text or select it are excluded. " +
      "Blind spot: handlers attached through React's `onClick` or `addEventListener` are invisible to it, so a working `div` with an `onClick` counts as dead. Check for a handler first. If there is one, the fix is semantics and affordance (a real `<button>`, or a role plus keyboard support), not new behavior.",
  },
  "rage-click": {
    name: "rage click",
    line:
      "**Rage click** — the same element clicked several times in quick succession (3 within 500ms by default), not counting double- and triple-clicks that select text. " +
      "Blind spot: it can't tell frustration from controls meant to be clicked fast (steppers, carousels, quantity buttons), or a click that failed from one whose feedback was slow. Check what the click does and how quickly it visibly responds.",
  },
  error: {
    name: "JS error",
    line:
      "**JS error** — an uncaught error or unhandled promise rejection the browser reported, grouped by message. Errors from browser extensions are dropped where they can be attributed. " +
      "Blind spot: this prompt has only the message and where it was seen, no stack, and a third-party script's error can still slip through. Find the code that can throw it, or reproduce it, before fixing.",
  },
  page: {
    name: "page-level signal",
    line:
      "**Page-level signal** — per-page totals of sessions, rage and dead clicks, JS errors and scroll depth. " +
      "Blind spot: a total doesn't say which element is responsible, and scroll depth is only measured on pages tall enough to scroll. Find the element behind the number before changing the page.",
  },
  engagement: {
    name: "component engagement",
    line:
      "**Component engagement** — views, time visible, scroll depth and clicks for components wrapped in `<PolishdMonitor>`. " +
      "Blind spot: low engagement can come from where the component sits or who sees it, not from the component itself.",
  },
  design: {
    name: "design measurement",
    line:
      "**Design measurement** — values read from the computed styles of pages as visitors' browsers rendered them; Polishd never reads your stylesheets. " +
      "Blind spot: a value can come from a theme token, a utility class, an inline style, browser defaults or a third-party embed. Find where a value is set before changing it, and leave values that come from an embed alone.",
  },
};

const KIND_ORDER: FindingKind[] = ["dead-click", "rage-click", "error", "page", "engagement", "design"];

/** Which detector a `signal.kind` names: `dead_click`, `rage-click`, `js_error`… */
function signalKind(kind: string): FindingKind | null {
  const k = kind.toLowerCase();
  if (/dead/.test(k)) return "dead-click";
  if (/rage/.test(k)) return "rage-click";
  if (/error|exception/.test(k)) return "error";
  if (/scroll|page/.test(k)) return "page";
  if (/view|engage|monitor|component|hover/.test(k)) return "engagement";
  return null;
}

/** What kind of finding a loss is: its signal's, or failing that, what its text says. */
function lossKinds(loss: PolishdLossItem): FindingKind[] {
  const fromSignal = loss.signal ? signalKind(loss.signal.kind) : null;
  if (fromSignal) return [fromSignal];
  const text = loss.issue.toLowerCase();
  const said: FindingKind[] = [];
  if (/dead[- ]?clicks?/.test(text)) said.push("dead-click");
  if (/rage[- ]?clicks?/.test(text)) said.push("rage-click");
  if (/\b(errors?|exceptions?|throws?|crash(es)?)\b/.test(text)) said.push("error");
  return said;
}

function detectionSection(kinds: Set<FindingKind>): string[] {
  if (kinds.size === 0) return [];
  return [
    "## How these were detected",
    "",
    ...KIND_ORDER.filter((k) => kinds.has(k)).map((k) => `- ${DETECTION[k].line}`),
    "",
  ];
}

// ── Volumes and search handles ───────────────────────────────────────────────

/** How each signal kind reads in a sentence, singular and plural. */
const KIND_NOUNS: Record<string, [string, string]> = {
  dead_click: ["dead click", "dead clicks"],
  rage_click: ["rage click", "rage clicks"],
  click: ["click", "clicks"],
  js_error: ["JS error", "JS errors"],
  page_view: ["page view", "page views"],
  component_view: ["component view", "component views"],
  scroll_depth: ["scroll-depth reading", "scroll-depth readings"],
  hover: ["hover", "hovers"],
  mount: ["mount", "mounts"],
  viewport: ["viewport sample", "viewport samples"],
};

/** `dead_click` → "dead clicks". A kind not in the map is shown as written, never guessed at. */
function kindNoun(kind: string, count: number): string {
  const nouns = KIND_NOUNS[kind.trim().toLowerCase()];
  if (nouns) return nouns[count === 1 ? 0 : 1];
  return `${code(kind.trim())} ${count === 1 ? "event" : "events"}`;
}

/** Pages, three at most, then how many more. */
function pageList(pages: string[]): string {
  const shown = pages.slice(0, 3).map(code).join(", ");
  return pages.length > 3 ? `${shown} and ${pages.length - 3} more` : shown;
}

/** The count behind a loss, as one line: "23 dead clicks across 9 sessions on `/pricing`". */
function volume(s: NonNullable<PolishdLossItem["signal"]>): string | null {
  if (!s.kind?.trim() || !Number.isFinite(s.count)) return null;
  const sessions = Number.isFinite(s.sessions) ? ` across ${plural(s.sessions, "session")}` : "";
  const pages = s.pages?.length ? ` on ${pageList(s.pages)}` : "";
  return `${n(s.count)} ${kindNoun(s.kind, s.count)}${sessions}${pages}`;
}

/** Tailwind-style utilities and generated class names: everywhere, so useless to search for. */
const UTILITY_CLASS =
  /[[\]:/!]|^(?:flex|grid|block|inline|inline-block|inline-flex|hidden|relative|absolute|fixed|sticky|static|contents|container|group|peer|truncate|underline|uppercase|lowercase|capitalize|italic|antialiased|sr-only|border|rounded|shadow|ring|outline|transition|transform|grow|shrink)$|^-?(?:[mp][trblxyse]?|w|h|min-w|min-h|max-w|max-h|size|gap|gap-x|gap-y|space-x|space-y|text|bg|from|via|to|border|rounded|shadow|ring|font|leading|tracking|items|justify|content|self|place|z|top|left|right|bottom|inset|opacity|overflow|cursor|duration|ease|delay|col|row|order|basis|fill|stroke|object|aspect|line-clamp|decoration|divide|translate|scale|rotate|backdrop|blur|select|pointer-events|whitespace|break|align|list|snap|scroll)-|^(?:sc|css|jsx|emotion)-[a-z0-9]+$/i;

/** CSS-module output: `Card_root__x7Yz2` is `.root` in `Card.module.*`. */
const CSS_MODULE = /^([A-Za-z0-9]+)_([A-Za-z0-9-]+)__[A-Za-z0-9_-]{5}$/;

/** Search handles a selector holds beyond itself: its ids and meaningful classes. */
function selectorHandles(selector: string): string[] {
  const out: string[] = [];
  for (const part of selector.split(">")) {
    for (const m of part.matchAll(/([#.])([^#.>\s]+)/g)) {
      const [, sigil, name] = m;
      if (sigil === "#") {
        out.push(`id ${code(`id="${name}"`)}`);
        continue;
      }
      const mod = name.match(CSS_MODULE);
      if (mod) out.push(`class ${code(`.${mod[2]}`)} in ${code(`${mod[1]}.module.*`)}`);
      else if (!UTILITY_CLASS.test(name)) out.push(`class ${code(name)}`);
    }
  }
  return out;
}

/** Visible text, cut to a searchable length. */
function textHandle(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 60 ? `text starting ${code(t.slice(0, 60).trimEnd())}` : `the text ${code(t)}`;
}

/** A CSS selector as the capture writes it: `div.card>span`, `button#buy`. */
const SELECTOR = /^[a-z][a-z0-9-]*(?:[.#][^\s>.#]+)*(?:\s*>\s*[a-z][a-z0-9-]*(?:[.#][^\s>.#]+)*)*$/i;
/** A component name: one identifier with a hyphen or an inner capital. */
const COMPONENT = /^(?:[a-z][a-z0-9]*(?:-[a-z0-9]+)+|[A-Za-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+)$/;

/**
 * What to grep for to find the code behind a loss, beyond its citation. The
 * citation is copied from the digest, so its shape says what it is: a page
 * path names a route file, a selector its ids and meaningful classes, a
 * component name its `data-component`, anything else the element's visible
 * text, which is how the digest labels an element that has some.
 */
function lossHandles(loss: PolishdLossItem): string[] {
  const evidence = loss.evidence.trim();
  if (!evidence) return [];
  if (evidence.startsWith("/") && !/\s/.test(evidence)) {
    const route = evidence === "/" ? "app/page.*" : `app${evidence.replace(/\/$/, "")}/page.*`;
    return [`the route's page file, ${code(route)} (allow for route groups and [dynamic] segments)`];
  }
  if (COMPONENT.test(evidence)) return [code(`data-component="${evidence}"`)];
  if (SELECTOR.test(evidence) && /[.#>]/.test(evidence)) return selectorHandles(evidence);
  if (lossKinds(loss).includes("error")) {
    // The message names what threw: a property, a function, a module.
    const names: string[] = [];
    for (const m of evidence.matchAll(/'([A-Za-z_$][\w$.]*)'|\b([a-z]+[A-Z][\w$]*)\b/g)) {
      const name = m[1] ?? m[2];
      if (name && !names.includes(name)) names.push(name);
    }
    return names.slice(0, 3).map(code);
  }
  // Prose that isn't a selector: the element's visible label.
  return /\s/.test(evidence) ? [textHandle(evidence)] : [];
}

/** px and hex values in a design citation, with each px size's rem spelling. */
function designHandles(evidence: string): string[] {
  const out: string[] = [];
  for (const m of evidence.matchAll(/#[0-9a-fA-F]{3,8}\b|(\d+(?:\.\d+)?)px\b/g)) {
    const handle = m[1] !== undefined ? `${code(m[0])} (${code(`${Number(m[1]) / 16}rem`)})` : code(m[0].toLowerCase());
    if (!out.includes(handle)) out.push(handle);
  }
  return out;
}

// ── The two halves ───────────────────────────────────────────────────────────

function keepList(items: string[] | undefined): string[] {
  if (!items?.length) return [];
  return ["Working — don't regress these:", ...items.map((s) => `- ${s}`), ""];
}

function analyticsSection(summary: PolishdSummary, kinds: Set<FindingKind>): string[] {
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
    "Evidence is a selector, component name, label or page path from the captured analytics. Volume is the count behind it when the summary was generated. Source is the file Polishd matched it to, where it found one.",
    "",
  ];
  losses.forEach((loss, i) => {
    const found = lossKinds(loss);
    found.forEach((k) => kinds.add(k));
    lines.push(`- **A${i + 1}.** ${loss.issue.trim()}`);
    lines.push(`  - Evidence: ${code(loss.evidence)}`);
    if (found.length) lines.push(`  - Kind: ${found.map((k) => DETECTION[k].name).join(", ")}`);
    const counts = loss.signal && volume(loss.signal);
    if (counts) lines.push(`  - Volume: ${counts}`);
    const handles = lossHandles(loss);
    if (handles.length) lines.push(`  - Search for: ${handles.join(" · ")}`);
    lines.push(
      loss.location
        ? `  - Source: ${code(loss.location)}`
        : handles.length
          ? "  - Source: not matched to a file — start from the evidence and the handles above"
          : "  - Source: not matched to a file — search the codebase for the evidence",
    );
    const tracked = trackedIn(loss.issueUrl, loss.issueNumber);
    if (tracked) lines.push(tracked);
  });
  lines.push("");
  return lines;
}

function suggestionLines(iss: PolishdDesignIssue): string[] {
  if (iss.suggestionWithheld) {
    return [
      `  - Suggested fix: withheld — ${iss.suggestionWithheld}. Fix it with values the site already uses, or leave it.`,
    ];
  }
  if (!iss.suggestion?.trim()) return [];
  const lines = [`  - Suggested fix: ${iss.suggestion.trim()}`];
  if (iss.newValues?.length) {
    lines.push(
      `  - New to the site: ${iss.newValues.map(code).join(", ")} — not measured anywhere on it yet. Prefer an existing value; add one only if none works.`,
    );
  }
  return lines;
}

/** Where the cited values render, one line each — three at most, which is what a citation names. */
function usageLines(usages: PolishdDesignIssue["usages"]): string[] {
  if (!usages?.length) return [];
  return usages.slice(0, 3).map(
    (u) =>
      `  - Where it renders: ${code(u.label)} — ${usageFacts(u)}` +
      (u.preview ? ` (pictured on ${previewCaption(u.preview)} in the dashboard)` : ""),
  );
}

function designSection(review: PolishdDesignReview, kinds: Set<FindingKind>): string[] {
  const issues = review.issues ?? [];
  kinds.add("design");
  const lines = [
    "## Design: how the rendered design holds together",
    "",
    `_Reviewed ${day(review.generatedAt)} by ${review.provider}/${review.model}, from the typography, colors, radii and spacing measured on the rendered pages${
      review.screenshots?.pages.length
        ? ` and screenshots of ${review.screenshots.pages.join(", ")}${
            review.screenshots.values.length
              ? ` plus ${review.screenshots.values.length} flagged value${review.screenshots.values.length === 1 ? "" : "s"} in place`
              : ""
          }`
        : ""
    }._`,
    "",
    review.text.trim(),
    "",
    ...keepList(review.strengths),
    "### Problems to fix",
    "",
    "Evidence is a value measured on the rendered pages: a hex color, a px size or a page path. Search for a value in stylesheets, the theme or Tailwind config and arbitrary utility classes (`text-[15px]`, `bg-[#1a1a1a]`); a px size may be written in rem.",
    "",
  ];
  issues.forEach((iss, i) => {
    lines.push(`- **D${i + 1}.** ${iss.issue.trim()}`);
    lines.push(`  - Evidence: ${iss.evidence.trim()}`);
    const handles = designHandles(iss.evidence);
    if (handles.length) lines.push(`  - Search for: ${handles.join(", ")}`);
    lines.push(...usageLines(iss.usages));
    lines.push(...suggestionLines(iss));
    const tracked = trackedIn(iss.issueUrl, iss.issueNumber);
    if (tracked) lines.push(tracked);
  });
  lines.push("");
  return lines;
}

function howToWork(analytics: boolean, design: boolean, ids: string[], detection: boolean): string[] {
  const steps = [
    "Take the problems one at a time. Before changing anything, find the code responsible — the evidence was captured from the running site, so it points at markup this codebase really renders.",
    // Only point at the section when it's in the prompt.
    ...(detection
      ? ["Rule out the blind spot of the finding's kind (under \"How these were detected\") before accepting it."]
      : []),
    "If the code shows a problem isn't real, or is deliberate, leave it and say why. Don't invent a change to match the report.",
  ];
  if (analytics) {
    steps.push(
      "For analytics problems, fix the cause rather than the symptom: a dead click on something that looks clickable needs either a real action or a less clickable look; a rage click usually means feedback is slow or missing. Weigh the volume: a handful of events from one or two sessions may be one visitor exploring.",
    );
  }
  if (design) {
    steps.push(
      "For design problems, move one-off values onto the scale the site already uses — its theme, CSS variables or shared components — rather than hard-coding another value. Don't remove or change a value listed under \"Working — don't regress these\" to satisfy a suggestion, and treat a value marked new to the site as a last resort. Check color and contrast changes in dark mode too, if the site has one.",
    );
  }
  steps.push(
    "Keep each change scoped to its problem; don't refactor unrelated code.",
    [
      `Finish with a short summary, then a fenced JSON verdict block with one entry for each of ${ids.join(", ")}:`,
      "",
      "   ```json",
      "   [",
      `     { "id": "${ids[0]}", "verdict": "fixed", "reason": "One sentence: what you changed, or why you left it.", "files": ["path/you/changed/or/checked.tsx"] }`,
      "   ]",
      "   ```",
      "",
      "   `verdict` is `fixed` (you changed the code), `not_real` (the code shows the finding is wrong) or `deliberate` (it's real and intended; leave it). `files` lists the files you changed, or the ones that prove the verdict. Polishd reads this block back: `not_real` and `deliberate` findings, with your reasons, stop being reported.",
    ].join("\n"),
  );
  return ["## How to work through this", "", ...steps.map((s, i) => `${i + 1}. ${s}`)];
}

/**
 * The prompt for `scope`, or null when that scope has nothing to fix. "all"
 * covers whichever halves have problems, so it's null only when neither does.
 */
export function buildFixPrompt(input: FixPromptInput, scope: FixPromptScope): string | null {
  const { analytics, design } = halves(input, scope);
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

  const kinds = new Set<FindingKind>();
  const findings = [
    ...(analytics ? analyticsSection(input.summary!, kinds) : []),
    ...(design ? designSection(input.review!, kinds) : []),
  ];

  const lines = [
    title,
    "",
    `Polishd is the analytics and design-review tool installed in this Next.js app. ${what} The problems it found are below, each with the evidence it came from.`,
    "",
    ...freshnessSection(input, analytics, design),
    ...siteSection(input),
    ...trafficSection(input.traffic, analytics),
    ...findings,
    ...detectionSection(kinds),
    ...howToWork(analytics, design, fixPromptFindings(input, scope).map((f) => f.id), kinds.size > 0),
  ];
  return `${lines.join("\n").trim()}\n`;
}
