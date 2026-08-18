/**
 * Polishd — capture health (shared: no server, no React).
 *
 * Two things live here, and they are the same subject seen from both ends:
 * the on-disk shape ingest writes when it drops a cookie-less batch, and the
 * rule the dashboard applies to decide whether that means "your proxy isn't
 * running" or "some bots posted to a public endpoint".
 *
 * They are together, and pure, because the rule is the part that has been
 * wrong: it compared an all-time drop total against an all-time event total
 * gated on a one-hour recency check, so a single fresh drop re-armed every
 * drop the site had ever recorded. Anything that can be tested without a
 * database or a renderer belongs in one file that a test can import.
 */

/** Granularity drops are bucketed at. One hour. */
export const NO_SESSION_BUCKET_MS = 3_600_000;

/** How far back *both* sides of the comparison look. */
export const CAPTURE_WINDOW_MS = 24 * NO_SESSION_BUCKET_MS;

/** Buckets retained: the window plus slack, so the oldest ages out cleanly. */
const MAX_BUCKETS = 26;

/**
 * Drops in the window before a *neutral* note is worth showing. Below this,
 * cookie-less batches are ordinary background on a public endpoint and saying
 * so is clutter.
 */
const MIN_NOTICE_DROPS = 3;

/**
 * Drops in the window before "nothing stored in the window" is allowed to
 * read as a broken proxy. A real proxy failure drops *every* batch, so on any
 * site with traffic the count climbs fast; the floor is what keeps a dormant
 * site poked twice by a crawler from accusing a working install.
 */
const MIN_BROKEN_DROPS = 5;

/** One hour's worth of drops. */
export interface NoSessionBucket {
  /** Hour index — `Math.floor(ms / NO_SESSION_BUCKET_MS)`. */
  h: number;
  /** Drops recorded in that hour. */
  n: number;
}

/** What ingest stores under its `polishd_meta` key. */
export interface NoSessionRecord {
  /** All-time drops. Never decays — a lifetime total, not an alert input. */
  count: number;
  /** Most recent drop (ms epoch). */
  lastAt: number;
  /** Per-hour drops, oldest first, trimmed to {@link MAX_BUCKETS}. */
  buckets: NoSessionBucket[];
}

/**
 * Read a stored record, tolerating both junk and the pre-0.2.3 `{count,
 * lastAt}` shape. A legacy record parses with no buckets, which is the honest
 * answer: those drops happened, but nothing recorded *when*, so none of them
 * can count toward a window. That is the whole point — history stops voting.
 */
export function parseNoSessionRecord(raw: string | null | undefined): NoSessionRecord | null {
  if (!raw) return null;
  try {
    const rec = JSON.parse(raw) as Partial<NoSessionRecord>;
    if (!rec || typeof rec !== "object") return null;
    const count = numOr(rec.count, 0);
    const lastAt = numOr(rec.lastAt, 0);
    const buckets = Array.isArray(rec.buckets)
      ? rec.buckets
          .filter((b): b is NoSessionBucket => !!b && Number.isFinite(b.h) && Number.isFinite(b.n))
          .map((b) => ({ h: Math.floor(b.h), n: Math.max(0, Math.floor(b.n)) }))
      : [];
    return { count, lastAt, buckets };
  } catch {
    return null;
  }
}

/** Add `batch` drops observed at `now` to `prev` (null for a first drop). */
export function foldNoSessionDrop(
  prev: NoSessionRecord | null,
  now: number,
  batch: number,
): NoSessionRecord {
  const h = Math.floor(now / NO_SESSION_BUCKET_MS);
  const buckets = (prev?.buckets ?? []).filter((b) => b.h > h - MAX_BUCKETS);
  const current = buckets.find((b) => b.h === h);
  if (current) current.n += batch;
  else buckets.push({ h, n: batch });
  buckets.sort((a, b) => a.h - b.h);
  return {
    count: (prev?.count ?? 0) + batch,
    lastAt: Math.max(now, prev?.lastAt ?? 0),
    buckets: buckets.slice(-MAX_BUCKETS),
  };
}

/**
 * Drops recorded at or after `since`.
 *
 * Hour-granular, so the bucket straddling `since` contributes in full and the
 * count leans high by up to an hour of drops. That bias is the safe direction
 * for a diagnostic and it costs nothing to store.
 */
export function noSessionCountSince(rec: NoSessionRecord | null, since: number): number {
  if (!rec) return 0;
  const first = Math.floor(since / NO_SESSION_BUCKET_MS);
  return rec.buckets.reduce((sum, b) => (b.h >= first ? sum + b.n : sum), 0);
}

/** Whether capture itself is wired up, as opposed to what it captured. */
export interface CaptureHealth {
  /** All-time beacons dropped for want of a session cookie. */
  noSessionCount: number;
  /** Of those, the ones inside {@link windowMs}. */
  recentNoSessionCount: number;
  /** When the most recent drop happened (ms epoch), or null for none. */
  lastNoSessionAt: number | null;
  /** When an event was last *stored*, by the server's clock, or null. */
  lastStoredAt: number | null;
  /** Events stored inside the window. */
  recentEvents: number;
  /** Batches stored inside the window (distinct arrival stamps — approximate). */
  recentBatches: number;
  /** The window both recent counts were measured over. */
  windowMs: number;
}

export type CaptureStatusLevel = "ok" | "notice" | "broken";

export interface CaptureStatus {
  /**
   * `broken` — nothing is being stored, say so in red.
   * `notice`  — real capture plus some cookie-less batches; neutral and true.
   * `ok`      — nothing worth a word.
   */
  level: CaptureStatusLevel;
  /** Drops this status is talking about: the window's, or all-time when empty. */
  droppedBatches: number;
  /** Batches stored alongside them, over the same window. */
  storedBatches: number;
  /** Dropped share of all batches seen in the window, or null if unknowable. */
  sharePct: number | null;
  /** A store landed *after* the last drop — proof the proxy is minting now. */
  storedSinceDrop: boolean;
  /** Nothing has ever been stored. Gates the "nothing is being stored" copy. */
  nothingStored: boolean;
}

/**
 * Decide what, if anything, the dashboard should say about cookie-less
 * batches.
 *
 * The load-bearing signal is `storedSinceDrop`. Every event is attributed to
 * the cookie the proxy mints, so a proxy that isn't running drops *every*
 * batch — one successful store after the most recent drop is proof it is
 * running, and no threshold can argue with it. Everything else here only
 * decides how loudly to describe traffic that is already known to be flowing.
 */
export function captureStatus(
  health: CaptureHealth,
  totalEvents: number,
  now: number = Date.now(),
): CaptureStatus {
  const storedSinceDrop =
    health.lastStoredAt !== null &&
    health.lastNoSessionAt !== null &&
    health.lastStoredAt > health.lastNoSessionAt;
  const nothingStored = totalEvents === 0;
  const dropsInWindow =
    health.lastNoSessionAt !== null &&
    health.lastNoSessionAt >= now - health.windowMs &&
    health.recentNoSessionCount > 0;

  const droppedBatches = dropsInWindow ? health.recentNoSessionCount : health.noSessionCount;
  const storedBatches = health.recentBatches;
  const totalBatches = droppedBatches + storedBatches;
  const sharePct = totalBatches > 0 ? (droppedBatches * 100) / totalBatches : null;
  const base = { droppedBatches, storedBatches, sharePct, storedSinceDrop, nothingStored };

  // Never stored anything, and beacons are arriving: the drop *is* the whole
  // story, whenever it happened. This is the case the banner was written for.
  if (health.lastNoSessionAt !== null && nothingStored) return { ...base, level: "broken" };

  // Storing has happened at some point, so judge only the window: drops in it,
  // nothing stored in it, and no store since the last drop. Enough drops to
  // rule out a dormant site being poked by a crawler.
  if (
    dropsInWindow &&
    !storedSinceDrop &&
    health.recentEvents === 0 &&
    health.recentNoSessionCount >= MIN_BROKEN_DROPS
  ) {
    return { ...base, level: "broken" };
  }

  if (dropsInWindow && health.recentNoSessionCount >= MIN_NOTICE_DROPS) {
    return { ...base, level: "notice" };
  }
  return { ...base, level: "ok" };
}

function numOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
