import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isVercelProtectionResponse,
  landingOf,
  pinRoute,
  previewClip,
  requestAction,
} from "./core.ts";

const ORIGIN = "https://example.com";
const VIEWPORT = { width: 1440, height: 900 };

// ── Origin pinning ───────────────────────────────────────────────────────────

test("a path resolves on the origin", () => {
  assert.equal(pinRoute(ORIGIN, "/"), "https://example.com/");
  assert.equal(pinRoute(ORIGIN, "/pricing"), "https://example.com/pricing");
  assert.equal(pinRoute(ORIGIN, "/a/b?x=1#frag"), "https://example.com/a/b?x=1");
});

test("a route can never name another host", () => {
  for (const route of [
    "//evil.example/",
    "//evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "https://evil.example/",
    "http://example.com/", // same host, but not a path
    "javascript:alert(1)",
    "evil.example",
    "",
  ]) {
    assert.equal(pinRoute(ORIGIN, route), null, route);
  }
});

test("path tricks stay on the origin", () => {
  // Each of these parses as a path on example.com, so it's allowed — and the
  // resolved URL proves it.
  for (const route of ["/@evil.example", "/%2F%2Fevil.example", "/..//evil.example", "/./x"]) {
    const url = pinRoute(ORIGIN, route);
    assert.ok(url, route);
    assert.equal(new URL(url).origin, ORIGIN, route);
  }
});

test("an origin that isn't one is refused", () => {
  assert.equal(pinRoute("https://example.com/path", "/"), null);
  assert.equal(pinRoute("not a url", "/"), null);
  assert.equal(pinRoute("https://user:pw@example.com", "/"), null);
});

test("landing on the origin reports the path", () => {
  assert.deepEqual(landingOf(ORIGIN, "https://example.com/login?next=/"), {
    kind: "origin",
    path: "/login",
  });
});

test("landing anywhere else is refused and named", () => {
  assert.deepEqual(landingOf(ORIGIN, "https://www.example.com/"), {
    kind: "elsewhere",
    host: "www.example.com",
    vercelLogin: false,
  });
  // A scheme change is a different origin too.
  assert.equal(landingOf(ORIGIN, "http://example.com/").kind, "elsewhere");
  assert.equal(landingOf(ORIGIN, "https://example.com:8443/").kind, "elsewhere");
  assert.equal(landingOf(ORIGIN, "chrome-error://chromewebdata/").kind, "elsewhere");
});

test("Vercel's deployment-protection login is recognised", () => {
  for (const url of [
    "https://vercel.com/login?next=%2Fsso-api",
    "https://vercel.com/sso-api?url=https%3A%2F%2Fexample.com",
  ]) {
    const landing = landingOf(ORIGIN, url);
    assert.equal(landing.kind, "elsewhere");
    assert.equal(landing.kind === "elsewhere" && landing.vercelLogin, true, url);
  }
  const marketing = landingOf(ORIGIN, "https://vercel.com/pricing");
  assert.equal(marketing.kind === "elsewhere" && marketing.vercelLogin, false);
  assert.equal(isVercelProtectionResponse(401, { server: "Vercel" }), true);
  assert.equal(isVercelProtectionResponse(401, { "x-vercel-id": "iad1::abc" }), true);
  assert.equal(isVercelProtectionResponse(401, { server: "nginx" }), false);
  assert.equal(isVercelProtectionResponse(200, { server: "Vercel" }), false);
});

test("the request guard keeps top-level navigation on the origin", () => {
  const nav = (url: string, mainFrame = true) =>
    requestAction(ORIGIN, { url, method: "GET", navigation: true, mainFrame, postData: null });
  assert.equal(nav("https://example.com/next"), "continue");
  // Answered 204, so the browser stays on the page it was shooting.
  assert.equal(nav("https://evil.example/"), "stay");
  assert.equal(nav("http://example.com/"), "stay");
  // Third-party frames and subresources render as they normally would.
  assert.equal(nav("https://www.youtube.com/embed/x", false), "continue");
  assert.equal(
    requestAction(ORIGIN, {
      url: "https://cdn.example.net/app.js",
      method: "GET",
      navigation: false,
      mainFrame: true,
      postData: null,
    }),
    "continue",
  );
});

test("polishd's own beacons are answered locally", () => {
  const post = (url: string, postData: string) =>
    requestAction(ORIGIN, { url, method: "POST", navigation: false, mainFrame: true, postData });
  assert.equal(post("https://example.com/api/polishd", '{"events":[]}'), "beacon");
  assert.equal(post("https://example.com/api/other", '{"q":1}'), "continue");
  assert.equal(post("https://collector.example/api/polishd", '{"events":[]}'), "continue");
});

test("dashboard telemetry from a captured dashboard is answered locally, wherever it's sent", () => {
  const post = (url: string, postData: string) =>
    requestAction(ORIGIN, { url, method: "POST", navigation: false, mainFrame: true, postData });
  const batch = '{"sessionId":"s-123","events":[{"type":"page_view"}]}';
  assert.equal(post("https://polishd.example/api/polishd-telemetry", batch), "beacon");
  assert.equal(post("https://example.com/api/polishd-telemetry", batch), "beacon");
  assert.equal(post("https://other.example/api", '{"sessionId":"s","cart":[]}'), "continue");
});

// ── Framing ──────────────────────────────────────────────────────────────────

test("a small element gets a component's worth of context at 16:10", () => {
  const clip = previewClip({ x: 700, y: 440, width: 40, height: 20 }, VIEWPORT);
  assert.deepEqual(clip, { x: 540, y: 338, width: 360, height: 225 });
});

test("a wide element grows the crop vertically to keep the shape", () => {
  const clip = previewClip({ x: 220, y: 400, width: 1000, height: 40 }, VIEWPORT);
  assert.ok(clip);
  assert.equal(clip.width, 1080);
  assert.equal(clip.height, 675);
});

test("the crop never leaves the viewport", () => {
  const nearCorner = previewClip({ x: 4, y: 4, width: 30, height: 12 }, VIEWPORT);
  assert.deepEqual(nearCorner, { x: 0, y: 0, width: 360, height: 225 });
  const farCorner = previewClip({ x: 1420, y: 880, width: 30, height: 30 }, VIEWPORT);
  assert.deepEqual(farCorner, { x: 1080, y: 675, width: 360, height: 225 });
});

test("an element bigger than the screen is framed by the screen", () => {
  const clip = previewClip({ x: -100, y: -2000, width: 1640, height: 6000 }, VIEWPORT);
  assert.deepEqual(clip, { x: 0, y: 0, width: 1440, height: 900 });
});

test("a phone viewport narrower than the minimum still fits", () => {
  const clip = previewClip({ x: 100, y: 300, width: 40, height: 20 }, { width: 340, height: 700 });
  assert.ok(clip);
  assert.equal(clip.width, 340);
  assert.equal(clip.x, 0);
});

test("an element entirely off screen has no honest crop", () => {
  assert.equal(previewClip({ x: 1500, y: 100, width: 300, height: 600 }, VIEWPORT), null);
  assert.equal(previewClip({ x: 100, y: 100, width: 0, height: 20 }, VIEWPORT), null);
});
