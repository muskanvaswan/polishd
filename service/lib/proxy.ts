/**
 * The capture browser's only way out: an in-process HTTP proxy that checks
 * every connection against `resolvePublic`.
 *
 * Chromium is launched with this as its proxy and with loopback *not*
 * bypassed, so every connection it opens — the page, each subresource, each
 * hop of a redirect chain, fetch/XHR, WebSockets — arrives here as a CONNECT
 * (https, wss) or an absolute-form request (plain http). Playwright's request
 * interception can't do this job: it never sees redirects after the first
 * URL, and it can't see DNS at all.
 *
 * For each connection the proxy resolves the name itself, refuses unless
 * every address is public and the port is allowed, and then dials the exact
 * address it checked. TLS stays end to end between Chromium and the site —
 * the proxy only ever sees the tunnel's host and port, never a URL path or a
 * byte of content, and logs nothing.
 */
import http from "node:http";
import net from "node:net";

import type { Resolution } from "./net.ts";

export interface EgressPolicy {
  resolve(hostname: string): Promise<Resolution>;
  /** Whether the browser may connect to `port` at `address`. Production: 80 and 443 only. */
  portAllowed(port: number, address: string): boolean;
}

export interface EgressProxy {
  port: number;
  close(): Promise<void>;
}

/** Idle time before a connection is cut, so a stuck page can't pin sockets. */
const IDLE_MS = 30_000;

/** `host:port` (with `[v6]:port` form) → parts, or null. */
export function parseAuthority(authority: string): { host: string; port: number } | null {
  const m = /^\[([^\]]+)\]:(\d{1,5})$/.exec(authority) ?? /^([^:\s/]+):(\d{1,5})$/.exec(authority);
  if (!m) return null;
  const port = Number(m[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host: m[1].toLowerCase(), port };
}

/** Pick the address to dial, or a refusal. */
async function admit(
  policy: EgressPolicy,
  host: string,
  port: number,
): Promise<{ address: string } | { status: number }> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { status: 403 };
  const resolved = await policy.resolve(host);
  if (!resolved.ok) return { status: resolved.reason === "unresolvable" ? 502 : 403 };
  const { address } = resolved.addresses[0];
  if (!policy.portAllowed(port, address)) return { status: 403 };
  return { address };
}

function refuseSocket(socket: net.Socket, status: number): void {
  const text = status === 403 ? "Forbidden" : "Bad Gateway";
  socket.end(`HTTP/1.1 ${status} ${text}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`);
}

/** Hop-by-hop headers a proxy must not forward. */
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export function startEgressProxy(policy: EgressPolicy): Promise<EgressProxy> {
  const server = http.createServer();
  const sockets = new Set<net.Socket>();

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.setTimeout(IDLE_MS, () => socket.destroy());
    socket.on("close", () => sockets.delete(socket));
  });

  // https and wss: a tunnel to host:port.
  server.on("connect", (req: http.IncomingMessage, client: net.Socket, head: Buffer) => {
    client.on("error", () => client.destroy());
    const target = parseAuthority(req.url ?? "");
    if (!target) return refuseSocket(client, 403);
    admit(policy, target.host, target.port)
      .then((decision) => {
        if ("status" in decision) return refuseSocket(client, decision.status);
        const upstream = net.connect({ host: decision.address, port: target.port });
        sockets.add(upstream);
        upstream.setTimeout(IDLE_MS, () => upstream.destroy());
        upstream.on("close", () => sockets.delete(upstream));
        let established = false;
        upstream.once("connect", () => {
          established = true;
          client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          if (head.length > 0) upstream.write(head);
          upstream.pipe(client);
          client.pipe(upstream);
        });
        upstream.on("error", () => {
          if (!established && !client.destroyed) refuseSocket(client, 502);
          else client.destroy();
        });
        client.on("close", () => upstream.destroy());
      })
      .catch(() => refuseSocket(client, 502));
  });

  // Plain http: an absolute-form request, forwarded to the checked address.
  server.on("request", (req: http.IncomingMessage, res: http.ServerResponse) => {
    let url: URL;
    try {
      url = new URL(req.url ?? "");
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (url.protocol !== "http:") {
      res.writeHead(403).end();
      return;
    }
    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    const port = url.port ? Number(url.port) : 80;
    admit(policy, host, port)
      .then((decision) => {
        if ("status" in decision) {
          // A body, so a refused redirect lands on this page — which is off
          // the origin, so the shot is refused by name rather than as an
          // opaque network error.
          res.writeHead(decision.status, { "content-type": "text/plain" }).end("Blocked by polishd-shots.\n");
          return;
        }
        const headers: http.OutgoingHttpHeaders = {};
        for (const [name, value] of Object.entries(req.headers)) {
          if (!HOP_BY_HOP.has(name) && value !== undefined) headers[name] = value;
        }
        headers.host = url.host;
        const upstream = http.request(
          {
            host: decision.address,
            port,
            method: req.method,
            path: `${url.pathname}${url.search}`,
            headers,
            setHost: false,
          },
          (upRes) => {
            const out: http.OutgoingHttpHeaders = {};
            for (const [name, value] of Object.entries(upRes.headers)) {
              if (!HOP_BY_HOP.has(name) && value !== undefined) out[name] = value;
            }
            res.writeHead(upRes.statusCode ?? 502, out);
            upRes.pipe(res);
          },
        );
        upstream.setTimeout(IDLE_MS, () => upstream.destroy());
        upstream.on("error", () => {
          if (!res.headersSent) res.writeHead(502, { "content-length": "0" }).end();
          else res.destroy();
        });
        req.pipe(upstream);
      })
      .catch(() => {
        if (!res.headersSent) res.writeHead(502).end();
      });
  });

  // A WebSocket over plain http arrives as an upgrade; wss tunnels through
  // CONNECT above. Plain ws is rare enough on a page worth shooting to refuse.
  server.on("upgrade", (_req: http.IncomingMessage, socket: net.Socket) => refuseSocket(socket, 403));
  server.on("clientError", (_err, socket) => socket.destroy());

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("proxy failed to bind"));
        return;
      }
      resolve({
        port: address.port,
        close: () =>
          new Promise<void>((done) => {
            for (const s of sockets) s.destroy();
            server.close(() => done());
          }),
      });
    });
  });
}
