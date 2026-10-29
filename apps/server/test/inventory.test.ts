import { describe, expect, it } from "vitest";
import { createBusiness, createTestApp, setUpOwner } from "./helpers.ts";

async function shop() {
  const app = await createTestApp();
  const owner = await setUpOwner(app);
  const business = await createBusiness(owner);
  const base = `/api/businesses/${business.id}`;
  const [main] = (await owner.get(`${base}/locations`)).body.locations;
  const north = (
    await owner.post(`${base}/locations`, { name: "Norte", serviceIds: [], resourceIds: [] })
  ).body.location;
  const created = await owner.post(`${base}/products`, {
    name: "Cera mate",
    brand: "Reuzel",
    category: "Styling",
    format: "Pote",
    content: 113,
    unit: "g",
    priceAmount: 60_000,
    costAmount: 35_000,
    minStock: 3,
    initialStock: 10,
    locationId: main.id,
  });
  expect(created.status).toBe(201);
  const product = created.body.product;
  const stock = async () =>
    (await owner.get(`${base}/products`)).body.products.find(
      (row: { id: string }) => row.id === product.id,
    ).stock;
  const now = Date.now();
  const range = `from=${encodeURIComponent(new Date(now - 60_000).toISOString())}&to=${encodeURIComponent(new Date(now + 600_000).toISOString())}`;
  return { owner, base, main, north, product, stock, range };
}

describe("inventory", () => {
  it("sells products from stock and puts them back when the sale is voided", async () => {
    const { owner, base, main, product, stock, range } = await shop();
    expect(await stock()).toEqual({ [main.id]: 10 });

    const sale = await owner.post(`${base}/sales`, {
      items: [{ kind: "product", productId: product.id, quantity: 2, unitPrice: 60_000 }],
      payments: [{ method: "cash", amount: 120_000 }],
    });
    expect(sale.status).toBe(201);
    expect(sale.body.sale.items[0]).toMatchObject({ kind: "product", name: "Cera mate" });
    expect(await stock()).toEqual({ [main.id]: 8 });

    await owner.post(`${base}/sales/${sale.body.sale.id}/void`, {});
    expect(await stock()).toEqual({ [main.id]: 10 });
    const movements = (await owner.get(`${base}/stock-movements?${range}`)).body.movements;
    expect(
      movements.map((move: { kind: string; quantity: number }) => [move.kind, move.quantity]),
    ).toEqual([
      ["return", 2],
      ["sale", -2],
      ["purchase", 10],
    ]);
    expect(movements[1].sale).toEqual({ id: sale.body.sale.id, number: 1 });
  });

  it("enters, counts, uses and transfers stock by hand", async () => {
    const { owner, base, main, north, product, stock, range } = await shop();
    const move = (body: Record<string, unknown>) =>
      owner.post(`${base}/stock-movements`, {
        productId: product.id,
        locationId: main.id,
        ...body,
      });

    expect((await move({ kind: "purchase", quantity: 5, unitCost: 30_000 })).body.balance).toBe(15);
    // A count sets the stock: 15 → 12 records −3.
    expect((await move({ kind: "adjustment", quantity: 12 })).body.balance).toBe(12);
    expect((await move({ kind: "adjustment", quantity: 12 })).status).toBe(409);
    expect((await move({ kind: "internal", quantity: 2 })).body.balance).toBe(10);
    const transfer = await move({ kind: "transfer", quantity: 4, toLocationId: north.id });
    expect(transfer.body.balance).toBe(6);
    expect(await stock()).toEqual({ [main.id]: 6, [north.id]: 4 });
    expect((await move({ kind: "transfer", quantity: 1, toLocationId: main.id })).status).toBe(400);

    const counts = (await owner.get(`${base}/stock-movements?${range}&kind=adjustment`)).body
      .movements;
    expect(counts).toEqual([expect.objectContaining({ quantity: -3, balanceAfter: 12 })]);
    const atNorth = (await owner.get(`${base}/stock-movements?${range}&locationId=${north.id}`))
      .body.movements;
    expect(atNorth).toEqual([expect.objectContaining({ kind: "transfer_in", quantity: 4 })]);

    // Products with history are turned off, not deleted; locations with stock history stay.
    expect((await owner.delete(`${base}/products/${product.id}`)).status).toBe(409);
    expect((await owner.patch(`${base}/products/${product.id}`, { active: false })).status).toBe(
      200,
    );
    expect((await owner.delete(`${base}/locations/${north.id}`)).status).toBe(409);
  });
});
