import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { after, before, test } from "node:test";

import { resolvePublic, type LookupAll } from "./net.ts";
import { parseAuthority, startEgressProxy, type EgressProxy } from "./proxy.ts";

/**
 * The proxy is exercised over real sockets on loopback. A tiny HTTP server
 * plays "the public site"; a fake DNS maps names to addresses. The policy
 * under test is the production one (`resolvePublic` without allowLoopback), so
 * anything resolving to loopback — which is where the stand-in site lives —
 * must be refused. A second proxy, with a policy that treats the stand-in as
 * public, proves the allowed path actually carries traffic.
 */
let site: http.Server;
let sitePort: number;
let strict: EgressProxy;
let permissive: EgressProxy;

const dns: LookupAll = async (host) => {
  const table: Record<string, string> = {
    "site.example": "127.0.0.1",
    "metadata.example": "169.254.169.254",
  };
  const address = table[host];
  if (!address) throw new Error(`ENOTFOUND ${host}`);
  return [{ address, family: 4 }];
};

before(async () => {
  site = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(`hello ${req.headers.host} ${req.url}`);
  });
  await new Promise<void>((r) => site.listen(0, "127.0.0.1", r));
  sitePort = (site.address() as net.AddressInfo).port;

  strict = await startEgressProxy({
    resolve: (host) => resolvePublic(host, { lookup: dns }),
    portAllowed: (port) => port === 80 || port === 443 || port === sitePort,
  });
  permissive = await startEgressProxy({
    resolve: async (host) =>
      host === "site.example"
        ? { ok: true, addresses: [{ address: "127.0.0.1", family: 4 }] }
        : resolvePublic(host, { lookup: dns }),
    portAllowed: (port) => port === sitePort,
  });
});

after(async () => {
  await strict.close();
  await permissive.close();
  await new Promise<void>((r) => site.close(() => r()));
});

/** Send a CONNECT and return the proxy's status line. */
function connect(proxy: EgressProxy, authority: string): Promise<{ status: number; socket: net.Socket }> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1",
      port: proxy.port,
      method: "CONNECT",
      path: authority,
    });
    req.on("connect", (res, socket) => resolve({ status: res.statusCode ?? 0, socket }));
    req.on("error", reject);
    req.end();
  });
}

/** Send an absolute-form GET through the proxy. */
function get(proxy: EgressProxy, url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port: proxy.port, method: "GET", path: url, headers: { host: new URL(url).host } },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

test("authorities parse, IPv6 included", () => {
  assert.deepEqual(parseAuthority("example.com:443"), { host: "example.com", port: 443 });
  assert.deepEqual(parseAuthority("[::1]:443"), { host: "::1", port: 443 });
  assert.equal(parseAuthority("example.com"), null);
  assert.equal(parseAuthority("example.com:99999"), null);
  assert.equal(parseAuthority("a/b:443"), null);
});

test("tunnels to loopback are refused, by IP or by a name that resolves there", async () => {
  for (const authority of [`127.0.0.1:${sitePort}`, `site.example:${sitePort}`, `[::1]:${sitePort}`, `localhost:${sitePort}`]) {
    const { status, socket } = await connect(strict, authority);
    socket.destroy();
    assert.equal(status, 403, authority);
  }
});

test("tunnels to the metadata endpoint are refused", async () => {
  for (const authority of ["169.254.169.254:80", "metadata.example:80", "metadata.google.internal:80"]) {
    const { status, socket } = await connect(strict, authority);
    socket.destroy();
    assert.equal(status, 403, authority);
  }
});

test("ports outside the policy are refused", async () => {
  const { status, socket } = await connect(permissive, "site.example:22");
  socket.destroy();
  assert.equal(status, 403);
});

test("names that don't resolve get a 502, not a connection", async () => {
  const { status, socket } = await connect(strict, "nowhere.example:443");
  socket.destroy();
  assert.equal(status, 502);
});

test("an allowed tunnel carries traffic to the address that was checked", async () => {
  const { status, socket } = await connect(permissive, `site.example:${sitePort}`);
  assert.equal(status, 200);
  const reply = await new Promise<string>((resolve) => {
    let data = "";
    socket.on("data", (c) => (data += c.toString()));
    socket.on("end", () => resolve(data));
    socket.write(`GET /hi HTTP/1.1\r\nHost: site.example\r\nConnection: close\r\n\r\n`);
  });
  assert.match(reply, /^HTTP\/1\.1 200/);
  assert.match(reply, /hello site\.example \/hi/);
});

test("plain-http requests are policed the same way", async () => {
  assert.equal((await get(strict, `http://site.example:${sitePort}/`)).status, 403);
  assert.equal((await get(strict, "http://169.254.169.254/latest/meta-data/")).status, 403);
  assert.equal((await get(strict, `http://127.0.0.1:${sitePort}/`)).status, 403);
  const ok = await get(permissive, `http://site.example:${sitePort}/page?x=1`);
  assert.equal(ok.status, 200);
  // The Host header is the name asked for; the connection went to the checked IP.
  assert.equal(ok.body, `hello site.example:${sitePort} /page?x=1`);
});
