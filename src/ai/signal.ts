/**
 * Polishd — how much behaviour a loss stands on (pure).
 *
 * A loss is the model's reading of the data; its `signal` is the data itself:
 * which kind of event the cited evidence collected, how many, in how many
 * sessions, on which pages. It's looked up here from the aggregates after the
 * model answers — never taken from the model, whose numbers are prose — so a
 * reader can tell fourteen dead clicks from six people apart from three from
 * one.
 *
 * Pure: reads the dashboard data the summary was built from, no I/O.
 */
import type { ClickFriction, FrictionTally } from "../server/friction";
import type { PolishdDashboardData } from "../server/queries";
import type { PolishdLossSignal } from "./types";

/** The slice of the dashboard data a signal is looked up in. */
export type SignalSource = Pick<
  PolishdDashboardData,
  "friction" | "elements" | "pages" | "monitored"
>;

const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[`"'“”‘’]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** The label the digest shows for an element, clipped the same way. */
const shown = (s: string | null | undefined, max = 40): string =>
  !s ? "" : s.replace(/\s+/g, " ").trim().slice(0, max);

const toSignal = (kind: string, t: FrictionTally): PolishdLossSignal => ({
  kind,
  count: t.count,
  sessions: t.sessions,
  pages: [...t.pages],
});

/**
 * Which kind of friction the loss is about. The issue text may name it —
 * "rage clicks on…" — and that's taken when the data has that kind; it only
 * picks among real counts, it never supplies one. Otherwise the larger count.
 */
function pickKind<K extends string>(
  issue: string,
  options: { kind: K; word: RegExp; tally: FrictionTally }[],
): { kind: K; tally: FrictionTally } | null {
  const present = options.filter((o) => o.tally.count > 0);
  if (!present.length) return null;
  const named = present.filter((o) => o.word.test(issue));
  const pool = named.length === 1 ? named : present;
  return pool.reduce((best, o) => (o.tally.count > best.tally.count ? o : best));
}

const RAGE = /\brage/i;
const DEAD = /\bdead|\bunresponsive|\bno response|\bnear[- ]miss|\bmissed/i;
const ERROR = /\berror|\bexception|\bthrow|\bcrash/i;

function clickSignal(issue: string, c: ClickFriction): PolishdLossSignal | undefined {
  const pick = pickKind(issue, [
    { kind: "rage_click", word: RAGE, tally: c.rage },
    { kind: "dead_click", word: DEAD, tally: c.dead },
  ]);
  return pick ? toSignal(pick.kind, pick.tally) : undefined;
}

/** A click target's names, as the digest could have shown them. */
function clickNames(c: ClickFriction, data: SignalSource): string[] {
  const names = [c.key];
  if (c.selector) names.push(c.selector);
  if (c.text) names.push(shown(c.text), c.text);
  if (c.by === "selector") {
    for (const e of data.elements) {
      if (e.selector === c.key || e.label === c.key) {
        if (e.sampleText) names.push(shown(e.sampleText), e.sampleText);
      }
    }
  }
  return names.map(norm).filter((n) => n.length >= 2);
}

/**
 * The best match among named things: an exact citation first, otherwise the
 * longest name the citation contains (so `Show 9 more (on div.flex)` finds
 * the element labelled «Show 9 more»). Ties go to the busier target.
 */
function bestMatch<T>(
  ev: string,
  items: T[],
  names: (t: T) => string[],
  weight: (t: T) => number,
): T | null {
  let exact: T | null = null;
  let contained: { item: T; len: number } | null = null;
  for (const item of items) {
    for (const name of names(item)) {
      if (name === ev) {
        if (!exact || weight(item) > weight(exact)) exact = item;
      } else if (name.length >= 4 && ev.includes(name)) {
        if (
          !contained ||
          name.length > contained.len ||
          (name.length === contained.len && weight(item) > weight(contained.item))
        ) {
          contained = { item, len: name.length };
        }
      }
    }
  }
  return exact ?? contained?.item ?? null;
}

/**
 * The signal behind one loss's evidence, or undefined when the evidence
 * isn't something the aggregates count (the loss is still kept — it just
 * carries no volume).
 *
 * Evidence is matched the way the digest printed it: an error message, a
 * page path, a component name, or an element's label or selector.
 */
export function lossSignal(
  evidence: string,
  issue: string,
  data: SignalSource,
): PolishdLossSignal | undefined {
  const ev = norm(evidence);
  if (!ev) return undefined;
  const { friction } = data;

  // Errors: the digest quotes messages clipped to 80 characters.
  const error = bestMatch(
    ev,
    friction.errors,
    (e) => {
      const full = norm(e.message);
      const clipped = norm(shown(e.message, 80));
      // A citation that is the start of a long message is that message.
      return ev.length >= 12 && full.startsWith(ev) ? [ev, clipped] : [full, clipped];
    },
    (e) => e.tally.count,
  );
  if (error) return toSignal("js_error", error.tally);

  // Pages: a path cited on its own (or leading the citation).
  const pathToken = evidence.trim().replace(/^[`"'“”‘’]+|[`"'“”‘’]+$/g, "").split(/\s+/)[0];
  if (pathToken.startsWith("/")) {
    const path = pathToken.length > 1 ? pathToken.replace(/\/+$/, "") : pathToken;
    const page = friction.pages.find((p) => p.path === path);
    if (page) {
      const pick = pickKind(issue, [
        { kind: "rage_click", word: RAGE, tally: page.rage },
        { kind: "dead_click", word: DEAD, tally: page.dead },
        { kind: "js_error", word: ERROR, tally: page.error },
      ]);
      if (pick) return toSignal(pick.kind, pick.tally);
    }
    const stat = data.pages.find((p) => p.path === path);
    if (stat) {
      // No friction on it: the loss is about engagement — say how many saw it.
      return { kind: "page_view", count: stat.pageViews, sessions: stat.sessions, pages: [path] };
    }
  }

  // Components and elements.
  const click = bestMatch(
    ev,
    friction.clicks,
    (c) => clickNames(c, data),
    (c) => c.dead.count + c.rage.count,
  );
  if (click) {
    const s = clickSignal(issue, click);
    if (s) return s;
  }

  const monitored = data.monitored.find((m) => norm(m.name) === ev);
  if (monitored) {
    return {
      kind: "component_view",
      count: monitored.componentViews,
      sessions: monitored.sessions,
      pages: [],
    };
  }
  return undefined;
}
