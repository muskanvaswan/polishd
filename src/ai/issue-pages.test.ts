/**
 * Tests for the issue-list paging rule.
 *
 * Run with `npm test`. The subject is deliberately pure — no network, no
 * settings — so these are plain assertions over plain objects.
 *
 * Both ways of getting this wrong are quiet, which is why it's tested at all:
 * stopping a page early drops issues off the tab with no error anywhere, and
 * never stopping turns one dashboard render into a walk of the whole repo.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ISSUE_PAGE_SIZE,
  MAX_ISSUE_PAGES,
  keepPaging,
  worthListing,
  type PagingState,
} from "./issue-pages.ts";

/** A full first page that found nothing, i.e. every reason to keep going. */
const GOING: PagingState = {
  pagesRead: 1,
  batchSize: ISSUE_PAGE_SIZE,
  lowestSeen: 900,
  oldestWanted: 100,
  outstanding: 2,
};

test("a full page that left issues unfound is worth following", () => {
  assert.equal(keepPaging(GOING), true);
});

test("everything found stops it, however much repo is left", () => {
  assert.equal(keepPaging({ ...GOING, outstanding: 0 }), false);
});

test("a short page is the last page", () => {
  assert.equal(keepPaging({ ...GOING, batchSize: ISSUE_PAGE_SIZE - 1 }), false);
  assert.equal(keepPaging({ ...GOING, batchSize: 0 }), false);
});

test("dropping past the oldest wanted number stops it — nothing older can match", () => {
  assert.equal(keepPaging({ ...GOING, lowestSeen: 99, oldestWanted: 100 }), false);
});

test("the page that lands exactly on the oldest wanted number is the last one needed", () => {
  assert.equal(keepPaging({ ...GOING, lowestSeen: 100, oldestWanted: 100 }), false);
});

test("one above the oldest wanted number is still worth a page", () => {
  assert.equal(keepPaging({ ...GOING, lowestSeen: 101, oldestWanted: 100 }), true);
});

test("the page budget is a hard stop, outstanding issues or not", () => {
  assert.equal(keepPaging({ ...GOING, pagesRead: MAX_ISSUE_PAGES - 1 }), true);
  assert.equal(keepPaging({ ...GOING, pagesRead: MAX_ISSUE_PAGES }), false);
  assert.equal(keepPaging({ ...GOING, pagesRead: MAX_ISSUE_PAGES + 1 }), false);
});

test("an empty page reads as both short and past the end", () => {
  assert.equal(
    keepPaging({ ...GOING, batchSize: 0, lowestSeen: Infinity }),
    false,
    "Infinity must not be mistaken for 'still above the oldest wanted'",
  );
});

test("listing earns its page only for more than one issue", () => {
  assert.equal(worthListing(0), false);
  assert.equal(worthListing(1), false);
  assert.equal(worthListing(2), true);
});
