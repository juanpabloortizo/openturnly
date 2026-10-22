import { describe, expect, it } from "vitest";
import { formatPrice, fromMinorUnits, toMinorUnits } from "../src/money.ts";

// Intl uses narrow no-break spaces in some locales; compare with plain spaces.
const plain = (text: string) => text.replace(/\s/g, " ");

describe("prices", () => {
  it("converts to and from minor units", () => {
    expect(toMinorUnits(25.5, "USD")).toBe(2550);
    expect(fromMinorUnits(2550, "USD")).toBe(25.5);
    // Pesos without cents are stored as whole pesos, whatever the browser's ICU says.
    expect(toMinorUnits(25000, "COP")).toBe(25000);
    expect(toMinorUnits(15000, "CLP")).toBe(15000);
    // Other currencies use their ISO 4217 decimals.
    expect(toMinorUnits(1500, "JPY")).toBe(1500);
    expect(toMinorUnits(1.25, "KWD")).toBe(1250);
  });

  it("formats like local customers expect", () => {
    expect(plain(formatPrice(toMinorUnits(25000, "COP"), "COP"))).toBe("$ 25.000");
    expect(formatPrice(2550, "USD")).toBe("$25.50");
    expect(formatPrice(2500, "USD")).toBe("$25");
  });
});
