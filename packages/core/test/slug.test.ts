import { describe, expect, it } from "vitest";
import { checkSlug, slugify } from "../src/slug.ts";

describe("slugify", () => {
  it("removes accents and symbols", () => {
    expect(slugify("Peluquería Doña Ana")).toBe("peluqueria-dona-ana");
    expect(slugify("  FTE Barber & Studio!! ")).toBe("fte-barber-studio");
  });

  it("never ends with a hyphen after truncating", () => {
    const slug = slugify(`${"a".repeat(59)} b`);
    expect(slug.endsWith("-")).toBe(false);
    expect(slug.length).toBeLessThanOrEqual(60);
  });
});

describe("checkSlug", () => {
  it("accepts lowercase words separated by single hyphens", () => {
    expect(checkSlug("mi-barberia")).toBeNull();
    expect(checkSlug("spa24")).toBeNull();
  });

  it("rejects bad shapes", () => {
    expect(checkSlug("ab")).toBe("too_short");
    expect(checkSlug("a".repeat(61))).toBe("too_long");
    expect(checkSlug("Mi-Barberia")).toBe("invalid_characters");
    expect(checkSlug("mi--barberia")).toBe("invalid_characters");
    expect(checkSlug("-barberia")).toBe("invalid_characters");
  });

  it("rejects names used by the app itself", () => {
    expect(checkSlug("admin")).toBe("reserved");
    expect(checkSlug("api")).toBe("reserved");
  });
});
