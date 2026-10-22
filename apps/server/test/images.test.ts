import { describe, expect, it } from "vitest";
import { createBusiness, createTestApp, setUpOwner } from "./helpers.ts";

// The smallest valid PNG: a 1×1 transparent pixel.
const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  ),
  (char) => char.charCodeAt(0),
);

describe("business images", () => {
  it("uploads a logo and serves it on the public page", async () => {
    const app = await createTestApp();
    const owner = await setUpOwner(app);
    const business = await createBusiness(owner);
    const base = `/api/businesses/${business.id}/images`;

    const uploaded = await owner.raw("PUT", `${base}/logo`, PNG, "image/png");
    expect(uploaded.status).toBe(200);
    const { logoUrl, coverUrl } = (await uploaded.json()) as {
      logoUrl: string;
      coverUrl: string | null;
    };
    expect(logoUrl).toMatch(/^\/api\/public\/businesses\/fte-barber\/images\/logo\?v=\d+$/);
    expect(coverUrl).toBeNull();

    const page = await app.client().get("/api/public/businesses/fte-barber");
    expect(page.body.business).toMatchObject({ logoUrl, coverUrl: null, country: "CO" });
    // The admin shows it in the business switcher and list.
    expect((await owner.get("/api/businesses")).body.businesses[0].logoUrl).toBe(logoUrl);
    expect((await owner.get(`/api/businesses/${business.id}`)).body.business.logoUrl).toBe(logoUrl);

    const image = await app.client().raw("GET", logoUrl);
    expect(image.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(PNG);

    await owner.raw("DELETE", `${base}/logo`);
    expect((await app.client().raw("GET", logoUrl)).status).toBe(404);
    expect((await owner.get("/api/businesses")).body.businesses[0].logoUrl).toBeNull();
  });

  it("rejects files that are not images", async () => {
    const app = await createTestApp();
    const owner = await setUpOwner(app);
    const business = await createBusiness(owner);
    const fake = new TextEncoder().encode("<script>alert(1)</script>");
    const res = await owner.raw(
      "PUT",
      `/api/businesses/${business.id}/images/logo`,
      fake,
      "image/png",
    );
    expect(res.status).toBe(400);
  });
});
