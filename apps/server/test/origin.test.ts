import { describe, expect, it } from "vitest";
import { businessInput, createBusiness, createTestApp, setUpOwner } from "./helpers.ts";

describe("changes from other sites", () => {
  it("are refused when they carry the session cookie", async () => {
    const app = await createTestApp();
    const owner = await setUpOwner(app);
    const business = await createBusiness(owner);
    const elsewhere = { origin: "https://evil.example" };

    // Another site posting with the signed-in owner's cookie (CSRF).
    const forged = await owner.post("/api/businesses", businessInput({ slug: "otro" }), elsewhere);
    expect(forged.status).toBe(403);
    expect(forged.body.error.code).toBe("forbidden_origin");
    // Reading changes nothing; the same change from the install's own pages works.
    expect((await owner.get("/api/businesses", elsewhere)).status).toBe(200);
    expect((await owner.post("/api/businesses", businessInput({ slug: "otro" }))).status).toBe(201);

    // Without the cookie the origin proves nothing: the usual checks answer.
    const anonymous = await app.client().post("/api/businesses", businessInput(), elsewhere);
    expect(anonymous.status).toBe(401);
    // The public booking API doesn't depend on the cookie, so other sites may use it.
    const booking = await owner.post(
      `/api/public/businesses/${business.slug}/bookings`,
      { proof: "x" },
      elsewhere,
    );
    expect(booking.body.error.code).not.toBe("forbidden_origin");
  });
});
