import {
  type CountryCode,
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
} from "libphonenumber-js/min";

/**
 * Phone numbers are stored in E.164 ("+573001234567"): no spaces, no punctuation, always
 * with the country code, so the same number is never saved two different ways.
 */
export function normalizePhone(raw: string, defaultCountry?: string): string | null {
  const parsed = parsePhoneNumberFromString(
    raw.trim(),
    isPhoneCountry(defaultCountry) ? defaultCountry : undefined,
  );
  return parsed?.isValid() ? parsed.number : null;
}

export function isPhoneCountry(code: string | undefined | null): code is CountryCode {
  return Boolean(code) && (getCountries() as string[]).includes(code as string);
}

/** Every country with its calling code, for the phone input's country picker. */
export function phoneCountries(): { code: string; dialCode: string }[] {
  return getCountries().map((code) => ({ code, dialCode: getCountryCallingCode(code) }));
}

export function dialCodeOf(country: string): string | null {
  return isPhoneCountry(country) ? getCountryCallingCode(country) : null;
}

/** "+573001234567" → { country: "CO", national: "3001234567" }, to edit a stored number. */
export function splitPhone(e164: string): { country: string; national: string } | null {
  const parsed = parsePhoneNumberFromString(e164);
  if (!parsed?.country) return null;
  return { country: parsed.country, national: parsed.nationalNumber };
}

/** "+573001234567" → "+57 300 1234567", for showing a stored number to people. */
export function formatPhone(e164: string): string {
  return parsePhoneNumberFromString(e164)?.formatInternational() ?? e164;
}
