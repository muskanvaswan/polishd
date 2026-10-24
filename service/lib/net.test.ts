import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isBlockedAddress,
  isLoopbackAddress,
  isPublicHostname,
  resolvePublic,
  type LookupAll,
} from "./net.ts";
import { clientIp, parseOriginHeader } from "./origin.ts";

// ── Addresses ────────────────────────────────────────────────────────────────

test("private, loopback, link-local and metadata IPv4 addresses are blocked", () => {
  for (const ip of [
    "0.0.0.0",
    "10.0.0.1",
    "10.255.255.255",
    "100.64.0.1",
    "100.100.100.200", // Alibaba metadata
    "127.0.0.1",
    "127.1.2.3",
    "169.254.169.254", // AWS / GCP / Azure / Oracle metadata
    "169.254.170.2", // ECS task metadata
    "172.16.0.1",
    "172.31.255.255",
    "192.0.0.1",
    "192.0.2.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "239.255.255.250",
    "240.0.0.1",
    "255.255.255.255",
    "168.63.129.16", // Azure wireserver
  ]) {
    assert.equal(isBlockedAddress(ip), true, ip);
  }
});

test("public IPv4 addresses are allowed", () => {
  for (const ip of ["1.1.1.1", "8.8.8.8", "76.76.21.21", "172.15.255.255", "172.32.0.1", "100.63.255.255", "100.128.0.1"]) {
    assert.equal(isBlockedAddress(ip), false, ip);
  }
});

test("IPv6 outside global unicast, and its special blocks, are blocked", () => {
  for (const ip of [
    "::",
    "::1",
    "fc00::1",
    "fd00:ec2::254", // AWS IPv6 metadata
    "fe80::1",
    "fe80::1%eth0",
    "fec0::1",
    "ff02::1",
    "64:ff9b::7f00:1", // NAT64 of 127.0.0.1
    "100::1",
    "2001:db8::1",
    "2001::1", // Teredo
    "2002:7f00:1::1", // 6to4 of 127.0.0.1
    "3fff::1",
  ]) {
    assert.equal(isBlockedAddress(ip), true, ip);
  }
});

test("IPv4 dressed as IPv6 is judged by the IPv4 inside", () => {
  assert.equal(isBlockedAddress("::ffff:127.0.0.1"), true);
  assert.equal(isBlockedAddress("::ffff:7f00:1"), true);
  assert.equal(isBlockedAddress("::ffff:169.254.169.254"), true);
  assert.equal(isBlockedAddress("::ffff:a9fe:a9fe"), true);
  assert.equal(isBlockedAddress("::127.0.0.1"), true);
  assert.equal(isBlockedAddress("::ffff:8.8.8.8"), false);
});

test("public IPv6 addresses are allowed", () => {
  for (const ip of ["2606:4700:4700::1111", "2001:4860:4860::8888", "[2a00:1450:4001:81b::200e]"]) {
    assert.equal(isBlockedAddress(ip), false, ip);
  }
});

test("anything that isn't an IP address is blocked", () => {
  for (const s of ["", "localhost", "example.com", "1.2.3", "999.1.1.1", "::g"]) {
    assert.equal(isBlockedAddress(s), true, s);
  }
});

// ── Hostnames ────────────────────────────────────────────────────────────────

test("hostnames that only name private networks are refused before DNS", () => {
  for (const host of [
    "localhost",
    "LOCALHOST.",
    "app.localhost",
    "printer.local",
    "metadata.google.internal",
    "intranet",
    "db.corp",
    "nas.home.arpa",
    "127.0.0.1",
    "[::1]",
    "169.254.169.254",
    "",
    "exa mple.com",
  ]) {
    assert.equal(isPublicHostname(host), false, host);
  }
  for (const host of ["example.com", "www.example.co.uk", "my-app.vercel.app", "8.8.8.8", "Example.COM."]) {
    assert.equal(isPublicHostname(host), true, host);
  }
});

// ── Resolution ───────────────────────────────────────────────────────────────

function fakeDns(table: Record<string, string[]>): LookupAll {
  return async (host) => {
    const answers = table[host];
    if (!answers) throw Object.assign(new Error(`ENOTFOUND ${host}`), { code: "ENOTFOUND" });
    return answers.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  };
}

const dns = fakeDns({
  "example.com": ["93.184.215.14", "2606:2800:21f:cb07:6820:80da:af6b:8b2c"],
  "rebind.example": ["93.184.215.14", "127.0.0.1"],
  "metadata.example": ["169.254.169.254"],
  "mapped.example": ["::ffff:10.0.0.5"],
  "empty.example": [],
});

test("a name resolving only to public addresses is accepted", async () => {
  const r = await resolvePublic("example.com", { lookup: dns });
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.addresses.length, 2);
});

test("one private answer among public ones is a refusal (DNS rebinding)", async () => {
  assert.deepEqual(await resolvePublic("rebind.example", { lookup: dns }), {
    ok: false,
    reason: "not_public",
  });
});

test("names pointing at metadata or mapped private addresses are refused", async () => {
  assert.equal((await resolvePublic("metadata.example", { lookup: dns })).ok, false);
  assert.equal((await resolvePublic("mapped.example", { lookup: dns })).ok, false);
});

test("names that don't resolve are reported as such", async () => {
  assert.deepEqual(await resolvePublic("nope.example", { lookup: dns }), {
    ok: false,
    reason: "unresolvable",
  });
  assert.deepEqual(await resolvePublic("empty.example", { lookup: dns }), {
    ok: false,
    reason: "unresolvable",
  });
});

test("IP literals skip DNS and are judged directly", async () => {
  const never: LookupAll = async () => {
    throw new Error("DNS must not be asked about a literal");
  };
  assert.equal((await resolvePublic("127.0.0.1", { lookup: never })).ok, false);
  assert.equal((await resolvePublic("[::1]", { lookup: never })).ok, false);
  assert.equal((await resolvePublic("8.8.8.8", { lookup: never })).ok, true);
});

test("private names are refused without asking DNS", async () => {
  let asked = false;
  const spy: LookupAll = async () => {
    asked = true;
    return [{ address: "93.184.215.14", family: 4 }];
  };
  assert.equal((await resolvePublic("localhost", { lookup: spy })).ok, false);
  assert.equal((await resolvePublic("metadata.google.internal", { lookup: spy })).ok, false);
  assert.equal(asked, false);
});

test("allowLoopback (local development) lets loopback through and nothing else", async () => {
  const local = fakeDns({ localhost: ["127.0.0.1"], "lan.example": ["192.168.1.5"] });
  assert.equal((await resolvePublic("localhost", { lookup: local, allowLoopback: true })).ok, true);
  assert.equal((await resolvePublic("127.0.0.1", { allowLoopback: true })).ok, true);
  assert.equal((await resolvePublic("[::1]", { allowLoopback: true })).ok, true);
  assert.equal((await resolvePublic("169.254.169.254", { allowLoopback: true })).ok, false);
  assert.equal((await resolvePublic("10.0.0.1", { allowLoopback: true })).ok, false);
  assert.equal((await resolvePublic("lan.example", { lookup: local, allowLoopback: true })).ok, false);
  assert.equal((await resolvePublic("metadata.google.internal", { allowLoopback: true })).ok, false);
});

test("loopback is recognised in every spelling", () => {
  for (const ip of ["127.0.0.1", "127.9.9.9", "::1", "[::1]", "0:0:0:0:0:0:0:1", "::ffff:127.0.0.1"]) {
    assert.equal(isLoopbackAddress(ip), true, ip);
  }
  for (const ip of ["10.0.0.1", "::", "8.8.8.8", "fe80::1"]) assert.equal(isLoopbackAddress(ip), false, ip);
});

// ── The Origin header ────────────────────────────────────────────────────────

test("a public https origin is accepted as-is", () => {
  assert.deepEqual(parseOriginHeader("https://example.com"), {
    ok: true,
    origin: "https://example.com",
    hostname: "example.com",
  });
  assert.equal(parseOriginHeader("http://example.com").ok, true);
});

test("a missing or opaque Origin is refused", () => {
  for (const value of [null, undefined, "", "null"]) {
    const r = parseOriginHeader(value);
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.code, "origin_required");
  }
});

test("only bare http(s) origins on default ports are accepted", () => {
  for (const value of [
    "ftp://example.com",
    "file:///etc/passwd",
    "https://example.com/path",
    "https://user@example.com",
    "https://example.com:8443",
    "http://example.com:22",
    "not a url",
  ]) {
    assert.equal(parseOriginHeader(value).ok, false, value);
  }
});

test("private origins are refused, with a clear code", () => {
  for (const value of [
    "http://localhost:3000",
    "http://localhost",
    "http://127.0.0.1",
    "http://[::1]",
    "http://192.168.1.10",
    "http://169.254.169.254",
    "http://metadata.google.internal",
    "http://2130706433", // 127.0.0.1 spelled as a number — not a normalized origin
    "http://0x7f.1", // the same in hex
  ]) {
    const r = parseOriginHeader(value);
    assert.equal(r.ok, false, value);
  }
  const loopback = parseOriginHeader("http://127.0.0.1");
  assert.equal(!loopback.ok && loopback.code, "origin_not_public");
});

test("allowLoopback (local development) accepts a localhost origin on any port, and only that", () => {
  assert.equal(parseOriginHeader("http://localhost:3000", { allowLoopback: true }).ok, true);
  assert.equal(parseOriginHeader("http://127.0.0.1:5555", { allowLoopback: true }).ok, true);
  assert.equal(parseOriginHeader("http://192.168.1.10", { allowLoopback: true }).ok, false);
  assert.equal(parseOriginHeader("http://169.254.169.254", { allowLoopback: true }).ok, false);
});

test("the caller IP comes from Vercel's headers", () => {
  assert.equal(clientIp(new Headers({ "x-real-ip": "203.0.113.9" })), "203.0.113.9");
  assert.equal(clientIp(new Headers({ "x-forwarded-for": "198.51.100.2, 10.0.0.1" })), "198.51.100.2");
  assert.equal(clientIp(new Headers()), "unknown");
});
