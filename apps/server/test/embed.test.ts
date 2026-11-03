import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.ts";

/** A web build with just what these checks need. */
function webBuild() {
  const dir = mkdtempSync(path.join(tmpdir(), "openturnly-web-"));
  writeFileSync(path.join(dir, "index.html"), "<!doctype html><div id=root></div>");
  writeFileSync(path.join(dir, "embed.js"), "(() => {})();");
  return dir;
}

describe("booking page inside other websites", () => {
  it("lets other websites show the booking page with ?embed, and nothing else", async () => {
    const { app } = await createTestApp({ webDistDir: webBuild() });
    const get = (url: string) => app.request(`http://localhost:3000${url}`);

    const embedded = await get("/studio?embed=1");
    expect(embedded.status).toBe(200);
    expect(embedded.headers.get("x-frame-options")).toBeNull();
    expect(embedded.headers.get("content-security-policy")).toBe("frame-ancestors *");

    // The page without ?embed, and the app's own pages and API even with it, can't be framed
    // by other websites (no clicking the admin through someone else's page).
    for (const url of [
      "/studio",
      "/admin?embed=1",
      "/admin/k7m2qx9a4p?embed=1",
      "/login?embed=1",
      "/studio/login?embed=1",
      "/api/health?embed=1",
    ]) {
      const res = await get(url);
      expect(res.headers.get("x-frame-options"), url).toBe("SAMEORIGIN");
      expect(res.headers.get("content-security-policy"), url).toBeNull();
    }
  });

  it("serves embed.js to any website", async () => {
    const { app } = await createTestApp({ webDistDir: webBuild() });
    const res = await app.request("http://localhost:3000/embed.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
  });
});
