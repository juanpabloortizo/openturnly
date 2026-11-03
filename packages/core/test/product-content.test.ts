import { describe, expect, it } from "vitest";
import { missingContentField, parseContent } from "../src/index.ts";

describe("parseContent", () => {
  it("reads sizes the way people write them", () => {
    expect(parseContent("400ml")).toEqual({ content: 400, unit: "ml" });
    expect(parseContent("80 gr.")).toEqual({ content: 80, unit: "g" });
    expect(parseContent("1,5 Litros")).toEqual({ content: 1.5, unit: "l" });
    expect(parseContent("Botella 2 unidades")).toEqual({ content: 2, unit: "unit" });
    expect(parseContent("Unidad")).toEqual({ content: 1, unit: "unit" });
    expect(parseContent("12 oz")).toEqual({ content: 12, unit: "oz" });
    expect(parseContent("1 kilo")).toEqual({ content: 1, unit: "kg" });
  });

  it("says nothing without a number and a unit it knows", () => {
    for (const text of ["", "ml", "grande", "Caja x12", "0 g", "400 tazas"]) {
      expect(parseContent(text)).toBeNull();
    }
  });

  it("answers at once for a huge cell from a spreadsheet", () => {
    const started = Date.now();
    expect(parseContent(`${"1".repeat(100_000)}!`)).toBeNull();
    expect(parseContent(`${"1".repeat(100_000)} ml`)).toBeNull();
    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe("missingContentField", () => {
  it("asks for the half that's missing", () => {
    expect(missingContentField({ content: 400, unit: null })).toBe("unit");
    expect(missingContentField({ content: null, unit: "ml" })).toBe("content");
    expect(missingContentField({ content: 400, unit: "ml" })).toBeNull();
    expect(missingContentField({})).toBeNull();
  });
});
