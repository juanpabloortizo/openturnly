import { describe, expect, it } from "vitest";
import { paymentDueNow, servicePaymentProblem } from "../src/payments.ts";

describe("paymentDueNow", () => {
  const service = (paymentMode: "none" | "optional" | "deposit" | "full", depositAmount = 0) => ({
    paymentMode,
    depositAmount,
  });

  it("asks for nothing without a payment mode", () => {
    expect(paymentDueNow(service("none"), 50_000, true)).toBe(0);
  });

  it("asks for the whole price on a full payment", () => {
    expect(paymentDueNow(service("full"), 50_000)).toBe(50_000);
  });

  it("asks for the price only if the customer chose to pay now", () => {
    expect(paymentDueNow(service("optional"), 50_000, true)).toBe(50_000);
    expect(paymentDueNow(service("optional"), 50_000, false)).toBe(0);
  });

  it("never asks a deposit above what's left after a discount", () => {
    expect(paymentDueNow(service("deposit", 20_000), 50_000)).toBe(20_000);
    expect(paymentDueNow(service("deposit", 20_000), 15_000)).toBe(15_000);
  });
});

describe("servicePaymentProblem", () => {
  it("accepts a service that isn't charged online, whatever its price", () => {
    expect(servicePaymentProblem({ paymentMode: "none", depositAmount: null }, 0)).toBeNull();
  });

  it("needs a price to charge online", () => {
    expect(servicePaymentProblem({ paymentMode: "full", depositAmount: null }, 0)).toBe(
      "price_required",
    );
  });

  it("needs a deposit that fits the price", () => {
    expect(servicePaymentProblem({ paymentMode: "deposit", depositAmount: null }, 50_000)).toBe(
      "deposit_required",
    );
    expect(servicePaymentProblem({ paymentMode: "deposit", depositAmount: 60_000 }, 50_000)).toBe(
      "deposit_too_high",
    );
    expect(
      servicePaymentProblem({ paymentMode: "deposit", depositAmount: 20_000 }, 50_000),
    ).toBeNull();
  });
});
