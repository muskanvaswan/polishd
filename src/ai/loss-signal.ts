/**
 * Polishd — the numbers behind a loss.
 *
 * A loss reaches the fix prompt as a sentence and a citation: "Feature cards
 * look clickable but aren't", `div.feature-card`. A coding agent can't weigh
 * that. Fourteen dead clicks from nine visitors is a real problem; fourteen
 * from one person exploring the page probably isn't. And when Polishd matched
 * the citation to no file, the agent has only a selector to search for. The
 * analytics hold both the volume and better handles (the element's visible
 * text, its `data-component` name), so this looks the citation up in the data
 * the summary was written from and keeps what it finds on the loss.
 *
 * The citation is copied from the digest (see digest.ts), so it matches one of
 * the digest's labels: an element's visible text or selector, a monitored
 * component's name, a page path, an error message. The digest clips long
 * labels, and the lookup clips the same way.
 *
 * Pure, with type-only imports, so the tests exercise it directly.
 */
import type { PolishdDashboardData } from "../server/queries";
import type { PolishdLossSignal } from "./types";

type SignalData = Pick<PolishdDashboardData, "elements" | "topUsed" | "monitored" | "pages" | "errors">;

/** The digest's clip (digest.ts), so a clipped label still matches. */
const clip = (s: string | null | undefined, max = 40): string =>
  !s ? "" : s.replace(/\s+/g, " ").trim().slice(0, max);

const norm = (s: string): string => s.replace(/\s+/g, " ").trim().toLowerCase();

interface Candidate {
  /** Every string the digest could have printed for this row. */
  names: string[];
  signal: PolishdLossSignal;
}

function candidates(data: SignalData): Candidate[] {
  const out: Candidate[] = [];
  // Most specific first: a struggle row carries the friction counts.
  for (const e of data.elements) {
    out.push({
      names: [clip(e.sampleText), e.label, e.selector ?? ""],
      signal: {
        kind: "element",
        clicks: e.clicks,
        rageClicks: e.rageClicks,
        deadClicks: e.deadClicks,
        sessions: e.frictionSessions,
        pages: e.pages,
        selector: e.selector ?? undefined,
        text: clip(e.sampleText, 80) || undefined,
      },
    });
  }
  for (const m of data.monitored) {
    out.push({
      names: [m.name],
      signal: {
        kind: "component",
        clicks: m.clicks,
        rageClicks: m.rageClicks,
        deadClicks: m.deadClicks,
        sessions: m.sessions,
        pages: m.pages,
        component: m.name,
      },
    });
  }
  for (const t of data.topUsed) {
    out.push({
      names: [t.label, clip(t.sampleText), t.selector ?? ""],
      signal: {
        kind: t.isComponent ? "component" : "element",
        clicks: t.clicks,
        sessions: t.sessions,
        pages: t.pages,
        selector: t.selector ?? undefined,
        text: clip(t.sampleText, 80) || undefined,
        component: t.isComponent ? t.label : undefined,
      },
    });
  }
  for (const p of data.pages) {
    out.push({
      names: [p.path],
      signal: {
        kind: "page",
        sessions: p.sessions,
        pageViews: p.pageViews,
        rageClicks: p.rageClicks,
        deadClicks: p.deadClicks,
        jsErrors: p.jsErrors,
        scrollDepth: p.avgScrollDepth === null ? undefined : Math.round(p.avgScrollDepth),
      },
    });
  }
  for (const e of data.errors) {
    out.push({
      names: [clip(e.message, 80), e.message],
      signal: {
        kind: "error",
        occurrences: e.count,
        paths: e.paths.slice(0, 5),
        component: e.component,
      },
    });
  }
  return out;
}

/**
 * The analytics row `evidence` cites, or undefined when it names none. An
 * exact match wins; failing that, the longest name the citation contains
 * ("the Compare plans button on /pricing" names the button, not the page);
 * failing that, a name that contains the citation, when only one does.
 */
export function lossSignal(evidence: string, data: SignalData): PolishdLossSignal | undefined {
  const cited = norm(evidence);
  if (!cited) return undefined;
  const all = candidates(data);

  for (const c of all) {
    if (c.names.some((n) => n && norm(n) === cited)) return c.signal;
  }

  let best: { signal: PolishdLossSignal; length: number } | null = null;
  for (const c of all) {
    for (const n of c.names) {
      const name = n ? norm(n) : "";
      if (name.length >= 4 && cited.includes(name) && (!best || name.length > best.length)) {
        best = { signal: c.signal, length: name.length };
      }
    }
  }
  if (best) return best.signal;

  if (cited.length >= 6) {
    const containing = all.filter((c) => c.names.some((n) => n && norm(n).includes(cited)));
    if (containing.length === 1) return containing[0].signal;
  }
  return undefined;
}
