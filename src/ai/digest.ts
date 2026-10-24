/**
 * Polishd — analytics digest (server only).
 *
 * This is the token-saving heart of the AI layer. Instead of shipping raw
 * events (thousands of rows) to a model, we pre-aggregate everything on the
 * server — the same numbers the dashboard already computes — and render them as
 * a terse, structured text block. A model can read the whole picture of a site
 * in a few hundred tokens.
 *
 * Every line a loss can cite is also kept as a *target*: the exact strings the
 * line printed, and the numbers it stood on. That's what a reported loss is
 * held to on the way back — its citation must be something the digest
 * actually showed (`citedInPrompt`), and its `signal` is that line's numbers
 * (`lossSignal`), never the model's. Lines and targets come out of one pass
 * (`digestParts`), so what the model saw and what a loss is matched against
 * can't drift apart.
 *
 * `fingerprintDigest` hashes the digest so the orchestrator can skip the model
 * call entirely when nothing has changed since the last summary (see summary.ts).
 */
import { createHash } from "node:crypto";

import type { ClickFriction, ErrorFriction, FrictionIndex } from "../server/friction";
import type { PolishdDashboardData } from "../server/queries";
import type { PolishdLossSignal } from "./types";

/** Round to keep digests stable across tiny float jitter. */
const r = (n: number | null): string => (n === null ? "—" : String(Math.round(n)));

/** Trim and cap a free-text label so one outlier can't bloat the prompt. */
const clip = (s: string | null | undefined, max = 40): string =>
  !s ? "" : s.replace(/\s+/g, " ").trim().slice(0, max);

/** The clicked element itself: the last step of a `tag.class>tag.class` path. */
const clickedPart = (selector: string | null): string =>
  selector ? (selector.split(">").pop() ?? "").trim() : "";

/**
 * A text-less, positioned layer — the shape of a drawer or modal backdrop,
 * whose click handler (if any) lives in the framework, not the DOM.
 */
export function looksLikeOverlay(selector: string | null, text: string | null): boolean {
  if (!selector || (text && text.trim())) return false;
  const [tag = "", cls = ""] = clickedPart(selector).split(".");
  if (!/^(div|span|section|aside)$/i.test(tag)) return false;
  return (
    /^(fixed|absolute|inset-0|inset-[xy]-0)$/i.test(cls) ||
    /backdrop|overlay|scrim|mask|curtain|underlay/i.test(selector)
  );
}

/** Dead clicks that landed beside a control (`meta.near`), when capture said so. */
function nearClause(f: ClickFriction | undefined): string {
  const [top] = f?.near ?? [];
  if (!top || !f) return "";
  const how = top.count >= f.dead.count ? "all" : String(top.count);
  return `; ${how} of the dead clicks landed next to "${clip(top.label)}" — near misses`;
}

/** "in 6 sessions", when the friction index counted them. */
const sessionsClause = (n: number | undefined): string =>
  n ? ` in ${n} session${n === 1 ? "" : "s"}` : "";

/** The greppable path capture recorded (`meta.handle`), as the digest prints it. */
const shownHandle = (h: string | undefined): string => clip(h, 120);
const handleClause = (h: string | undefined): string =>
  h ? `; handle ${shownHandle(h)}` : "";

/** What capture recorded around an error, in one clause each. */
function errorContext(f: ErrorFriction | undefined): string {
  if (!f) return "";
  const parts: string[] = [];
  if (f.tally.count > 1 || f.tally.sessions > 1) {
    parts.push(`${f.tally.count}×${sessionsClause(f.tally.sessions)}`);
  }
  if (f.after) {
    const gap = f.after.medianMs !== undefined ? ` (~${f.after.medianMs}ms before)` : "";
    parts.push(`after "${clip(f.after.label)}"${gap}`);
  }
  if (f.frame) {
    const frame = clip(f.frame, 100);
    parts.push(/^at\s/.test(frame) ? frame : `at ${frame}`); // V8 frames already say "at"
  }
  if (f.digest) parts.push(`digest ${clip(f.digest, 24)}`);
  if (f.handle) parts.push(`handle ${shownHandle(f.handle)}`);
  return parts.length ? ` — ${parts.join("; ")}` : "";
}

// ── What a loss can cite ─────────────────────────────────────────────────────

/** Event kinds a signal can count. */
export type SignalKind = "dead_click" | "rage_click" | "js_error" | "page_view" | "component_view";

/**
 * One digest line a loss can cite: the strings it printed that identify it,
 * and the numbers it stood on, per kind. Counts are the line's own; sessions
 * and pages come from the friction index, so a kind without one is absent.
 */
export interface DigestTarget {
  section: "page" | "element" | "component" | "error";
  /** Exactly what the digest printed that a citation could copy. */
  names: string[];
  volume: Partial<Record<SignalKind, PolishdLossSignal>>;
  /** Greppable selector path capture recorded for it (`meta.handle`). */
  handle?: string;
}

const tallied = (
  count: number,
  t: { sessions: number; pages: string[] } | undefined,
  kind: SignalKind,
): Partial<Record<SignalKind, PolishdLossSignal>> =>
  count > 0 && t && t.sessions > 0
    ? { [kind]: { kind, count, sessions: t.sessions, pages: [...t.pages] } }
    : {};

/** The pages the digest ranks, worst first (rage/dead/errors/shallow scroll). */
function worstPages(pages: PolishdDashboardData["pages"]) {
  return [...pages]
    .map((p) => ({
      ...p,
      score:
        p.rageClicks * 3 +
        p.deadClicks * 2 +
        p.jsErrors * 2.5 +
        (p.avgScrollDepth !== null && p.avgScrollDepth < 50 ? (50 - p.avgScrollDepth) / 25 : 0),
    }))
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
}

/** Distinct messages, most recent first, so one recurring error can't fill the section. */
function shownErrors(errors: PolishdDashboardData["errors"]) {
  const seen = new Set<string>();
  const uniq: typeof errors = [];
  for (const e of errors) {
    if (seen.has(e.message)) continue;
    seen.add(e.message);
    uniq.push(e);
    if (uniq.length >= 5) break;
  }
  return uniq;
}

/**
 * The digest's lines and the targets a loss can cite, in one pass.
 *
 * `friction` is optional context: sessions behind each count, where dead
 * clicks landed, what preceded an error, components users struggle with.
 * Without it the digest reads exactly as the base digest — which is what
 * the staleness fingerprint is taken from, so a dashboard render never has
 * to load it.
 */
export function digestParts(
  data: PolishdDashboardData,
  context?: string,
  friction?: FrictionIndex,
): { lines: string[]; targets: DigestTarget[] } {
  const { overview, pages, elements, devices, topUsed, errors, monitored } = data;
  const clicks = friction?.clicks ?? [];
  const clickBy = (by: ClickFriction["by"], key: string) =>
    clicks.find((c) => c.by === by && c.key === key);
  const lines: string[] = [];
  const targets: DigestTarget[] = [];

  if (context && context.trim()) {
    lines.push(`SITE: ${context.trim()}`);
  }

  lines.push(
    `TOTALS: ${overview.sessions} sessions, ${overview.pageViews} page views, ` +
      `${overview.rageClicks} rage clicks, ${overview.deadClicks} dead clicks, ` +
      `${overview.jsErrors} JS errors (${overview.totalEvents} events total).`,
  );

  if (devices.length) {
    lines.push(
      "DEVICES: " +
        devices.map((d) => `${d.category} ${d.pct}%`).join(", ") +
        ".",
    );
  }

  if (topUsed.length) {
    lines.push("MOST-USED ELEMENTS (by clicks):");
    for (const t of topUsed.slice(0, 8)) {
      const label = clip(t.label) || clip(t.sampleText) || t.selector || "(unknown)";
      lines.push(`  - ${label}: ${t.clicks} clicks, ${t.pages} pages`);
    }
  }

  const worst = worstPages(pages);
  if (worst.length) {
    lines.push(
      "PAGES WITH FRICTION (worst first; scroll depth is only measured on pages tall enough to scroll — absent means no signal, not disengagement):",
    );
    for (const p of worst) {
      const scroll = p.avgScrollDepth === null ? "" : `, scroll ${r(p.avgScrollDepth)}%`;
      lines.push(
        `  - ${p.path}: ${p.sessions} sessions, ${p.rageClicks} rage, ` +
          `${p.deadClicks} dead, ${p.jsErrors} err${scroll}`,
      );
    }
  }
  // Any measured page can be cited by its path — from this section or the
  // profile — and its line's numbers are the page's own.
  for (const p of pages) {
    const f = friction?.pages.find((x) => x.path === p.path);
    targets.push({
      section: "page",
      names: [p.path],
      volume: {
        ...tallied(p.rageClicks, f?.rage, "rage_click"),
        ...tallied(p.deadClicks, f?.dead, "dead_click"),
        ...tallied(p.jsErrors, f?.error, "js_error"),
        ...(p.pageViews > 0
          ? { page_view: { kind: "page_view", count: p.pageViews, sessions: p.sessions, pages: [p.path] } }
          : {}),
      },
    });
  }

  const brokenEls = elements.filter((e) => e.rageClicks > 0 || e.deadClicks > 0).slice(0, 8);
  if (brokenEls.length) {
    lines.push(
      "ELEMENTS USERS STRUGGLE WITH (label = the clicked element's visible text, which for a wrapper includes its children's; <tag.class> = what was actually clicked):",
    );
    for (const e of brokenEls) {
      const text = clip(e.sampleText);
      const label = text || e.label;
      const clicked = text ? clickedPart(e.selector) : "";
      const shown = clicked ? `${label} <${clicked}>` : label;
      const f = clickBy("selector", e.label);
      const notes = [
        nearClause(f),
        looksLikeOverlay(e.selector, e.sampleText)
          ? "; no text, positioned layer — could be an overlay or backdrop"
          : "",
        handleClause(f?.handle),
      ].join("");
      lines.push(
        `  - ${shown}: ${e.rageClicks} rage${sessionsClause(f?.rage.sessions)}, ` +
          `${e.deadClicks} dead${sessionsClause(f?.dead.sessions)}, ${e.pages} pages${notes}`,
      );
      targets.push({
        section: "element",
        names: [...new Set([label, shown, ...(f?.handle ? [shownHandle(f.handle)] : [])])],
        volume: {
          ...tallied(e.rageClicks, f?.rage, "rage_click"),
          ...tallied(e.deadClicks, f?.dead, "dead_click"),
        },
        ...(f?.handle ? { handle: f.handle } : {}),
      });
    }
  }

  const shownMonitored = monitored.slice(0, 6);
  if (shownMonitored.length) {
    lines.push("MONITORED COMPONENTS (engagement):");
    for (const m of shownMonitored) {
      const parts = [`${m.componentViews} views`];
      if (m.avgViewMs !== null) parts.push(`avg ${Math.round(m.avgViewMs / 100) / 10}s visible`);
      if (m.avgScrollDepth !== null) parts.push(`${m.avgScrollDepth}% scrolled`);
      const f = clickBy("component", m.name);
      if (m.rageClicks > 0) parts.push(`${m.rageClicks} rage${sessionsClause(f?.rage.sessions)}`);
      if (m.deadClicks > 0) parts.push(`${m.deadClicks} dead${sessionsClause(f?.dead.sessions)}`);
      lines.push(`  - ${m.name}: ${parts.join(", ")}${nearClause(f)}${handleClause(f?.handle)}`);
      targets.push({
        section: "component",
        names: [m.name],
        volume: {
          ...tallied(m.rageClicks, f?.rage, "rage_click"),
          ...tallied(m.deadClicks, f?.dead, "dead_click"),
          ...(m.componentViews > 0
            ? { component_view: { kind: "component_view", count: m.componentViews, sessions: m.sessions, pages: [] } }
            : {}),
        },
        ...(f?.handle ? { handle: f.handle } : {}),
      });
    }
  }

  // Clicks inside a `data-component` that isn't a monitored one fall outside
  // both sections above (element stats skip anything with a component), so
  // without the friction index they'd be invisible here.
  const monitoredNames = new Set(monitored.map((m) => m.name));
  const struggling = clicks
    .filter((c) => c.by === "component" && !monitoredNames.has(c.key))
    .filter((c) => c.dead.count + c.rage.count > 0)
    .slice(0, 6);
  if (struggling.length) {
    lines.push("COMPONENTS USERS STRUGGLE WITH (clicks anywhere inside a data-component):");
    for (const c of struggling) {
      const where = [...new Set([...c.dead.pages, ...c.rage.pages])].slice(0, 3).join(", ");
      lines.push(
        `  - ${c.key}: ${c.rage.count} rage${sessionsClause(c.rage.sessions)}, ` +
          `${c.dead.count} dead${sessionsClause(c.dead.sessions)}, on ${where}` +
          `${nearClause(c)}${handleClause(c.handle)}`,
      );
      targets.push({
        section: "component",
        names: [c.key, ...(c.handle ? [shownHandle(c.handle)] : [])],
        volume: {
          ...tallied(c.rage.count, c.rage, "rage_click"),
          ...tallied(c.dead.count, c.dead, "dead_click"),
        },
        ...(c.handle ? { handle: c.handle } : {}),
      });
    }
  }

  const uniq = shownErrors(errors);
  if (uniq.length) {
    lines.push("RECENT ERRORS:");
    for (const e of uniq) {
      const f = friction?.errors.find((x) => x.message === e.message);
      lines.push(`  - "${clip(e.message, 80)}" on ${e.path}${errorContext(f)}`);
      targets.push({
        section: "error",
        names: [...new Set([clip(e.message, 80), e.message])],
        volume: tallied(e.count, f?.tally, "js_error"),
        ...(f?.handle ? { handle: f.handle } : {}),
      });
    }
  }

  return { lines, targets };
}

/**
 * Render the captured analytics as a compact, model-readable brief. Sections
 * are omitted when empty so the prompt only ever contains real signal.
 */
export function buildDigest(
  data: PolishdDashboardData,
  context?: string,
  friction?: FrictionIndex,
): string {
  return digestParts(data, context, friction).lines.join("\n");
}

/** Stable fingerprint of a digest — drives the "data unchanged" short-circuit. */
export function fingerprintDigest(digest: string): string {
  return createHash("sha256").update(digest).digest("hex").slice(0, 16);
}

// ── Holding a loss to what the digest showed ─────────────────────────────────

const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[`"'“”‘’]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * The target a citation refers to: the one digest line that printed exactly
 * this string — or null, when none did or more than one did. Nothing looser:
 * a citation that merely *contains* a printed name ("Export CSV" around the
 * line "Export", an unmeasured `/docs/getting-started` around `/docs`) is
 * about something else, and would carry another line's numbers. And ties are
 * never broken by volume: two lines both printed "Export" means the citation
 * doesn't say which, so it gets neither.
 */
export function citedTarget(evidence: string, targets: DigestTarget[]): DigestTarget | null {
  const ev = norm(evidence);
  if (!ev) return null;
  const exact = targets.filter((t) => t.names.some((n) => norm(n) === ev));
  return exact.length === 1 ? exact[0] : null;
}

/**
 * Whether a citation is grounded in the prompt we sent. A token of four
 * characters or more found in it is enough (that's how selectors, paths and
 * component names are checked); a label too short to have one — "Log in",
 * "Pay", "OK" — counts only as an exact copy of a label the digest printed.
 */
export function citedInPrompt(
  evidence: string,
  promptText: string,
  targets: DigestTarget[],
): boolean {
  const hay = promptText.toLowerCase();
  const tokens = evidence
    .toLowerCase()
    .split(/[^\w/-]+/)
    .filter(
      (t) =>
        t.length >= 4 &&
        !/^(button|input|click|clicks|page|pages|http|https|with|from|that)$/.test(t),
    );
  if (tokens.some((t) => hay.includes(t))) return true;
  const ev = norm(evidence);
  return !!ev && targets.some((t) => t.names.some((n) => norm(n) === ev));
}

const RAGE = /\brage/i;
const DEAD = /\bdead\b|\bunresponsive|\bno (?:visible )?response|\bnear[- ]?miss|\bmissed\b|\bdoesn'?t respond|\bnothing happen/i;
const ERROR = /\berror|\bexception|\bthrows?\b|\bthrown\b|\bcrash/i;
const WORDS: [SignalKind, RegExp][] = [
  ["rage_click", RAGE],
  ["dead_click", DEAD],
  ["js_error", ERROR],
];

/**
 * The analytics volume behind a loss: the cited line's own numbers, for the
 * kind of event the loss is about. Undefined when the citation names no
 * digest line (or several), or when which kind it means isn't clear.
 *
 * The kind comes from the loss's wording — it picks among the line's counts,
 * it never supplies one. A loss naming one friction kind gets that kind (if
 * the line has it). A loss naming none is about engagement — a page's views,
 * a component's views — or, on an element whose line has only one kind of
 * friction, that one. Naming several, or a kind the line doesn't have, is
 * unclear, and gets nothing rather than a guess.
 */
export function lossSignal(
  evidence: string,
  issue: string,
  targets: DigestTarget[],
): PolishdLossSignal | undefined {
  const t = citedTarget(evidence, targets);
  if (!t) return undefined;
  if (t.section === "error") return t.volume.js_error;

  // The issue's wording only: a citation like `/errors` names a page, not a kind.
  const named = WORDS.filter(([, re]) => re.test(issue)).map(([k]) => k);
  if (named.length === 1) return t.volume[named[0]];
  if (named.length > 1) return undefined;

  if (t.section === "page") return t.volume.page_view;
  if (t.volume.component_view) return t.volume.component_view;
  const friction = (["rage_click", "dead_click"] as const).filter((k) => t.volume[k]);
  return friction.length === 1 ? t.volume[friction[0]] : undefined;
}
