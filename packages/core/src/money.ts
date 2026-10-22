/**
 * Prices are stored as integers in the currency's minor unit (cents for USD), so they
 * never suffer from floating point. They are informative only: customers pay at the business.
 */

/** Locale used to format each currency the way its customers expect ("$ 25.000" for COP). */
const CURRENCY_LOCALES: Record<string, string> = {
  ARS: "es-AR",
  BOB: "es-BO",
  BRL: "pt-BR",
  CLP: "es-CL",
  COP: "es-CO",
  CRC: "es-CR",
  DOP: "es-DO",
  EUR: "es-ES",
  GTQ: "es-GT",
  MXN: "es-MX",
  PEN: "es-PE",
  PYG: "es-PY",
  USD: "en-US",
  UYU: "es-UY",
};

/**
 * Decimal places stored for each currency. Fixed here instead of asking Intl, because
 * browsers disagree (newer ICU says COP has 0 decimals, older says 2) and a stored price
 * must mean the same amount everywhere.
 */
const ZERO_DECIMALS = "BIF CLP COP DJF GNF ISK JPY KMF KRW PYG RWF UGX VND VUV XAF XOF XPF";
const THREE_DECIMALS = "BHD IQD JOD KWD LYD OMR TND";

/** COP is 2 in ISO 4217, but nobody prices in centavos; it has been 0 here since day one. */
const CURRENCY_DIGITS: Record<string, number> = Object.fromEntries([
  ...ZERO_DECIMALS.split(" ").map((code) => [code, 0]),
  ...THREE_DECIMALS.split(" ").map((code) => [code, 3]),
]);

export function currencyDigits(currency: string): number {
  return CURRENCY_DIGITS[currency] ?? 2;
}

export function toMinorUnits(amount: number, currency: string): number {
  return Math.round(amount * 10 ** currencyDigits(currency));
}

export function fromMinorUnits(amount: number, currency: string): number {
  return amount / 10 ** currencyDigits(currency);
}

/** 2500000 COP → "$ 25.000"; 2550 USD → "$25.50". Whole amounts drop the decimals. */
export function formatPrice(amount: number, currency: string): string {
  const value = fromMinorUnits(amount, currency);
  const whole = Number.isInteger(value);
  return new Intl.NumberFormat(CURRENCY_LOCALES[currency] ?? "en", {
    style: "currency",
    currency,
    minimumFractionDigits: whole ? 0 : undefined,
    maximumFractionDigits: whole ? 0 : currencyDigits(currency),
  }).format(value);
}
