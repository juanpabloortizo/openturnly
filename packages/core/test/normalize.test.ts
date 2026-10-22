import { describe, expect, it } from "vitest";
import { formatPhone, normalizePhone, splitPhone } from "../src/phone.ts";
import {
  bookingDetailsSchema,
  customerAdminSchema,
  DEFAULT_BOOKING_FORM,
  tidyName,
} from "../src/schemas.ts";

describe("phone numbers", () => {
  it("are stored in E.164 however they were typed", () => {
    expect(normalizePhone(" +57 300 123 4567 ")).toBe("+573001234567");
    expect(normalizePhone("+57 (300) 123-45-67")).toBe("+573001234567");
    expect(normalizePhone("300 123 4567", "CO")).toBe("+573001234567");
    expect(normalizePhone("12345", "CO")).toBeNull();
  });

  it("can be split back for editing", () => {
    expect(splitPhone("+573001234567")).toEqual({ country: "CO", national: "3001234567" });
  });

  it("are shown with readable spacing", () => {
    expect(formatPhone("+573001234567")).toBe("+57 300 1234567");
    expect(formatPhone("not a phone")).toBe("not a phone");
  });
});

describe("names", () => {
  it("are capitalized when typed all in one case", () => {
    expect(tidyName("  ana   maría ")).toBe("Ana María");
    expect(tidyName("JUAN DE LA CRUZ")).toBe("Juan de la Cruz");
    expect(tidyName("maría-josé o'neil")).toBe("María-José O'Neil");
    // Mixed case is the person's own spelling.
    expect(tidyName("DeLuca McDonald")).toBe("DeLuca McDonald");
  });
});

describe("customer details", () => {
  const form = { ...DEFAULT_BOOKING_FORM };

  it("are cleaned before saving", () => {
    const details = bookingDetailsSchema(form).parse({
      customer: {
        email: "  Ana.Perez@Example.COM ",
        phone: "+57 300 123 4567",
        firstName: "  ana   maría ",
        lastName: " Pérez  ",
      },
    });
    expect(details.customer).toEqual({
      email: "ana.perez@example.com",
      phone: "+573001234567",
      firstName: "Ana María",
      lastName: "Pérez",
    });
  });

  it("follow the business's form", () => {
    const strict = bookingDetailsSchema({ phone: "hidden", email: "required", questions: [] });
    const missing = strict.safeParse({ customer: { firstName: "A", lastName: "B", phone: "1" } });
    expect(missing.error?.issues.map((issue) => [issue.path.join("."), issue.message])).toEqual([
      ["customer.email", "required"],
    ]);
    const ok = strict.parse({
      customer: { firstName: "A", lastName: "B", phone: "123", email: "a@b.co" },
    });
    // Hidden fields are dropped, whatever was sent.
    expect(ok.customer.phone).toBeNull();
  });

  it("collect the answers to extra questions", () => {
    const schema = bookingDetailsSchema({
      ...form,
      questions: [
        {
          id: "first",
          label: "¿Primera vez?",
          type: "select",
          required: true,
          options: ["Sí", "No"],
        },
        { id: "notes", label: "Comentarios", type: "textarea", required: false, options: [] },
      ],
    });
    const customer = { firstName: "A", lastName: "B", phone: "+57 300 123 4567" };
    expect(schema.parse({ customer, answers: { first: "Sí", notes: " " } }).answers).toEqual([
      { id: "first", label: "¿Primera vez?", value: "Sí" },
    ]);
    const bad = schema.safeParse({ customer, answers: { first: "Tal vez" } });
    expect(bad.error?.issues[0]?.path).toEqual(["answers", "first"]);
  });

  it("rejects numbers that cannot exist", () => {
    const result = bookingDetailsSchema(form).safeParse({
      customer: { phone: "123", firstName: "A", lastName: "B" },
    });
    expect(result.success).toBe(false);
  });

  it("needs a phone or an email when added by hand", () => {
    const result = customerAdminSchema.safeParse({ firstName: "A", lastName: "B" });
    expect(result.error?.issues[0]?.message).toBe("contact_required");
  });
});
