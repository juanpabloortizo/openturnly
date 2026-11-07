/**
 * Paying for an appointment on the booking page: the rules the server and the page share.
 * The money goes straight to the business's own account; the install never holds it.
 */

/** What a service asks for online: nothing, a choice, part of the price, or all of it. */
export const SERVICE_PAYMENT_MODES = ["none", "optional", "deposit", "full"] as const;
export type ServicePaymentMode = (typeof SERVICE_PAYMENT_MODES)[number];

/** The currency each Mercado Pago country works in, by its `site_id`. */
export const MERCADOPAGO_SITE_CURRENCIES: Record<string, string> = {
  MCO: "COP",
  MLA: "ARS",
  MLB: "BRL",
  MLC: "CLP",
  MLM: "MXN",
  MPE: "PEN",
  MLU: "UYU",
};

type ServicePayment = { paymentMode: ServicePaymentMode; depositAmount: number | null };

/**
 * What the customer pays to hold the appointment. `price` is what's left after any
 * discount; a deposit never asks for more than that.
 */
export function paymentDueNow(service: ServicePayment, price: number, payNow = false): number {
  if (service.paymentMode === "full") return price;
  if (service.paymentMode === "optional") return payNow ? price : 0;
  if (service.paymentMode === "deposit") return Math.min(service.depositAmount ?? 0, price);
  return 0;
}

/** Why these payment settings don't work for this price, or null when they do. */
export function servicePaymentProblem(
  service: ServicePayment,
  priceAmount: number | null,
): "price_required" | "deposit_required" | "deposit_too_high" | null {
  if (service.paymentMode === "none") return null;
  if (!priceAmount) return "price_required";
  if (service.paymentMode !== "deposit") return null;
  if (!service.depositAmount) return "deposit_required";
  return service.depositAmount > priceAmount ? "deposit_too_high" : null;
}
