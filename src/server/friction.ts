/**
 * Polishd — friction index (pure).
 *
 * The dashboard's aggregates say how many rage clicks, dead clicks and errors
 * each element, page and component collected. What they can't say is how many
 * people that was, where it happened, or the context capture attached to it —
 * the control a dead click landed next to, the last thing a user did before an
 * error. That's what this index holds: the friction events folded per target,
 * with distinct sessions, the pages they happened on, and that context.
 *
 * It feeds two things: the AI digest (so the model reads "14 dead clicks in 6
 * sessions, 12 of them next to «Show 9 more»" rather than a bare count) and
 * each reported loss's `signal`, which is filled from here — never from the
 * model's own numbers.
 *
 * Pure, no I/O: queries.ts reads the rows (one grouped query) and hands them
 * in already parsed, so this can be tested over plain arrays.
 */

/** The friction event kinds the index folds. */
export type FrictionKind = "dead_click" | "rage_click" | "js_error";

/**
 * One row of the grouped friction query: every event of one kind, on one
 * page, target and session — and for dead clicks and errors, one `meta` —
 * collapsed to a count.
 */
export interface FrictionRow {
  type: FrictionKind;
  path: string;
  selector: string | null;
  component: string | null;
  /** A sample of the target's visible text, when it had any. */
  text: string | null;
  session: string;
  /** Parsed meta (`near`, `handle`, the error fields), when the event had any. */
  meta?: Record<string, unknown> | null;
  /** How many events the row stands for. */
  n: number;
}

/** How much of one kind of friction a target collected. */
export interface FrictionTally {
  count: number;
  /** Distinct sessions it happened in. */
  sessions: number;
  /** The pages it happened on, most affected first (capped). */
  pages: string[];
}

/** Rage and dead clicks on one target. */
export interface ClickFriction {
  /**
   * The target's identity: its `data-component` name when it has one (the
   * same grouping the digest's monitored-components section uses), otherwise
   * its selector.
   */
  key: string;
  by: "component" | "selector";
  /** A representative selector for the clicks, even when keyed by component. */
  selector: string | null;
  /** A sample of the clicked element's visible text. */
  text: string | null;
  dead: FrictionTally;
  rage: FrictionTally;
  /**
   * The controls dead clicks on this target landed next to (`meta.near`),
   * most frequent first. Empty when capture didn't record any — older
   * clients, or clicks with no control nearby.
   */
  near: { label: string; count: number }[];
  /**
   * The greppable selector path capture recorded for the target
   * (`meta.handle`), the most frequent one. Absent from older clients.
   */
  handle?: string;
}

/** Friction on one page, per kind. */
export interface PageFriction {
  path: string;
  dead: FrictionTally;
  rage: FrictionTally;
  error: FrictionTally;
}

/** One distinct error message and the context capture attached to it. */
export interface ErrorFriction {
  message: string;
  tally: FrictionTally;
  /** Server error digest (`meta.digest`), from the most recent throw that had one. */
  digest?: string;
  /** Top stack frame (`meta.frame`), from the most recent throw that had one. */
  frame?: string;
  /**
   * The interaction most often recorded just before the throw (`meta.after`),
   * with how many throws followed it and the median gap between them.
   */
  after?: { label: string; count: number; medianMs?: number };
  /** Selector of that preceding interaction (`meta.afterSelector`), most recent. */
  afterSelector?: string;
  /** Greppable selector path for the throw site (`meta.handle`), most frequent. */
  handle?: string;
}

export interface FrictionIndex {
  clicks: ClickFriction[];
  pages: PageFriction[];
  errors: ErrorFriction[];
  /**
   * True when the query hit its row cap: the tallies then cover the most
   * recent friction only and read low, never wrong in kind.
   */
  capped: boolean;
}

export const EMPTY_FRICTION: FrictionIndex = { clicks: [], pages: [], errors: [], capped: false };

/** How many pages a tally lists. */
export const MAX_TALLY_PAGES = 5;
/** How many `near` labels a click target keeps. */
const MAX_NEAR = 3;

/** Running tally: counts plus the sets it needs to finish. */
interface Acc {
  count: number;
  sessions: Set<string>;
  pages: Map<string, number>;
}

const acc = (): Acc => ({ count: 0, sessions: new Set(), pages: new Map() });

function add(a: Acc, row: FrictionRow): void {
  a.count += row.n;
  a.sessions.add(row.session);
  a.pages.set(row.path, (a.pages.get(row.path) ?? 0) + row.n);
}

function finish(a: Acc): FrictionTally {
  return {
    count: a.count,
    sessions: a.sessions.size,
    pages: [...a.pages.entries()]
      .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
      .slice(0, MAX_TALLY_PAGES)
      .map(([p]) => p),
  };
}

/** A meta string worth showing: present, non-blank, trimmed and capped. */
function metaString(meta: FrictionRow["meta"], key: string, max = 120): string | undefined {
  const v = meta?.[key];
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v !== "string") return undefined;
  const s = v.replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : undefined;
}

function metaNumber(meta: FrictionRow["meta"], key: string): number | undefined {
  const v = meta?.[key];
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function median(values: number[]): number | undefined {
  if (!values.length) return undefined;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return Math.round(s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2);
}

/** Labels with their counts, most frequent first, capped. */
function ranked(counts: Map<string, number>, max: number): { label: string; count: number }[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([label, count]) => ({ label, count }));
}

/** Count a row's `meta.handle`, when capture recorded one. */
function tallyHandle(handles: Map<string, number>, row: FrictionRow): void {
  const h = metaString(row.meta, "handle", 200);
  if (h) handles.set(h, (handles.get(h) ?? 0) + row.n);
}

const topHandle = (handles: Map<string, number>): { handle?: string } => {
  const [top] = ranked(handles, 1);
  return top ? { handle: top.label } : {};
};

/**
 * Fold the grouped friction rows into per-target tallies.
 *
 * Rows are expected most recent first (the query orders them that way), which
 * is what "the most recent throw that had one" means for an error's digest
 * and frame. `capped` is passed through from the query.
 */
export function foldFriction(rows: FrictionRow[], capped = false): FrictionIndex {
  const clicks = new Map<
    string,
    {
      by: ClickFriction["by"];
      selector: string | null;
      text: string | null;
      dead: Acc;
      rage: Acc;
      near: Map<string, number>;
      handles: Map<string, number>;
    }
  >();
  const pages = new Map<string, { dead: Acc; rage: Acc; error: Acc }>();
  const errors = new Map<
    string,
    {
      tally: Acc;
      digest?: string;
      frame?: string;
      afterSelector?: string;
      after: Map<string, number>;
      afterMs: Map<string, number[]>;
      handles: Map<string, number>;
    }
  >();

  for (const row of rows) {
    if (!row || row.n <= 0) continue;

    let page = pages.get(row.path);
    if (!page) pages.set(row.path, (page = { dead: acc(), rage: acc(), error: acc() }));

    if (row.type === "js_error") {
      add(page.error, row);
      // Verbatim, as getRecentErrors keys it, so the two line up by message.
      const raw = row.meta?.message;
      const message = typeof raw === "string" && raw ? raw : "Unknown error";
      let e = errors.get(message);
      if (!e) {
        errors.set(
          message,
          (e = { tally: acc(), after: new Map(), afterMs: new Map(), handles: new Map() }),
        );
      }
      add(e.tally, row);
      e.digest ??= metaString(row.meta, "digest", 80);
      e.frame ??= metaString(row.meta, "frame", 160);
      e.afterSelector ??= metaString(row.meta, "afterSelector", 160);
      tallyHandle(e.handles, row);
      const after = metaString(row.meta, "after", 80);
      if (after) {
        e.after.set(after, (e.after.get(after) ?? 0) + row.n);
        const ms = metaNumber(row.meta, "afterMs");
        if (ms !== undefined) {
          const list = e.afterMs.get(after) ?? [];
          list.push(ms);
          e.afterMs.set(after, list);
        }
      }
      continue;
    }

    const kind = row.type === "dead_click" ? "dead" : "rage";
    add(page[kind], row);

    const by: ClickFriction["by"] = row.component ? "component" : "selector";
    const key = row.component ?? row.selector ?? "(unknown)";
    const mapKey = `${by}\u0000${key}`;
    let c = clicks.get(mapKey);
    if (!c) {
      clicks.set(
        mapKey,
        (c = {
          by,
          selector: row.selector,
          text: row.text,
          dead: acc(),
          rage: acc(),
          near: new Map(),
          handles: new Map(),
        }),
      );
    }
    c.selector ??= row.selector;
    c.text ??= row.text;
    add(c[kind], row);
    tallyHandle(c.handles, row);
    if (kind === "dead") {
      const near = metaString(row.meta, "near", 80);
      if (near) c.near.set(near, (c.near.get(near) ?? 0) + row.n);
    }
  }

  return {
    clicks: [...clicks.entries()]
      .map(([mapKey, c]): ClickFriction => ({
        key: mapKey.slice(mapKey.indexOf("\u0000") + 1),
        by: c.by,
        selector: c.selector,
        text: c.text,
        dead: finish(c.dead),
        rage: finish(c.rage),
        near: ranked(c.near, MAX_NEAR),
        ...topHandle(c.handles),
      }))
      .sort((a, b) => b.dead.count + b.rage.count - (a.dead.count + a.rage.count)),
    pages: [...pages.entries()].map(([path, p]) => ({
      path,
      dead: finish(p.dead),
      rage: finish(p.rage),
      error: finish(p.error),
    })),
    errors: [...errors.entries()].map(([message, e]): ErrorFriction => {
      const [top] = ranked(e.after, 1);
      const medianMs = top ? median(e.afterMs.get(top.label) ?? []) : undefined;
      return {
        message,
        tally: finish(e.tally),
        ...(e.digest ? { digest: e.digest } : {}),
        ...(e.frame ? { frame: e.frame } : {}),
        ...(e.afterSelector ? { afterSelector: e.afterSelector } : {}),
        ...topHandle(e.handles),
        ...(top
          ? { after: { ...top, ...(medianMs !== undefined ? { medianMs } : {}) } }
          : {}),
      };
    }),
    capped,
  };
}

/** A target's capture handle, as a rage click recorded it. */
export interface HandleRow {
  selector: string | null;
  component: string | null;
  handle: string;
  n: number;
}

/**
 * Give click targets the handle their rage clicks recorded, where their dead
 * clicks didn't already supply one. Rage rows are folded without their meta
 * (see getFriction), so their handles arrive separately; counts are untouched.
 */
export function withRageHandles(index: FrictionIndex, rows: HandleRow[]): FrictionIndex {
  if (!rows.length) return index;
  const byKey = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const handle = r.handle.replace(/\s+/g, " ").trim().slice(0, 200);
    if (!handle || r.n <= 0) continue;
    const key = r.component ? `component\u0000${r.component}` : `selector\u0000${r.selector ?? "(unknown)"}`;
    let counts = byKey.get(key);
    if (!counts) byKey.set(key, (counts = new Map()));
    counts.set(handle, (counts.get(handle) ?? 0) + r.n);
  }
  return {
    ...index,
    clicks: index.clicks.map((c) => {
      if (c.handle) return c;
      const [top] = ranked(byKey.get(`${c.by}\u0000${c.key}`) ?? new Map(), 1);
      return top ? { ...c, handle: top.label } : c;
    }),
  };
}
