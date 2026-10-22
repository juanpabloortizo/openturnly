import { describe, expect, it } from "vitest";
import { createBusiness, createTestApp, setUpOwner } from "./helpers.ts";

describe("public booking page data", () => {
  it("is available by slug without logging in", async () => {
    const app = await createTestApp();
    const owner = await setUpOwner(app);
    await createBusiness(owner);

    const res = await app.client().get("/api/public/businesses/FTE-Barber");
    expect(res.status).toBe(200);
    expect(res.body.business).toMatchObject({ name: "FTE Barber Studio", slug: "fte-barber" });
    expect(res.body.business.id).toBeUndefined();
  });

  it("returns 404 for unknown slugs", async () => {
    const app = await createTestApp();
    const res = await app.client().get("/api/public/businesses/nope");
    expect(res.status).toBe(404);
  });
});
