/**
 * Buffd — analytics digest (server only).
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

import type { BuffdDashboardData } from "../server/queries";

/** Round to keep digests stable across tiny float jitter. */
const r = (n: number | null): string => (n === null ? "—" : String(Math.round(n)));

/** Trim and cap a free-text label so one outlier can't bloat the prompt. */
const clip = (s: string | null | undefined, max = 40): string =>
  !s ? "" : s.replace(/\s+/g, " ").trim().slice(0, max);

/**
 * Render the captured analytics as a compact, model-readable brief. Sections
 * are omitted when empty so the prompt only ever contains real signal.
 */
export function buildDigest(data: BuffdDashboardData, context?: string): string {
  const { overview, pages, elements, devices, topUsed, errors, monitored } = data;
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
    lines.push("PAGES WITH FRICTION (worst first):");
    for (const p of worst) {
      lines.push(
        `  - ${p.path}: ${p.sessions} sessions, ${p.rageClicks} rage, ` +
          `${p.deadClicks} dead, ${p.jsErrors} err, scroll ${r(p.avgScrollDepth)}%`,
      );
    }
  }

  const brokenEls = elements.filter((e) => e.rageClicks > 0 || e.deadClicks > 0).slice(0, 8);
  if (brokenEls.length) {
    lines.push("ELEMENTS USERS STRUGGLE WITH:");
    for (const e of brokenEls) {
      const label = clip(e.sampleText) || e.label;
      lines.push(`  - ${label}: ${e.rageClicks} rage, ${e.deadClicks} dead, ${e.pages} pages`);
    }
  }

  if (monitored.length) {
    lines.push("MONITORED COMPONENTS (engagement):");
    for (const m of monitored.slice(0, 6)) {
      const parts = [`${m.componentViews} views`];
      if (m.avgViewMs !== null) parts.push(`avg ${Math.round(m.avgViewMs / 100) / 10}s visible`);
      if (m.avgScrollDepth !== null) parts.push(`${m.avgScrollDepth}% scrolled`);
      if (m.rageClicks > 0) parts.push(`${m.rageClicks} rage`);
      lines.push(`  - ${m.name}: ${parts.join(", ")}`);
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
      lines.push(`  - "${clip(e.message, 80)}" on ${e.path}`);
    }
  }

  return lines.join("\n");
}

/** Stable fingerprint of a digest — drives the "data unchanged" short-circuit. */
export function fingerprintDigest(digest: string): string {
  return createHash("sha256").update(digest).digest("hex").slice(0, 16);
}
