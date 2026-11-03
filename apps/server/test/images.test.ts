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

describe("professional photos", () => {
  it("uploads a photo, shows it on the booking page and removes it", async () => {
    const app = await createTestApp();
    const owner = await setUpOwner(app);
    const business = await createBusiness(owner);
    const base = `/api/businesses/${business.id}`;
    const service = (
      await owner.post(`${base}/services`, {
        name: "Corte",
        category: "Cortes",
        durationMin: 30,
        priceAmount: 30_000,
      })
    ).body.service;
    expect(service.category).toBe("Cortes");
    const ana = (
      await owner.post(`${base}/professionals`, { name: "Ana", serviceIds: [service.id] })
    ).body.professional;
    expect(ana.photoUrl).toBeNull();

    const uploaded = await owner.raw(
      "PUT",
      `${base}/professionals/${ana.id}/photo`,
      PNG,
      "image/png",
    );
    expect(uploaded.status).toBe(200);
    const { photoUrl } = (await uploaded.json()) as { photoUrl: string };
    expect(photoUrl).toMatch(
      new RegExp(`^/api/public/businesses/fte-barber/professionals/${ana.id}/photo\\?v=\\d+$`),
    );
    expect((await owner.get(`${base}/professionals`)).body.professionals[0].photoUrl).toBe(
      photoUrl,
    );

    const page = await app.client().get("/api/public/businesses/fte-barber");
    expect(page.body.professionals).toEqual([expect.objectContaining({ name: "Ana", photoUrl })]);
    expect(page.body.services).toEqual([
      expect.objectContaining({ name: "Corte", category: "Cortes" }),
    ]);
    const image = await app.client().raw("GET", photoUrl);
    expect(image.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(PNG);

    // Only through the business they work for.
    await createBusiness(owner, { name: "Otro", slug: "otro" });
    expect(
      (await app.client().raw("GET", `/api/public/businesses/otro/professionals/${ana.id}/photo`))
        .status,
    ).toBe(404);
    const fake = new TextEncoder().encode("<svg onload=alert(1)>");
    expect(
      (await owner.raw("PUT", `${base}/professionals/${ana.id}/photo`, fake, "image/png")).status,
    ).toBe(400);

    await owner.raw("DELETE", `${base}/professionals/${ana.id}/photo`);
    expect((await app.client().raw("GET", photoUrl)).status).toBe(404);
    expect((await owner.get(`${base}/professionals`)).body.professionals[0].photoUrl).toBeNull();

    // A category can be cleared.
    const cleared = await owner.patch(`${base}/services/${service.id}`, { category: "" });
    expect(cleared.body.service.category).toBeNull();
  });
});
