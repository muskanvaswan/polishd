/**
 * Tests for the ingest route's session minting, against a real SQLite store.
 *
 * The route mints the session cookie on the first batch that arrives without
 * one, which is what makes a proxy optional — but only for a page's batch from
 * this site. Each run writes a throwaway database file; a configured Postgres
 * is never touched.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

for (const key of ["POLISHD_DATABASE_URL", "BUFFD_DATABASE_URL", "POLISH_DATABASE_URL", "POLISHD_SESSION_COOKIE"]) {
  delete process.env[key];
}
process.env.POLISHD_DB_PATH = join(mkdtempSync(join(tmpdir(), "polishd-route-")), "test.db");

const { NextRequest } = await import("next/server");
const { createPolishdRoute } = await import("./route.ts");
const { query } = await import("./server/store.ts");

const POST = createPolishdRoute();

/** What every current browser sends with a page's batch to its own site. */
const BROWSER = { "sec-fetch-site": "same-origin", origin: "http://localhost" };

function post(body: unknown, opts: { cookie?: string; headers?: Record<string, string> } = {}) {
  return POST(
    new NextRequest("http://localhost/api/polishd", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(opts.headers ?? BROWSER),
        ...(opts.cookie ? { cookie: opts.cookie } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}

const batch = (path: string, sid?: string) => ({
  events: [{ type: "page_view", ts: Date.now(), path }],
  ...(sid ? { sid } : {}),
});

/** The polishd_session cookie a response sets, or null. */
const mintedCookie = (res: Response) =>
  res.headers.getSetCookie().find((v) => v.startsWith("polishd_session=")) ?? null;

const sessionsFor = async (path: string) =>
  (await query(`SELECT DISTINCT session_id FROM polishd_events WHERE path = ?`, [path])).map(
    (r) => (r as { session_id: string }).session_id,
  );

test("a batch with no cookie is stored and gets one", async () => {
  const res = await post(batch("/first"));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, stored: 1 });

  const cookie = mintedCookie(res);
  assert.ok(cookie, "the response sets polishd_session");
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /SameSite=lax/i);

  const id = cookie.split(";")[0].split("=")[1];
  assert.deepEqual(await sessionsFor("/first"), [id]);
});

test("batches that leave one page before the cookie lands share a session", async () => {
  const sid = crypto.randomUUID();
  const [a, b] = await Promise.all([post(batch("/race", sid)), post(batch("/race", sid))]);
  assert.equal(mintedCookie(a)?.split(";")[0], `polishd_session=${sid}`);
  assert.equal(mintedCookie(b)?.split(";")[0], `polishd_session=${sid}`);
  assert.deepEqual(await sessionsFor("/race"), [sid]);
});

test("a cookie wins over the page's proposal, and none is set again", async () => {
  const res = await post(batch("/returning", crypto.randomUUID()), { cookie: "polishd_session=existing-visitor" });
  assert.equal(mintedCookie(res), null);
  assert.deepEqual(await sessionsFor("/returning"), ["existing-visitor"]);
});

test("a proposal that isn't a UUID is ignored", async () => {
  const res = await post(batch("/forged", "<script>"));
  const id = mintedCookie(res)?.split(";")[0].split("=")[1];
  assert.match(id ?? "", /^[0-9a-f-]{36}$/);
  assert.deepEqual(await sessionsFor("/forged"), [id]);
});

test("a body with no events gets no cookie", async () => {
  const res = await post({ nope: true });
  assert.equal((await res.json()).stored, 0);
  assert.equal(mintedCookie(res), null);
});

test("doctor's probe is minted a cookie and stores no event", async () => {
  const res = await post({ probe: true, events: [] });
  assert.equal((await res.json()).reason, "probe");
  assert.ok(mintedCookie(res));
});

test("a cookieless batch that opens no page is dropped, not minted", async () => {
  // Firefox's unload beacon while it quits: the page's page_view went out
  // earlier, with a cookie the browser no longer sends.
  const res = await post({ events: [{ type: "session_end", ts: Date.now(), path: "/quit" }], sid: crypto.randomUUID() });
  assert.deepEqual(await res.json(), { ok: true, stored: 0, reason: "no_session" });
  assert.equal(mintedCookie(res), null);
  assert.deepEqual(await sessionsFor("/quit"), []);
});

test("the same batch with its cookie is stored as usual", async () => {
  const res = await post(
    { events: [{ type: "session_end", ts: Date.now(), path: "/tail" }] },
    { cookie: "polishd_session=tail-visitor" },
  );
  assert.deepEqual(await res.json(), { ok: true, stored: 1 });
  assert.deepEqual(await sessionsFor("/tail"), ["tail-visitor"]);
});

test("only a request from this site is minted a session", async () => {
  const cases: Array<[string, Record<string, string>, boolean]> = [
    ["no browser headers (a bare script)", {}, false],
    ["another site", { "sec-fetch-site": "cross-site", origin: "https://evil.example" }, false],
    ["a sibling subdomain", { "sec-fetch-site": "same-site", origin: "http://app.localhost" }, false],
    ["an old Safari: Origin only", { origin: "http://localhost" }, true],
    ["Origin only, behind a proxy", { origin: "https://shop.example", "x-forwarded-host": "shop.example" }, true],
    ["Origin only, from elsewhere", { origin: "https://evil.example" }, false],
    ["Origin: null", { origin: "null" }, false],
  ];
  for (const [label, headers, minted] of cases) {
    const path = `/origin-${label.replace(/\W+/g, "-")}`;
    const res = await post(batch(path), { headers });
    assert.equal(mintedCookie(res) !== null, minted, label);
    assert.equal((await sessionsFor(path)).length, minted ? 1 : 0, label);
  }
});

test("a scripted request that brings its own cookie is still stored", async () => {
  const res = await post(batch("/scripted"), { cookie: "polishd_session=seeded", headers: {} });
  assert.deepEqual(await res.json(), { ok: true, stored: 1 });
});

test("a route switched off hands out no cookie", async () => {
  const off = createPolishdRoute({ enabled: false });
  const res = await off(
    new NextRequest("http://localhost/api/polishd", {
      method: "POST",
      headers: { "content-type": "application/json", ...BROWSER },
      body: JSON.stringify(batch("/disabled")),
    }),
  );
  assert.equal((await res.json()).stored, 0);
  assert.equal(mintedCookie(res), null);
});
