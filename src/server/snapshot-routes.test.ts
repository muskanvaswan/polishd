/**
 * Tests for which of a site's pages a snapshot shoots.
 *
 * Run with `npm test`. The cases to hold: a dynamic route's pages collapse to
 * the most visited one; pages with names of their own — top-level ones above
 * all — never collapse; and what's kept stays in the order it was given.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { collapseSlugRoutes, routeShape } from "./snapshot-routes.ts";

const traffic = (entries: [string, number, number][]) =>
  new Map(entries.map(([route, sessions, pageViews]) => [route, { sessions, pageViews }]));

test("slugs, ids and handles read as one dynamic route", () => {
  assert.equal(routeShape("/posts/hello-world"), "/posts/*");
  assert.equal(routeShape("/docs/getting_started"), "/docs/*");
  assert.equal(routeShape("/shop/iphone15"), "/shop/*");
  assert.equal(routeShape("/orders/1042"), "/orders/*");
  assert.equal(routeShape("/1042"), "/*");
  assert.equal(routeShape("/@muskan"), "/*");
  assert.equal(routeShape("/files/550e8400-e29b-41d4-a716-446655440000"), "/files/*");
  assert.equal(routeShape("/users/42/settings"), routeShape("/users/7/settings"));
});

test("anything under a collection is one of its entries, one-word names included", () => {
  assert.equal(routeShape("/tags/react"), "/tags/*");
  assert.equal(routeShape("/blog/launch"), "/blog/*");
  assert.equal(routeShape("/products/shirt/reviews"), "/products/*/reviews");
  assert.equal(routeShape("/blog"), "/blog");
});

test("pages with names of their own keep them", () => {
  for (const route of ["/", "/pricing", "/privacy-policy", "/how-it-works", "/settings/profile", "/docs/v2", "/~polishd/brand-kit"]) {
    assert.equal(routeShape(route), route, route);
  }
});

test("a dynamic route's pages collapse to the most visited", () => {
  const routes = ["/posts/first-post", "/", "/posts/launch-week", "/pricing", "/posts/q3-update"];
  const seen = traffic([
    ["/posts/first-post", 3, 9],
    ["/posts/launch-week", 12, 20],
    ["/posts/q3-update", 12, 4],
  ]);
  assert.deepEqual(collapseSlugRoutes(routes, seen), ["/", "/posts/launch-week", "/pricing"]);
});

test("ties, and pages nobody has visited, keep the first in the given order", () => {
  const routes = ["/blog/b-post", "/blog/a-post", "/about"];
  assert.deepEqual(collapseSlugRoutes(routes, new Map()), ["/blog/b-post", "/about"]);
  assert.deepEqual(collapseSlugRoutes(["/", "/", "/about"], new Map()), ["/", "/about"]);
});
