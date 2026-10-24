/**
 * Which addresses the screenshot service may reach.
 *
 * The service loads whatever origin the caller's browser names, so without
 * these rules it would be a way to point a browser at the network it runs in:
 * loopback, the VPC, the cloud metadata endpoint. Every connection the
 * capture browser makes — the page, its subresources, every redirect hop —
 * passes through `resolvePublic` in the egress proxy (proxy.ts), which
 * resolves the name itself, refuses if *any* address is non-public, and then
 * connects to the address it checked, so a second DNS answer can't swap in a
 * private one between check and connect.
 *
 * Only `node:` builtins here, so `node --test` runs it without the service's
 * own dependencies installed.
 */
import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

/**
 * IPv4 special-purpose ranges (IANA registry, RFC 6890 and successors):
 * nothing in here is a public website.
 */
const V4_BLOCKED: [string, number][] = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT (also Alibaba's metadata 100.100.100.200)
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local — AWS/GCP/Azure/Oracle metadata 169.254.169.254
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.31.196.0", 24], // AS112
  ["192.52.193.0", 24], // AMT
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16], // private
  ["192.175.48.0", 24], // AS112 direct delegation
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, and 255.255.255.255 broadcast
];

/** Single addresses that look public but aren't websites. */
const V4_BLOCKED_HOSTS = [
  "168.63.129.16", // Azure host / wireserver
];

/** IPv6 ranges blocked inside the global-unicast space 2000::/3. */
const V6_BLOCKED: [string, number][] = [
  ["2001::", 23], // IETF protocol assignments (incl. Teredo 2001::/32)
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4 — tunnels to an arbitrary IPv4 address
  ["3fff::", 20], // documentation
];

const v4Blocked = new BlockList();
for (const [net, prefix] of V4_BLOCKED) v4Blocked.addSubnet(net, prefix, "ipv4");
for (const host of V4_BLOCKED_HOSTS) v4Blocked.addAddress(host, "ipv4");

const v6Blocked = new BlockList();
for (const [net, prefix] of V6_BLOCKED) v6Blocked.addSubnet(net, prefix, "ipv6");

/** Global unicast. Everything outside it (::1, fc00::/7, fe80::/10, ff00::/8, NAT64 64:ff9b::/96 …) is refused. */
const v6GlobalUnicast = new BlockList();
v6GlobalUnicast.addSubnet("2000::", 3, "ipv6");

/**
 * The IPv4 address an IPv6 address embeds by spelling — `::ffff:a.b.c.d`
 * (mapped) or `::a.b.c.d` (compatible) — or null.
 */
function embeddedV4(ip: string): string | null {
  const lower = ip.toLowerCase();
  const dotted = /^::(?:ffff:(?:0:)?)?(\d{1,3}(?:\.\d{1,3}){3})$/.exec(lower);
  if (dotted) return dotted[1];
  const hex = /^::(?:ffff:(?:0:)?)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
  }
  return null;
}

/** True when `ip` must not be connected to. Anything that isn't an IP is blocked too. */
export function isBlockedAddress(ip: string): boolean {
  const bare = ip.replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const family = isIP(bare);
  if (family === 4) return v4Blocked.check(bare, "ipv4");
  if (family === 6) {
    const v4 = embeddedV4(bare);
    if (v4) return isIP(v4) !== 4 || v4Blocked.check(v4, "ipv4");
    if (!v6GlobalUnicast.check(bare, "ipv6")) return true;
    return v6Blocked.check(bare, "ipv6");
  }
  return true;
}

/** Suffixes that only ever name private networks. */
const PRIVATE_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".intranet",
  ".lan",
  ".home",
  ".corp",
  ".home.arpa",
  ".localdomain",
];

/**
 * True for a hostname that could plausibly be a public site, before DNS is
 * asked. Rejects `localhost`, private suffixes (`metadata.google.internal`),
 * and single-label names, which resolve through search domains to whatever
 * the host's network calls them. IP literals are judged by their address.
 */
export function isPublicHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (host.length === 0 || host.length > 253) return false;
  if (isIP(host)) return !isBlockedAddress(host);
  if (host === "localhost") return false;
  if (PRIVATE_SUFFIXES.some((s) => host.endsWith(s))) return false;
  if (!host.includes(".")) return false;
  return /^[a-z0-9.-]+$/.test(host);
}

/** Loopback only — 127.0.0.0/8 and ::1, however spelled. */
export function isLoopbackAddress(ip: string): boolean {
  const bare = ip.replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const family = isIP(bare);
  if (family === 4) return bare.startsWith("127.");
  if (family === 6) {
    const v4 = embeddedV4(bare);
    if (v4) return v4.startsWith("127.");
    return bare === "::1" || /^0{0,4}(:0{0,4}){6}:0{0,3}1$/.test(bare);
  }
  return false;
}

/** `localhost` and its subdomains, or a loopback literal. */
export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  return host === "localhost" || host.endsWith(".localhost") || isLoopbackAddress(host);
}

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export type LookupAll = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<{ address: string; family: number }[]>;

export type Resolution =
  | { ok: true; addresses: ResolvedAddress[] }
  | { ok: false; reason: "not_public" | "unresolvable" };

export interface ResolveOptions {
  /**
   * Local development only: let loopback through, so the service can shoot a
   * site running on the same machine. Every other private range stays blocked.
   */
  allowLoopback?: boolean;
  lookup?: LookupAll;
}

/**
 * Resolve `hostname` and accept it only if every address it resolves to is
 * public. One private answer among public ones is a refusal, not a pick — a
 * name that sometimes points inside is exactly the rebinding shape.
 */
export async function resolvePublic(
  hostname: string,
  { allowLoopback = false, lookup = dnsLookup as LookupAll }: ResolveOptions = {},
): Promise<Resolution> {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  const refused = (ip: string) => isBlockedAddress(ip) && !(allowLoopback && isLoopbackAddress(ip));
  const literal = isIP(host);
  if (literal) {
    if (refused(host)) return { ok: false, reason: "not_public" };
    return { ok: true, addresses: [{ address: host, family: literal as 4 | 6 }] };
  }
  if (!isPublicHostname(host) && !(allowLoopback && isLoopbackHostname(host))) {
    return { ok: false, reason: "not_public" };
  }
  let answers: { address: string; family: number }[];
  try {
    answers = await lookup(host, { all: true, verbatim: true });
  } catch {
    return { ok: false, reason: "unresolvable" };
  }
  if (answers.length === 0) return { ok: false, reason: "unresolvable" };
  const addresses: ResolvedAddress[] = [];
  for (const a of answers) {
    if (a.family !== 4 && a.family !== 6) return { ok: false, reason: "not_public" };
    if (refused(a.address)) return { ok: false, reason: "not_public" };
    addresses.push({ address: a.address, family: a.family });
  }
  return { ok: true, addresses };
}
