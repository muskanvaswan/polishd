/**
 * Polishd — when to stop paging the repo's issue list.
 *
 * Looking up a known set of issue numbers has two ways to spend API calls: one
 * request per number, or requests for pages of the repo's issue list — a
 * hundred whole issues each — until the numbers turn up. The second is far
 * cheaper right up until it isn't, which is what this rule decides.
 *
 * It leans on one fact about GitHub: issue numbers only ever climb, and the
 * list comes back newest-first. So a page whose lowest number has already
 * dropped below the oldest number we're looking for is proof that no later
 * page can hold anything we want — every one of them is older still.
 *
 * Pure, no network, no settings — the caller in github.ts does the fetching.
 * Kept separate so the arithmetic can be tested, because both ways of getting
 * it wrong are quiet: stop one page early and issues silently vanish from the
 * tab, never stop and a dashboard render walks the whole repo.
 */

/** GitHub's maximum page size for the repo issue list. */
export const ISSUE_PAGE_SIZE = 100;

/**
 * How many pages one lookup will scan before it gives up and reads whatever
 * is still missing one issue at a time. Three covers the 300 most recent
 * issues, which is well past where paging stops being the cheaper way to find
 * a handful of old ones.
 */
export const MAX_ISSUE_PAGES = 3;

export interface PagingState {
  /** How many pages have been read so far, this one included. */
  pagesRead: number;
  /** How many issues the page just read came back with. */
  batchSize: number;
  /** The lowest issue number on that page; Infinity when it was empty. */
  lowestSeen: number;
  /** The oldest (lowest) number still being looked for. */
  oldestWanted: number;
  /** How many wanted numbers are still unaccounted for. */
  outstanding: number;
}

/**
 * Whether another page of the issue list is worth requesting.
 *
 * Stops on any of: everything found, a short page (there is no next page),
 * having paged past the oldest number wanted, or the page budget.
 */
export function keepPaging(state: PagingState): boolean {
  if (state.outstanding === 0) return false;
  if (state.batchSize < ISSUE_PAGE_SIZE) return false;
  if (state.lowestSeen <= state.oldestWanted) return false;
  return state.pagesRead < MAX_ISSUE_PAGES;
}

/**
 * Whether to list at all. One number is never worth a hundred-issue page —
 * fetching it directly is a single call either way, and a smaller one.
 */
export function worthListing(wanted: number): boolean {
  return wanted > 1;
}
