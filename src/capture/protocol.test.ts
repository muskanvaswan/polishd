import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_FIND_PER_REQUEST,
  SNAPSHOT_SERVICE_URL,
  chooseSnapshotEngine,
  MAX_ROUTES_PER_REQUEST,
  isRoutePath,
  looksPublicOrigin,
  parseShootRequest,
  shotWireBytes,
} from "./protocol.ts";

test("the single-route shape the dashboard sends", () => {
  assert.deepEqual(parseShootRequest({ route: "/pricing", device: "phone", theme: "dark" }), {
    ok: true,
    value: { routes: ["/pricing"], devices: ["phone"], themes: ["dark"], find: [] },
  });
});

test("a route list, with devices and themes defaulting to all of them", () => {
  const r = parseShootRequest({ routes: ["/", "/about", "/"] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.ok && r.value, {
    routes: ["/", "/about"],
    devices: ["phone", "desktop"],
    themes: ["light", "dark"],
    find: [],
  });
});

test("route lists are capped", () => {
  const routes = Array.from({ length: MAX_ROUTES_PER_REQUEST + 1 }, (_, i) => `/p${i}`);
  assert.equal(parseShootRequest({ routes }).ok, false);
  assert.equal(parseShootRequest({ routes: [] }).ok, false);
});

test("routes must be paths on the site", () => {
  for (const route of ["//evil.example", "https://evil.example", "/\\evil", "pricing", "/a b", "/x\n", "", 42]) {
    assert.equal(isRoutePath(route), false, String(route));
    assert.equal(parseShootRequest({ route }).ok, false, String(route));
  }
  assert.equal(isRoutePath("/a/b?c=d#e"), true);
  assert.equal(isRoutePath(`/${"a".repeat(3000)}`), false);
});

test("unknown devices and themes are refused", () => {
  assert.equal(parseShootRequest({ route: "/", device: "tablet" }).ok, false);
  assert.equal(parseShootRequest({ route: "/", themes: ["sepia"] }).ok, false);
  assert.equal(parseShootRequest({ route: "/", devices: [] }).ok, false);
});

test("values to find are rebuilt field by field", () => {
  const r = parseShootRequest({
    route: "/",
    find: [
      { key: "font:Inter|17|500", ref: { kind: "font", family: "Inter", sizePx: 17, weight: 500, extra: "x" } },
      { key: "color:#FAFAFA", ref: { kind: "color", hex: "#FAFAFA", roles: ["background"] } },
      { key: "radius:7px", ref: { kind: "radius", value: "7px" } },
      { key: "spacing:6", ref: { kind: "spacing", px: 6 } },
    ],
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.ok && r.value.find.map((t) => t.ref), [
    { kind: "font", family: "Inter", sizePx: 17, weight: 500 },
    { kind: "color", hex: "#fafafa", roles: ["background"] },
    { kind: "radius", value: "7px" },
    { kind: "spacing", px: 6 },
  ]);
});

test("malformed values to find are refused", () => {
  for (const ref of [
    { kind: "font", family: "", sizePx: 17, weight: 500 },
    { kind: "font", family: "x".repeat(61), sizePx: 17, weight: 500 },
    { kind: "color", hex: "red", roles: [] },
    { kind: "color", hex: "#fff", roles: ["text"] },
    { kind: "color", hex: "#ffffff", roles: ["shadow"] },
    { kind: "radius", value: "calc(1px)" },
    { kind: "spacing", px: 1.5 },
    { kind: "script", src: "alert(1)" },
  ]) {
    assert.equal(parseShootRequest({ route: "/", find: [{ key: "k", ref }] }).ok, false, JSON.stringify(ref));
  }
  const many = Array.from({ length: MAX_FIND_PER_REQUEST + 1 }, (_, i) => ({
    key: `spacing:${i + 1}`,
    ref: { kind: "spacing", px: i + 1 },
  }));
  assert.equal(parseShootRequest({ route: "/", find: many }).ok, false);
});

test("non-object bodies are refused", () => {
  for (const body of [null, "x", [], 3]) assert.equal(parseShootRequest(body).ok, false);
});

test("the wire size counts the images", () => {
  const small = shotWireBytes({ route: "/", device: "phone", theme: "light", previews: [], looked: [] });
  const big = shotWireBytes({
    route: "/",
    device: "phone",
    theme: "light",
    image: { type: "image/webp", width: 1, height: 1, data: "x".repeat(10_000) },
    previews: [{ key: "k", image: { type: "image/webp", width: 1, height: 1, data: "y".repeat(5_000) } }],
    looked: ["k"],
  });
  assert.ok(big - small >= 15_000);
});

test("origins the service could reach, and ones it never could", () => {
  for (const o of ["https://example.com", "http://example.com", "https://my-app.vercel.app", "https://8.8.8.8", "https://[2606:4700::1111]"]) {
    assert.equal(looksPublicOrigin(o), true, o);
  }
  for (const o of [
    "http://localhost:3000",
    "http://app.localhost:3000",
    "http://127.0.0.1:3000",
    "http://[::1]:3000",
    "http://10.1.2.3",
    "http://172.20.0.5",
    "http://192.168.1.10:3000",
    "http://169.254.169.254",
    "http://100.100.100.200",
    "http://devbox",
    "http://printer.local",
    "http://wiki.corp",
    "http://[fe80::1]",
    "http://[fd00::1]",
    "file:///tmp",
    "nonsense",
  ]) {
    assert.equal(looksPublicOrigin(o), false, o);
  }
});

test("public sites use the hosted service; the rest shoot locally", () => {
  assert.deepEqual(chooseSnapshotEngine("https://example.com"), { kind: "service", url: SNAPSHOT_SERVICE_URL });
  assert.deepEqual(chooseSnapshotEngine("http://localhost:3000"), { kind: "local", reason: "not_public" });
});

test("POLISHD_SNAPSHOT_SERVICE points elsewhere, or turns the service off", () => {
  assert.deepEqual(chooseSnapshotEngine("http://localhost:3000", "http://localhost:4100/api/v1/"), {
    kind: "service",
    url: "http://localhost:4100/api/v1",
  });
  assert.deepEqual(chooseSnapshotEngine("https://example.com", "off"), { kind: "local", reason: "configured" });
  // Garbage is ignored rather than trusted.
  assert.deepEqual(chooseSnapshotEngine("https://example.com", "javascript:alert(1)"), {
    kind: "service",
    url: SNAPSHOT_SERVICE_URL,
  });
});
