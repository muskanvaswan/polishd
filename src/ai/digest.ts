/**
 * Polishd — analytics digest (server only).
 *
 * This is the token-saving heart of the AI layer. Instead of shipping raw
 * events (thousands of rows) to a model, we pre-aggregate everything on the
 * server — the same numbers the dashboard already computes — and render them as
 * a terse, structured text block. A model can read the whole picture of a site
 * in a few hundred tokens.
 *
 * `fingerprintDigest` hashes the digest so the orchestrator can skip the model
 * call entirely when nothing has changed since the last summary (see summary.ts).
 */
import { createHash } from "node:crypto";

import type { ClickFriction, ErrorFriction } from "../server/friction";
import type { PolishdDashboardData } from "../server/queries";

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
  return parts.length ? ` — ${parts.join("; ")}` : "";
}

/**
 * Render the captured analytics as a compact, model-readable brief. Sections
 * are omitted when empty so the prompt only ever contains real signal.
 *
 * Optional capture context (`friction`) is folded in where present — sessions
 * behind each count, dead clicks that landed beside a control, what preceded
 * an error — and simply absent where it isn't, so older data reads as before.
 */
export function buildDigest(data: PolishdDashboardData, context?: string): string {
  const { overview, pages, elements, devices, topUsed, errors, monitored } = data;
  const friction = data.friction ?? { clicks: [], pages: [], errors: [], capped: false };
  const clickBy = (by: ClickFriction["by"], key: string) =>
    friction.clicks.find((c) => c.by === by && c.key === key);
  const lines: string[] = [];

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

  // Pages ranked worst-first by issue score (rage/dead/errors/shallow scroll).
  const worst = [...pages]
    .map((p) => ({
      ...p,
      score:
        p.rageClicks * 3 +
        p.deadClicks * 2 +
        p.jsErrors * 2.5 +
        (p.avgScrollDepth !== null && p.avgScrollDepth < 50
          ? (50 - p.avgScrollDepth) / 25
          : 0),
    }))
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
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

  const brokenEls = elements.filter((e) => e.rageClicks > 0 || e.deadClicks > 0).slice(0, 8);
  if (brokenEls.length) {
    lines.push(
      "ELEMENTS USERS STRUGGLE WITH (label = the clicked element's visible text, which for a wrapper includes its children's; <tag.class> = what was actually clicked):",
    );
    for (const e of brokenEls) {
      const text = clip(e.sampleText);
      const label = text || e.label;
      const clicked = text ? clickedPart(e.selector) : "";
      const f = clickBy("selector", e.label);
      const notes = [
        nearClause(f),
        looksLikeOverlay(e.selector, e.sampleText)
          ? "; no text, positioned layer — could be an overlay or backdrop"
          : "",
      ].join("");
      lines.push(
        `  - ${label}${clicked ? ` <${clicked}>` : ""}: ${e.rageClicks} rage${sessionsClause(f?.rage.sessions)}, ` +
          `${e.deadClicks} dead${sessionsClause(f?.dead.sessions)}, ${e.pages} pages${notes}`,
      );
    }
  }

  if (monitored.length) {
    lines.push("MONITORED COMPONENTS (engagement):");
    for (const m of monitored.slice(0, 6)) {
      const parts = [`${m.componentViews} views`];
      if (m.avgViewMs !== null) parts.push(`avg ${Math.round(m.avgViewMs / 100) / 10}s visible`);
      if (m.avgScrollDepth !== null) parts.push(`${m.avgScrollDepth}% scrolled`);
      const f = clickBy("component", m.name);
      if (m.rageClicks > 0) parts.push(`${m.rageClicks} rage${sessionsClause(f?.rage.sessions)}`);
      if (m.deadClicks > 0) parts.push(`${m.deadClicks} dead${sessionsClause(f?.dead.sessions)}`);
      lines.push(`  - ${m.name}: ${parts.join(", ")}${nearClause(f)}`);
    }
  }

  if (errors.length) {
    // Dedupe by message so a single recurring error doesn't fill the section.
    const seen = new Set<string>();
    const uniq: typeof errors = [];
    for (const e of errors) {
      if (seen.has(e.message)) continue;
      seen.add(e.message);
      uniq.push(e);
      if (uniq.length >= 5) break;
    }
    lines.push("RECENT ERRORS:");
    for (const e of uniq) {
      const f = friction.errors.find((x) => x.message === e.message);
      lines.push(`  - "${clip(e.message, 80)}" on ${e.path}${errorContext(f)}`);
    }
  }

  return lines.join("\n");
}

/** Stable fingerprint of a digest — drives the "data unchanged" short-circuit. */
export function fingerprintDigest(digest: string): string {
  return createHash("sha256").update(digest).digest("hex").slice(0, 16);
}
