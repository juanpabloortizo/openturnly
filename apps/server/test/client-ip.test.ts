import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { CLIENT_IP_HEADER, withClientIp } from "../src/lib/client-ip.ts";

async function ipSeenByAuth(trustProxy: boolean, headers: Record<string, string>) {
  const app = new Hono().all("*", (c) =>
    c.text(withClientIp(c, trustProxy).headers.get(CLIENT_IP_HEADER) ?? "none"),
  );
  const res = await app.request("/", { headers });
  return res.text();
}

describe("client IP for rate limiting", () => {
  it("drops a client IP header sent by the client", async () => {
    expect(await ipSeenByAuth(false, { [CLIENT_IP_HEADER]: "6.6.6.6" })).toBe("none");
  });

  it("ignores X-Forwarded-For unless a proxy is trusted", async () => {
    expect(await ipSeenByAuth(false, { "x-forwarded-for": "6.6.6.6" })).toBe("none");
  });

  it("uses the entry appended by the trusted proxy", async () => {
    const ip = await ipSeenByAuth(true, { "x-forwarded-for": "6.6.6.6, 203.0.113.7" });
    expect(ip).toBe("203.0.113.7");
  });
});
