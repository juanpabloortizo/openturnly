import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";

/** Header Better Auth reads the client IP from (for rate limiting and sessions). */
export const CLIENT_IP_HEADER = "x-openturnly-client-ip";

/**
 * The address of whoever opened the connection. Behind a reverse proxy (Caddy, Nginx,
 * Cloudflare Tunnel) that is the proxy, so with TRUST_PROXY=true we take the last
 * X-Forwarded-For entry instead: the one our own proxy appended.
 */
export function clientIp(c: Context, trustProxy: boolean): string | null {
  if (trustProxy) {
    const forwarded = c.req.header("x-forwarded-for")?.split(",").at(-1)?.trim();
    if (forwarded) return forwarded;
  }
  try {
    return getConnInfo(c).remote.address ?? null;
  } catch {
    // Not running on a Node socket (e.g. tests calling app.request()).
    return null;
  }
}

/** Copy of the request where the client IP header can only come from us, never the client. */
export function withClientIp(c: Context, trustProxy: boolean): Request {
  const headers = new Headers(c.req.raw.headers);
  headers.delete(CLIENT_IP_HEADER);
  const ip = clientIp(c, trustProxy);
  if (ip) headers.set(CLIENT_IP_HEADER, ip);
  return new Request(c.req.raw, { headers });
}

/** Loopback, private and link-local ranges: the address of a proxy or a Docker gateway. */
const INTERNAL_V4 = /^(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|169\.254\.)/;
const INTERNAL_V6 = /^(?:::1$|f[cd]|fe[89ab])/i;

/**
 * What rate limits count: the IPv4 address, or the /64 network for IPv6, since one home or
 * phone usually gets a whole /64 and could otherwise switch addresses at will.
 *
 * Null when the visitor can't be told apart: an internal address means every request comes
 * through the same proxy or Docker gateway, and limiting it would hold back all customers
 * together. The puzzle, the per-contact limits and the surge brake still apply.
 */
export function networkKey(ip: string | null): string | null {
  if (!ip) return null;
  const address = ip.split("%")[0] ?? ip;
  const v4 = /^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  if (v4?.[1]) return INTERNAL_V4.test(v4[1]) ? null : v4[1];
  if (!address.includes(":") || INTERNAL_V6.test(address)) return null;
  const [head = "", tail = ""] = address.split("::");
  const front = head ? head.split(":") : [];
  const back = tail ? tail.split(":") : [];
  const groups = address.includes("::")
    ? [...front, ...Array<string>(Math.max(0, 8 - front.length - back.length)).fill("0"), ...back]
    : front;
  const network = groups
    .slice(0, 4)
    .map((group) => group.toLowerCase().replace(/^0+(?=.)/, ""))
    .join(":");
  return `${network}::/64`;
}

/** Headers a reverse proxy adds; seeing them while TRUST_PROXY is off means a misconfiguration. */
const PROXY_HEADERS = ["x-forwarded-for", "x-real-ip", "forwarded", "cf-connecting-ip"];

export function hasProxyHeaders(c: Context): boolean {
  return PROXY_HEADERS.some((name) => c.req.header(name) !== undefined);
}

/**
 * Loopback, private, link-local, carrier-grade NAT or unspecified: addresses inside the
 * server's own network, which outgoing webhooks must not reach unless the install allows it.
 */
export function isInternalAddress(ip: string): boolean {
  const address = (ip.split("%")[0] ?? ip).replace(/^::ffff:/i, "");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(address)) {
    return (
      INTERNAL_V4.test(address) ||
      /^(?:0\.|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(address) ||
      address === "255.255.255.255"
    );
  }
  return address === "::" || INTERNAL_V6.test(address);
}
