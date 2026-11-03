import { todayIn } from "@openturnly/core";
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
  const list = async (body: Record<string, unknown>) =>
    (await owner.post(`${base}/product-attributes`, body)).body.attribute;
  const brand = await list({ kind: "brand", name: "Reuzel" });
  const category = await list({ kind: "category", name: "Styling" });
  const created = await owner.post(`${base}/products`, {
    name: "Cera mate",
    brandId: brand.id,
    categoryId: category.id,
    content: 113,
    unit: "g",
    priceAmount: 60_000,
    costAmount: 35_000,
    initialStock: [{ locationId: main.id, quantity: 10 }],
    alerts: [{ locationId: main.id, alertAt: 3 }],
  });
  expect(created.status).toBe(201);
  const product = created.body.product;
  const stock = async () =>
    (await owner.get(`${base}/products`)).body.products.find(
      (row: { id: string }) => row.id === product.id,
    ).stock;
  const now = Date.now();
  const range = `from=${encodeURIComponent(new Date(now - 60_000).toISOString())}&to=${encodeURIComponent(new Date(now + 600_000).toISOString())}`;
  return { app, owner, base, main, north, product, stock, range, brand, category };
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

describe("product lists", () => {
  it("keep one entry per name however it's written, and only delete unused ones", async () => {
    const { owner, base, brand, category, product } = await shop();
    const add = (body: Record<string, unknown>) => owner.post(`${base}/product-attributes`, body);

    const coke = await add({ kind: "brand", name: "Coca-Cola" });
    expect(coke.status).toBe(201);
    for (const name of ["coca cola", "CocaCola", "COCA-COLA ", "Cóca Cola"]) {
      const again = await add({ kind: "brand", name });
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe("attribute_exists");
    }
    // The same name in the other list is fine.
    expect((await add({ kind: "category", name: "Coca Cola" })).status).toBe(201);
    expect((await add({ kind: "brand", name: "  " })).status).toBe(400);
    // Sizes are each product's own content, not a list.
    expect((await add({ kind: "format", name: "Pote 50 g" })).status).toBe(400);

    const list = (await owner.get(`${base}/product-attributes`)).body.attributes;
    expect(list.find((entry: { id: string }) => entry.id === brand.id).products).toBe(1);

    // Renaming can't make it the same as another one.
    const renamed = await owner.patch(`${base}/product-attributes/${coke.body.attribute.id}`, {
      kind: "brand",
      name: "reuzel",
    });
    expect(renamed.status).toBe(409);
    expect(
      (
        await owner.patch(`${base}/product-attributes/${coke.body.attribute.id}`, {
          kind: "brand",
          name: "Coca-Cola Company",
        })
      ).body.attribute.name,
    ).toBe("Coca-Cola Company");

    expect((await owner.delete(`${base}/product-attributes/${category.id}`)).status).toBe(409);
    expect(
      (await owner.delete(`${base}/product-attributes/${coke.body.attribute.id}`)).status,
    ).toBe(204);

    // A product can't point to another business's entry or to the wrong list.
    const wrong = await owner.patch(`${base}/products/${product.id}`, { brandId: category.id });
    expect(wrong.status).toBe(400);
  });

  it("changes only what's sent, and counts products low on stock", async () => {
    const { owner, base, main, north, product, category } = await shop();
    const edited = await owner.patch(`${base}/products/${product.id}`, { name: "Cera mate 2" });
    expect(edited.body.product).toMatchObject({
      name: "Cera mate 2",
      categoryId: category.id,
      content: 113,
      unit: "g",
      costAmount: 35_000,
      alerts: { [main.id]: 3 },
    });
    expect((await owner.get(`${base}/products/low-stock`)).body.count).toBe(0);

    // A size is a number and its unit, both or neither.
    const halfSize = async (body: Record<string, unknown>) => {
      const response = await owner.patch(`${base}/products/${product.id}`, body);
      expect(response.status).toBe(400);
      return response.body.error.fields;
    };
    expect(await halfSize({ unit: null })).toEqual({ unit: "required" });
    expect(await halfSize({ content: null })).toEqual({ content: "required" });
    const created = await owner.post(`${base}/products`, {
      name: "Gel",
      priceAmount: 1,
      content: 250,
    });
    expect(created.body.error.fields).toEqual({ unit: "required" });
    const resized = await owner.patch(`${base}/products/${product.id}`, { content: 1, unit: "kg" });
    expect(resized.body.product).toMatchObject({ content: 1, unit: "kg" });
    const sizeless = await owner.patch(`${base}/products/${product.id}`, {
      content: null,
      unit: null,
    });
    expect(sizeless.body.product).toMatchObject({ content: null, unit: null });

    // At 3 or fewer at the main location it warns; the other location has no alarm.
    await owner.post(`${base}/stock-movements`, {
      kind: "adjustment",
      productId: product.id,
      locationId: main.id,
      quantity: 3,
    });
    expect((await owner.get(`${base}/products/low-stock`)).body.count).toBe(1);
    await owner.patch(`${base}/products/${product.id}`, {
      alerts: [
        { locationId: main.id, alertAt: null },
        { locationId: north.id, alertAt: 1 },
      ],
    });
    const after = (await owner.get(`${base}/products`)).body.products[0];
    expect(after.alerts).toEqual({ [north.id]: 1 });
    expect(after.stock).toEqual({ [main.id]: 3, [north.id]: 0 });
    expect((await owner.get(`${base}/products/low-stock`)).body.count).toBe(1);
  });
});

describe("bulk product upload", () => {
  it("previews, then creates, updates, files and counts products", async () => {
    const { owner, base, main, north, product } = await shop();
    await owner.post(`${base}/product-attributes`, { kind: "brand", name: "Coca-Cola" });
    const row = (values: Record<string, unknown>) => ({ stock: {}, ...values });
    const rows = [
      // The pomade by its name, brand and format: new price and a count at both locations.
      row({
        name: "cera mate",
        brand: "REUZEL",
        content: "113 gr",
        price: "65.000",
        stock: { [main.id]: "7", [north.id]: "2" },
      }),
      // New, with a brand already there written another way, and new lists.
      row({
        sku: "7702004",
        name: "Gaseosa",
        brand: "coca cola",
        category: "Bebidas",
        content: "Botella 400ml",
        price: "$ 4.500",
        cost: "2500",
        internalPrice: "3.000",
        commission: "500",
        commissionType: "1",
        status: "Activo",
        taxIncluded: "Sí",
        stock: { [main.id]: "24" },
      }),
      // The same barcode later in the file updates it.
      row({ sku: "7702004", description: "Lata fría" }),
      // Problems.
      row({ category: "Bebidas" }),
      row({ name: "Agua", price: "mucho" }),
      row({ name: "Shampoo", commission: "150" }),
      row({ name: "Jabón", stock: { [main.id]: "-2" } }),
      row({ name: "Crema", content: "grande" }),
    ];
    const preview = await owner.post(`${base}/products/import`, { rows });
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({
      applied: false,
      counts: { created: 1, updated: 2, unchanged: 0, errors: 5 },
      newLists: { category: 1, brand: 0 },
      stockChanges: 2,
    });
    expect(
      preview.body.results.map((result: { row: number; error: string; field: string }) => [
        result.row,
        result.error,
        result.field,
      ]),
    ).toEqual([
      [3, "name_required", "name"],
      [4, "invalid_number", "price"],
      [5, "commission_too_big", "commission"],
      [6, "invalid_stock", "stock"],
      [7, "invalid_content", "content"],
    ]);
    expect((await owner.get(`${base}/products`)).body.products).toHaveLength(1);

    const applied = await owner.post(`${base}/products/import`, { rows, apply: true });
    expect(applied.body.applied).toBe(true);
    const all = (await owner.get(`${base}/products`)).body.products;
    expect(all).toHaveLength(2);
    expect(all.find((item: { id: string }) => item.id === product.id)).toMatchObject({
      priceAmount: 65_000,
      stock: { [main.id]: 7, [north.id]: 2 },
    });
    const soda = all.find((item: { sku: string }) => item.sku === "7702004");
    expect(soda).toMatchObject({
      name: "Gaseosa",
      content: 400,
      unit: "ml",
      description: "Lata fría",
      priceAmount: 4_500,
      costAmount: 2_500,
      internalPriceAmount: 3_000,
      commissionValue: 500,
      commissionType: "fixed",
      taxRate: 19,
      active: true,
      stock: { [main.id]: 24 },
    });
    const lists = (await owner.get(`${base}/product-attributes`)).body.attributes;
    expect(lists.filter((entry: { kind: string }) => entry.kind === "brand")).toHaveLength(2);

    // The same file again changes nothing.
    const again = await owner.post(`${base}/products/import`, { rows: rows.slice(0, 3) });
    expect(again.body.counts).toMatchObject({ created: 0, updated: 0, unchanged: 3 });
  });

  it("pays a product's own commission instead of the professional's", async () => {
    const { owner, base, product } = await shop();
    const juan = (
      await owner.post(`${base}/professionals`, {
        name: "Juan",
        serviceIds: [],
        productCommission: 10,
      })
    ).body.professional;
    const soda = (
      await owner.post(`${base}/products`, {
        name: "Gaseosa",
        priceAmount: 4_000,
        commissionValue: 300,
        commissionType: "fixed",
        taxRate: 19,
        initialStock: [],
      })
    ).body.product;
    const sale = await owner.post(`${base}/sales`, {
      items: [
        // 10 % of 60.000 = 6.000 (Juan's own rate), and 300 for each of 2 sodas.
        {
          kind: "product",
          productId: product.id,
          quantity: 1,
          unitPrice: 60_000,
          resourceId: juan.id,
        },
        { kind: "product", productId: soda.id, quantity: 2, unitPrice: 4_000, resourceId: juan.id },
      ],
      payments: [{ method: "cash", amount: 68_000 }],
    });
    expect(sale.status).toBe(201);
    expect(sale.body.sale.items[1]).toMatchObject({ taxRate: 19, commissionType: "fixed" });
    const today = todayIn("America/Bogota");
    const report = await owner.get(`${base}/reports/commissions?from=${today}&to=${today}`);
    const row = report.body.professionals.find((person: { id: string }) => person.id === juan.id);
    expect(row.productCommission).toBe(6_600);
  });
});
