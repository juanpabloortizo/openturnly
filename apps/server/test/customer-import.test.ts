import { describe, expect, it } from "vitest";
import { createBusiness, createTestApp, setUpOwner } from "./helpers.ts";

describe("customer import", () => {
  it("previews, then creates and updates customers by mobile or email", async () => {
    const app = await createTestApp();
    const owner = await setUpOwner(app);
    const business = await createBusiness(owner);
    const base = `/api/businesses/${business.id}`;
    await owner.post(`${base}/customers`, {
      firstName: "Ana",
      lastName: "Pérez",
      phone: "+57 300 111 2233",
      email: null,
    });
    await owner.post(`${base}/customers`, {
      firstName: "Luis",
      lastName: "Gómez",
      phone: null,
      email: "luis@example.com",
    });

    const rows = [
      // Ana by her number written another way: her email and notes are added.
      {
        firstName: "ana",
        lastName: "pérez",
        phone: "300 111 2233",
        email: "ana@example.com",
        notes: "VIP",
      },
      // Luis by email, with a new number.
      { firstName: "Luis", lastName: "Gómez", phone: "3004445566", email: "LUIS@example.com" },
      // New, without a last name.
      { firstName: "Camila", phone: "+57 301 000 0000" },
      // The same new person twice in the file: the second one is already there.
      { firstName: "Camila", phone: "301 000 0000" },
      // Problems.
      { firstName: "Sin contacto" },
      { firstName: "Mal número", phone: "12" },
      { firstName: "", email: "nadie@example.com" },
    ];
    const preview = await owner.post(`${base}/customers/import`, { rows });
    expect(preview.status).toBe(200);
    expect(preview.body.counts).toEqual({
      created: 1,
      updated: 2,
      unchanged: 1,
      skipped: 0,
      errors: 3,
    });
    expect(
      preview.body.results.map((row: { row: number; error: string }) => [row.row, row.error]),
    ).toEqual([
      [4, "phone_contact_required"],
      [5, "phone_invalid_phone"],
      [6, "firstName_too_small"],
    ]);
    // Nothing was saved by the preview.
    expect((await owner.get(`${base}/customers`)).body.customers).toHaveLength(2);

    const applied = await owner.post(`${base}/customers/import`, { rows, apply: true });
    expect(applied.body.applied).toBe(true);
    const list = (await owner.get(`${base}/customers`)).body.customers;
    expect(list).toHaveLength(3);
    expect(list).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ firstName: "Ana", email: "ana@example.com", notes: "VIP" }),
        expect.objectContaining({ firstName: "Luis", phone: "+573004445566" }),
        expect.objectContaining({ firstName: "Camila", lastName: "", phone: "+573010000000" }),
      ]),
    );

    // Without updating, existing customers are left alone.
    const again = await owner.post(`${base}/customers/import`, {
      rows: [{ firstName: "Otra Ana", phone: "3001112233" }],
      update: false,
      apply: true,
    });
    expect(again.body.counts).toMatchObject({ skipped: 1, created: 0 });
  });

  it("keeps an email that belongs to another customer", async () => {
    const app = await createTestApp();
    const owner = await setUpOwner(app);
    const business = await createBusiness(owner);
    const base = `/api/businesses/${business.id}`;
    await owner.post(`${base}/customers`, {
      firstName: "Ana",
      lastName: "A",
      phone: "+57 300 111 2233",
      email: null,
    });
    await owner.post(`${base}/customers`, {
      firstName: "Eva",
      lastName: "E",
      phone: null,
      email: "eva@example.com",
    });
    const result = await owner.post(`${base}/customers/import`, {
      rows: [{ firstName: "Ana", lastName: "A", phone: "3001112233", email: "eva@example.com" }],
      apply: true,
    });
    expect(result.body.counts.unchanged).toBe(1);
    expect(result.body.results).toEqual([{ row: 0, status: "unchanged", warning: "email_taken" }]);
  });
});
