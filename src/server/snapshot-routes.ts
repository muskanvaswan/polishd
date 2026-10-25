/**
 * Polishd — which of a site's pages a snapshot shoots.
 *
 * A site with a blog has a page per post — /posts/hello-world,
 * /posts/launch-week, … — all rendered by one template. Shooting every one
 * spends the capture's route cap and the screenshot service's rate limit on
 * pictures of the same layout, and crowds out the pages that look different.
 * So routes that read as instances of one dynamic route collapse to one: the
 * most visited of them.
 *
 * Only the URL is known here (the source tree isn't on a deployment), so
 * "looks like a slug" is read from the path:
 *
 *   - a record id, at any depth: a number, a @handle, a UUID or hex hash;
 *   - below the top level, a slug: words joined by hyphens or underscores,
 *     or a token with digits in it (`launch-week`, `iphone15`);
 *   - anything under a collection — /blog/<x>, /tags/<x>, /products/<x> —
 *     where even a one-word name (`/tags/react`) is one entry of many.
 *
 * The top level is never read as a slug: /privacy-policy and /how-it-works
 * are pages of their own. Dashboard-telemetry pages (/~polishd/<tab>) are
 * each a different tab, never collapsed.
 *
 * Pure, so the test file can pin what counts as a slug.
 */
import type { PageTraffic } from "./queries";

/** Path segments whose children are entries of a collection, whatever they're named. */
const COLLECTIONS = new Set([
  "articles",
  "author",
  "authors",
  "blog",
  "categories",
  "category",
  "events",
  "jobs",
  "news",
  "p",
  "posts",
  "product",
  "products",
  "projects",
  "stories",
  "tag",
  "tags",
  "topics",
  "u",
  "users",
]);

/** Stands in for a segment that names one record of many. */
const ANY = "*";

/** A segment that names a record wherever it appears. */
function isRecordId(seg: string): boolean {
  return (
    /^\d+$/.test(seg) ||
    /^@[^@]+$/.test(seg) ||
    (/^[0-9a-f-]{16,}$/i.test(seg) && /\d/.test(seg))
  );
}

/** A segment that reads as a slug rather than a page's name. */
function isSlug(seg: string): boolean {
  return (
    /^[a-z0-9]+(?:[-_][a-z0-9]+)+$/i.test(seg) ||
    (seg.length >= 6 && /\d/.test(seg) && /[a-z]/i.test(seg))
  );
}

function segments(route: string): string[] {
  return route
    .split(/[?#]/)[0]
    .split("/")
    .filter(Boolean)
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });
}

/**
 * The dynamic route `route` reads as an instance of, with each slug-like
 * segment as `*`: `/posts/hello-world` → `/posts/*`, and `/users/42/settings`
 * shares a shape with `/users/7/settings`. A route with nothing slug-like is
 * its own shape.
 */
export function routeShape(route: string): string {
  if (route.startsWith("/~")) return route;
  const segs = segments(route);
  const shape = segs.map((seg, i) => {
    if (isRecordId(seg)) return ANY;
    if (i === 0) return seg;
    return COLLECTIONS.has(segs[i - 1].toLowerCase()) || isSlug(seg) ? ANY : seg;
  });
  return `/${shape.join("/")}`;
}

/**
 * `routes` with every group of the same shape cut to one: the most visited —
 * distinct sessions, then page views, the way the Top pages table ranks —
 * with the given order breaking ties. Each kept route stays where it was.
 */
export function collapseSlugRoutes(
  routes: string[],
  traffic: ReadonlyMap<string, PageTraffic>,
): string[] {
  const visits = (route: string): PageTraffic => traffic.get(route) ?? { sessions: 0, pageViews: 0 };
  const busier = (a: string, b: string) =>
    visits(a).sessions - visits(b).sessions || visits(a).pageViews - visits(b).pageViews;
  const unique = [...new Set(routes)];
  const kept = new Map<string, string>();
  for (const route of unique) {
    const shape = routeShape(route);
    const current = kept.get(shape);
    if (current === undefined || busier(route, current) > 0) kept.set(shape, route);
  }
  const keep = new Set(kept.values());
  return unique.filter((r) => keep.has(r));
}
